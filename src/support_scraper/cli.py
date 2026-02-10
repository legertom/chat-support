import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

from .chunker import chunk_article
from .config import get_path, get_source_hosts, load_config, validate_config
from .discovery import discover_urls, write_urls
from .logger import setup_logger
from .scraper import scrape_urls
from .utils import ensure_dir, read_json, read_jsonl, write_json, write_jsonl
from .validator import chunk_counts, sample_articles, token_stats, validate_articles


def _apply_overrides(config: Dict[str, Any], args: argparse.Namespace) -> Dict[str, Any]:
    concurrency = getattr(args, "concurrency", None)
    rate_limit = getattr(args, "rate_limit", None)
    use_playwright = getattr(args, "use_playwright", None)
    save_raw_html = getattr(args, "save_raw_html", False)
    save_screenshots = getattr(args, "save_screenshots", False)
    max_urls = getattr(args, "max_urls", None)
    urls_path = getattr(args, "urls", None)
    sources = getattr(args, "sources", None)

    if concurrency is not None:
        config["concurrency"] = concurrency
    if rate_limit is not None:
        config["rate_limit_rps"] = rate_limit
    if use_playwright is not None:
        value = use_playwright
        if isinstance(value, str):
            if value.lower() in {"true", "false"}:
                config["use_playwright"] = value.lower() == "true"
            else:
                config["use_playwright"] = value
        else:
            config["use_playwright"] = value
    if save_raw_html:
        config["save_raw_html"] = True
    if save_screenshots:
        config["save_screenshots"] = True
    if max_urls is not None:
        config["max_urls"] = max_urls
    if urls_path:
        config["paths"]["urls_path"] = urls_path
    if sources:
        selected_sources = [item.strip() for item in sources.split(",") if item.strip()]
        if not selected_sources:
            raise ValueError("At least one source must be provided with --sources")
        available_sources = set(config.get("sources", {}).keys())
        unknown = sorted(source for source in selected_sources if source not in available_sources)
        if unknown:
            raise ValueError(f"Unknown source(s): {', '.join(unknown)}")
        for source_name in config.get("sources", {}):
            config["sources"][source_name]["enabled"] = source_name in selected_sources
    return validate_config(config)


def _load_urls(path: str) -> List[str]:
    data = read_json(path)
    return data.get("urls", [])


def _filter_urls_for_enabled_sources(urls: List[str], config: Dict[str, Any]) -> List[str]:
    enabled_hosts = get_source_hosts(config, enabled_only=True)
    if not enabled_hosts:
        return []
    return [url for url in urls if urlparse(url).netloc.lower() in enabled_hosts]


def cmd_discover(args: argparse.Namespace) -> int:
    config = _apply_overrides(load_config(args.config), args)
    logger = setup_logger(args.verbose)
    ensure_dir(config["paths"]["data_dir"])
    urls = asyncio.run(discover_urls(config, logger))
    if config.get("max_urls"):
        urls = urls[: config["max_urls"]]
    write_urls(get_path(config, "urls_path"), urls)
    return 0


def cmd_scrape(args: argparse.Namespace) -> int:
    config = _apply_overrides(load_config(args.config), args)
    logger = setup_logger(args.verbose)
    urls = _filter_urls_for_enabled_sources(_load_urls(get_path(config, "urls_path")), config)
    if config.get("max_urls"):
        urls = urls[: config["max_urls"]]
    started_at = datetime.now(timezone.utc)
    stats = asyncio.run(scrape_urls(urls, config, logger, resume=args.resume))
    finished_at = datetime.now(timezone.utc)
    manifest_path = get_path(config, "manifest_path")
    write_json(
        manifest_path,
        {
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
            "duration_seconds": (finished_at - started_at).total_seconds(),
            "total": stats.total,
            "success": stats.success,
            "failed": stats.failed,
            "skipped": stats.skipped,
            "updated": stats.updated,
            "unchanged": stats.unchanged,
            "auth_required": stats.auth_required,
            "errors": len(stats.errors),
        },
    )
    return 0


