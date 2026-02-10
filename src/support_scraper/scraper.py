import asyncio
import os
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .cache import Cache
from .extractor import extract_article
from .fetcher import BlockedError, FetchError, HttpFetcher, PlaywrightFetcher
from .logger import log_event
from .rate_limiter import RateLimiter
from .robots import allowed_by_robots, load_robots
from .utils import append_jsonl, ensure_dir, now_iso, read_jsonl, safe_filename, write_jsonl


@dataclass
class ScrapeStats:
    total: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    updated: int = 0
    unchanged: int = 0
    auth_required: int = 0
    errors: List[Dict[str, Any]] = field(default_factory=list)


async def scrape_urls(urls: List[str], config: Dict[str, Any], logger, resume: bool = False) -> ScrapeStats:
    stats = ScrapeStats(total=len(urls))
    data_dir = config["paths"]["data_dir"]
    articles_path = config["paths"]["articles_path"]
    errors_path = config["paths"]["errors_path"]
    raw_html_dir = config["paths"]["raw_html_dir"]
    screenshots_dir = config["paths"]["screenshots_dir"]

    ensure_dir(data_dir)
    if config.get("save_raw_html"):
        ensure_dir(raw_html_dir)
    if config.get("save_screenshots"):
        ensure_dir(screenshots_dir)
    if not resume:
        with open(errors_path, "w", encoding="utf-8") as f:
            f.write("")

    existing_articles = {item["doc_id"]: item for item in read_jsonl(articles_path)}

    cache = Cache(config["paths"]["cache_path"])
    await cache.open()
    try:
        robots_parsers_by_host: Dict[str, Any] = {}
        if config.get("obey_robots", True):
            robots_origins: Dict[str, str] = {}
            for url in urls:
                parsed = urlparse(url)
                if parsed.scheme and parsed.netloc:
                    robots_origins[parsed.netloc.lower()] = f"{parsed.scheme}://{parsed.netloc}"
            if not robots_origins:
                base_url = config.get("base_url")
                if isinstance(base_url, str) and base_url:
                    parsed_base = urlparse(base_url)
                    if parsed_base.scheme and parsed_base.netloc:
                        robots_origins[parsed_base.netloc.lower()] = f"{parsed_base.scheme}://{parsed_base.netloc}"
            for host, origin in robots_origins.items():
                robots_parsers_by_host[host] = await load_robots(origin, config["user_agent"], logger=logger)

        limiter = RateLimiter(config.get("rate_limit_rps"))
        concurrency = config.get("concurrency", 4)
        semaphore = asyncio.Semaphore(concurrency)

        fetch_mode_value = config.get("use_playwright", "auto")
        if isinstance(fetch_mode_value, bool):
            fetch_mode = "true" if fetch_mode_value else "false"
        else:
            fetch_mode = str(fetch_mode_value).lower()
        should_enable_playwright = fetch_mode != "false" or config.get("save_screenshots")

        async with AsyncExitStack() as stack:
            http_fetcher = await stack.enter_async_context(HttpFetcher(config, limiter, logger))
            pw_fetcher: Optional[PlaywrightFetcher] = None
            if should_enable_playwright:
                pw_fetcher = await stack.enter_async_context(PlaywrightFetcher(config, limiter, logger))

            async def process(url: str):
                async with semaphore:
                    if config.get("obey_robots", True):
                        url_parts = urlparse(url)
                        host = url_parts.netloc.lower()
                        parser = robots_parsers_by_host.get(host)
                        if parser is None and host:
                            scheme = url_parts.scheme or "https"
                            parser = await load_robots(f"{scheme}://{host}", config["user_agent"], logger=logger)
                            robots_parsers_by_host[host] = parser
                        if parser and not allowed_by_robots(parser, url, config["user_agent"]):
                            stats.skipped += 1
                            await cache.upsert(url, status="blocked", last_scraped=now_iso())
                            return
                    cache_entry = await cache.get(url)
                    cached_doc_id = cache_entry.get("doc_id") if cache_entry else None
                    has_cached_article = bool(cached_doc_id and cached_doc_id in existing_articles)
                    if resume and cache_entry and cache_entry.get("status") == "success" and has_cached_article:
                        stats.skipped += 1
                        return
                    try:
                        html = None
                        fetch_result = None
                        if fetch_mode == "true":
                            if not pw_fetcher:
                                raise FetchError("Playwright fetch requested but Playwright is unavailable")
                            fetch_result = await pw_fetcher.fetch(
                                url,
                                selectors=config["extraction"]["selectors"],
                                screenshot_dir=screenshots_dir if config.get("save_screenshots") else None,
                            )
                            html = fetch_result.html
                        else:
                            try:
                                conditional_cache = cache_entry if has_cached_article else None
                                fetch_result = await http_fetcher.fetch(url, conditional_cache)
                                if fetch_result.not_modified:
                                    stats.skipped += 1
                                    stats.unchanged += 1
                                    await cache.upsert(url, status="success", last_scraped=now_iso())
                                    return
                                html = fetch_result.html
                            except BlockedError:
                                if fetch_mode == "false" or not pw_fetcher:
                                    raise
                                fetch_result = await pw_fetcher.fetch(
                                    url,
                                    selectors=config["extraction"]["selectors"],
                                    screenshot_dir=screenshots_dir if config.get("save_screenshots") else None,
                                )
                                html = fetch_result.html
                        if not html:
                            raise FetchError("Empty HTML")
                        raw_html_path = None
                        if config.get("save_raw_html"):
                            raw_html_path = os.path.join(raw_html_dir, f"{safe_filename(url)}.html")
                            with open(raw_html_path, "w", encoding="utf-8") as f:
                                f.write(html)
                        article = extract_article(html, url, config)
                        article["scraped_at"] = now_iso()
                        article["raw_html_path"] = raw_html_path
                        cached_hash = cache_entry.get("content_hash") if cache_entry else None
                        if cached_hash and cached_hash == article["content_hash"]:
                            stats.skipped += 1
                            stats.unchanged += 1
                            if article["doc_id"] not in existing_articles:
                                existing_articles[article["doc_id"]] = article
                        else:
                            existing_articles[article["doc_id"]] = article
                            stats.success += 1
                            stats.updated += 1 if cached_hash else 0
                        await cache.upsert(
                            url,
                            doc_id=article["doc_id"],
                            content_hash=article["content_hash"],
                            updated_at=article.get("updated_at"),
                            etag=(fetch_result.headers or {}).get("etag") if fetch_result else None,
                            last_modified=(fetch_result.headers or {}).get("last-modified") if fetch_result else None,
                            last_scraped=article["scraped_at"],
                            status="success",
                            error=None,
                        )
                    except ValueError as exc:
                        if config.get("save_screenshots") and pw_fetcher:
                            try:
                                await pw_fetcher.screenshot(url, screenshots_dir)
                            except Exception:
                                pass
                        stats.failed += 1
                        error = {"url": url, "error": str(exc), "timestamp": now_iso()}
                        stats.errors.append(error)
                        append_jsonl(errors_path, error)
                        await cache.upsert(url, status="error", last_scraped=now_iso(), error=str(exc))
                    except BlockedError:
                        stats.failed += 1
                        stats.auth_required += 1
                        error = {"url": url, "error": "auth_required", "timestamp": now_iso()}
                        stats.errors.append(error)
                        append_jsonl(errors_path, error)
                        await cache.upsert(url, status="auth_required", last_scraped=now_iso(), error="auth_required")
                    except Exception as exc:
                        stats.failed += 1
                        error = {"url": url, "error": str(exc), "timestamp": now_iso()}
                        stats.errors.append(error)
                        append_jsonl(errors_path, error)
                        await cache.upsert(url, status="error", last_scraped=now_iso(), error=str(exc))

            tasks = [process(url) for url in urls]
            if tasks:
                await asyncio.gather(*tasks)
    finally:
        await cache.close()
    # Write articles.jsonl with latest records
    write_jsonl(articles_path, existing_articles.values())
    log_event(
        logger,
        "scrape_complete",
        total=stats.total,
        success=stats.success,
        failed=stats.failed,
        skipped=stats.skipped,
        unchanged=stats.unchanged,
        updated=stats.updated,
    )
    return stats