def cmd_chunk(args: argparse.Namespace) -> int:
    config = _apply_overrides(load_config(args.config), args)
    articles_path = get_path(config, "articles_path")
    chunks_path = get_path(config, "chunks_path")
    ensure_dir(config["paths"]["data_dir"])
    articles = read_jsonl(articles_path)
    chunks = []
    for article in articles:
        chunks.extend(chunk_article(article, config["chunking"]))
    write_jsonl(chunks_path, chunks)
    manifest_path = get_path(config, "manifest_path")
    manifest = {}
    if os.path.exists(manifest_path):
        manifest = read_json(manifest_path)
    manifest.update(
        {
            "articles_written": len(articles),
            "chunks_written": len(chunks),
            "chunk_tokens": token_stats(chunks),
        }
    )
    write_json(manifest_path, manifest)
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    config = _apply_overrides(load_config(args.config), args)
    articles = read_jsonl(get_path(config, "articles_path"))
    chunks = read_jsonl(get_path(config, "chunks_path")) if os.path.exists(get_path(config, "chunks_path")) else []
    urls_count = None
    urls_path = get_path(config, "urls_path")
    if os.path.exists(urls_path):
        urls_data = read_json(urls_path)
        urls_count = urls_data.get("count")
    errors, warnings = validate_articles(articles)
    sample = sample_articles(articles)
    counts = chunk_counts(chunks)
    print("Validation summary")
    if urls_count is not None:
        print(f"Discovered URLs: {urls_count}")
        if urls_count < 350:
            print("Warning: discovered URL count far below expected ~450.")
    print(f"Articles: {len(articles)}")
    print(f"Chunks: {len(chunks)}")
    if errors:
        print("Errors:")
        for err in errors:
            print(f"- {err}")
    if warnings:
        print("Warnings:")
        for warn in warnings:
            print(f"- {warn}")
    if sample:
        print("Sample articles:")
        for article in sample:
            doc_id = article.get("doc_id")
            chunk_count = counts.get(doc_id, 0)
            print(f"- {article.get('title')} | updated: {article.get('updated_at')} | chunks: {chunk_count}")
            print(article.get("body_markdown", "")[:300])
    return 0


def cmd_run_all(args: argparse.Namespace) -> int:
    config = _apply_overrides(load_config(args.config), args)
    logger = setup_logger(args.verbose)
    urls = asyncio.run(discover_urls(config, logger))
    if config.get("max_urls"):
        urls = urls[: config["max_urls"]]
    write_urls(get_path(config, "urls_path"), urls)
    asyncio.run(scrape_urls(urls, config, logger, resume=args.resume))
    return cmd_chunk(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Support Clever RAG scraper")
    parser.add_argument("--config", help="Path to config YAML", default=None)
    parser.add_argument("--verbose", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common_flags(p):
        p.add_argument("--concurrency", type=int)
        p.add_argument("--rate-limit", type=float)
        p.add_argument("--use-playwright", type=str)
        p.add_argument("--save-raw-html", action="store_true")
        p.add_argument("--save-screenshots", action="store_true")
        p.add_argument("--resume", action="store_true")
        p.add_argument("--max-urls", type=int)
        p.add_argument("--urls", type=str, help="Path to urls.json")
        p.add_argument("--sources", type=str, help="Comma-separated source keys (e.g. support,dev)")

    discover = subparsers.add_parser("discover", help="Discover article URLs")
    add_common_flags(discover)
    discover.set_defaults(func=cmd_discover)

    scrape = subparsers.add_parser("scrape", help="Scrape articles")
    add_common_flags(scrape)
    scrape.set_defaults(func=cmd_scrape)

    chunk = subparsers.add_parser("chunk", help="Chunk articles for RAG")
    add_common_flags(chunk)
    chunk.set_defaults(func=cmd_chunk)

    run_all = subparsers.add_parser("run-all", help="Discover, scrape, and chunk")
    add_common_flags(run_all)
    run_all.set_defaults(func=cmd_run_all)

    validate = subparsers.add_parser("validate", help="Validate outputs")
    validate.set_defaults(func=cmd_validate)

    return parser


def _extract_global_args(argv: List[str]) -> Tuple[Dict[str, Any], List[str]]:
    """Extract global flags from argv regardless of position.

    argparse subparsers only accept "global" options before the subcommand.
    This helper makes the CLI more forgiving so `--config`/`--verbose` can be
    provided either before or after the subcommand.
    """

    globals_: Dict[str, Any] = {}
    remaining: List[str] = []

    i = 0
    while i < len(argv):
        arg = argv[i]

        if arg == "--verbose":
            globals_["verbose"] = True
            i += 1
            continue

        if arg == "--config":
            if i + 1 >= len(argv):
                # Let argparse handle the error message format.
                remaining.append(arg)
                i += 1
                continue
            globals_["config"] = argv[i + 1]
            i += 2
            continue

        if arg.startswith("--config="):
            globals_["config"] = arg.split("=", 1)[1]
            i += 1
            continue

        remaining.append(arg)
        i += 1

    return globals_, remaining


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = build_parser()
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    globals_, remaining = _extract_global_args(raw_argv)

    args = parser.parse_args(remaining)

    if "config" in globals_:
        args.config = globals_["config"]
    if globals_.get("verbose"):
        args.verbose = True

    return args


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    return args.func(args)
