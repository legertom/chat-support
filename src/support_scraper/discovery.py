import json
import re
import xml.etree.ElementTree as ET
from contextlib import AsyncExitStack
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from .config import get_sources
from .fetcher import FetchError, PlaywrightFetcher
from .logger import log_event
from .rate_limiter import RateLimiter
from .utils import is_same_domain, normalize_url, write_json


async def fetch_text(client: httpx.AsyncClient, url: str, logger=None) -> Optional[str]:
    try:
        resp = await client.get(url)
        if resp.status_code != 200:
            if logger:
                log_event(logger, "discovery_fetch_non_200", url=url, status=resp.status_code)
            return None
        return resp.text
    except Exception as exc:
        if logger:
            log_event(logger, "discovery_fetch_error", url=url, error=str(exc))
        return None


async def fetch_text_playwright(pw_fetcher: Optional[PlaywrightFetcher], url: str, logger=None) -> Optional[str]:
    if not pw_fetcher:
        return None
    try:
        result = await pw_fetcher.fetch(url, selectors=None)
        return result.html
    except FetchError as exc:
        if logger:
            log_event(logger, "discovery_playwright_fetch_error", url=url, error=str(exc))
        return None
    except Exception as exc:
        if logger:
            log_event(logger, "discovery_playwright_error", url=url, error=str(exc))
        return None


def parse_robots_sitemaps(robots_text: str) -> List[str]:
    sitemaps: List[str] = []
    for line in robots_text.splitlines():
        match = re.match(r"^\s*Sitemap:\s*(\S+)\s*$", line, flags=re.I)
        if match:
            sitemaps.append(match.group(1).strip())
    return sitemaps


def parse_sitemap(xml_text: str) -> Dict[str, List[str]]:
    urls: List[str] = []
    sitemaps: List[str] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {"urls": urls, "sitemaps": sitemaps}
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    if root.tag.endswith("sitemapindex"):
        for loc in root.findall(f".//{ns}loc"):
            if loc.text:
                sitemaps.append(loc.text.strip())
    if root.tag.endswith("urlset"):
        for loc in root.findall(f".//{ns}loc"):
            if loc.text:
                urls.append(loc.text.strip())
    return {"urls": urls, "sitemaps": sitemaps}


def is_article_url(url: str, patterns: List[str]) -> bool:
    for pattern in patterns:
        if pattern in url:
            return True
    return False


def extract_links(html: str, base_url: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    links = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not href:
            continue
        abs_url = normalize_url(urljoin(base_url, href))
        links.append(abs_url)
    return links


async def _discover_urls_for_source(
    config: Dict[str, Any],
    logger,
    source_name: str,
    source_cfg: Dict[str, Any],
) -> List[str]:
    base_url = source_cfg["base_url"]
    discovery_cfg = source_cfg.get("article_discovery", config["article_discovery"])
    patterns = discovery_cfg["article_url_patterns"]
    discovered: Set[str] = set()
    seen: Set[str] = set()

    headers = {"User-Agent": config["user_agent"]}
    fetch_mode_value = config.get("use_playwright", "auto")
    if isinstance(fetch_mode_value, bool):
        fetch_mode = "true" if fetch_mode_value else "false"
    else:
        fetch_mode = str(fetch_mode_value).lower()
    should_enable_playwright = fetch_mode != "false"

    async with AsyncExitStack() as stack:
        client = await stack.enter_async_context(httpx.AsyncClient(headers=headers, follow_redirects=True, timeout=30))
        pw_fetcher: Optional[PlaywrightFetcher] = None
        if should_enable_playwright:
            limiter = RateLimiter(config.get("rate_limit_rps"))
            pw_fetcher = await stack.enter_async_context(PlaywrightFetcher(config, limiter, logger))

        async def fetch_for_discovery(url: str) -> Optional[str]:
            html = await fetch_text(client, url, logger)
            if pw_fetcher:
                if not html:
                    return await fetch_text_playwright(pw_fetcher, url, logger)
                if patterns and not any(pattern in html for pattern in patterns):
                    rendered = await fetch_text_playwright(pw_fetcher, url, logger)
                    if rendered:
                        return rendered
            return html

        # 1) Sitemap discovery
        sitemap_candidates: List[str] = []
        robots_url = normalize_url(urljoin(base_url, "/robots.txt"))
        robots_text = await fetch_text(client, robots_url, logger)
        if robots_text:
            for sitemap in parse_robots_sitemaps(robots_text):
                sitemap_candidates.append(normalize_url(urljoin(base_url, sitemap)))
        sitemap_candidates.append(normalize_url(urljoin(base_url, "/s/sitemap.xml")))
        sitemap_candidates.append(normalize_url(urljoin(base_url, "/sitemap.xml")))
        sitemap_candidates = list(dict.fromkeys(sitemap_candidates))

        sitemap_seen: Set[str] = set()
        sitemap_queue: List[str] = list(sitemap_candidates)
        while sitemap_queue:
            sitemap_url = sitemap_queue.pop(0)
            if sitemap_url in sitemap_seen:
                continue
            sitemap_seen.add(sitemap_url)
            sitemap_text = await fetch_text(client, sitemap_url, logger)
            if not sitemap_text:
                continue
            parsed = parse_sitemap(sitemap_text)
            for url in parsed["urls"]:
                if is_same_domain(url, base_url) and is_article_url(url, patterns):
                    discovered.add(normalize_url(url))
            for child_sitemap in parsed["sitemaps"]:
                normalized_child = normalize_url(urljoin(base_url, child_sitemap))
                if normalized_child not in sitemap_seen:
                    sitemap_queue.append(normalized_child)
        log_event(
            logger,
            "discovery_sitemap",
            source=source_name,
            url=sitemap_candidates[0],
            count=len(discovered),
            sitemaps=len(sitemap_seen),
        )

        # 2) Category crawl
        queue: List[str] = []
        for path in discovery_cfg.get("category_paths", []):
            queue.append(normalize_url(urljoin(base_url, path)))
        if not queue:
            queue.append(normalize_url(base_url))
        category_roots = list(dict.fromkeys(queue))
        max_pages = 200
        while queue and len(seen) < max_pages:
            current = queue.pop(0)
            if current in seen:
                continue
            seen.add(current)
            html = await fetch_for_discovery(current)
            if not html:
                continue
            links = extract_links(html, base_url)
            for link in links:
                if not is_same_domain(link, base_url):
                    continue
                if is_article_url(link, patterns):
                    discovered.add(normalize_url(link))
                else:
                    if link not in seen and link not in queue and link.startswith(base_url):
                        if any(link.startswith(root) for root in category_roots):
                            queue.append(link)
        log_event(logger, "discovery_category", source=source_name, pages=len(seen), count=len(discovered))

        # 3) Search endpoint (optional)
        search_cfg = discovery_cfg.get("search", {})
        if search_cfg.get("enabled") and search_cfg.get("endpoint"):
            page = search_cfg.get("page_start", 0)
            page_size = search_cfg.get("page_size", 50)
            while True:
                params = {
                    search_cfg.get("query_param", "q"): "*",
                    search_cfg.get("page_param", "page"): page,
                }
                search_url = normalize_url(urljoin(base_url, search_cfg["endpoint"]))
                try:
                    resp = await client.get(search_url, params=params)
                    if resp.status_code != 200:
                        break
                    payload = resp.json()
                except Exception:
                    break
                results = json.dumps(payload)
                urls = re.findall(r"https?://[^\"']+", results)
                added = 0
                for url in urls:
                    if is_same_domain(url, base_url) and is_article_url(url, patterns):
                        norm = normalize_url(url)
                        if norm not in discovered:
                            discovered.add(norm)
                            added += 1
                if added == 0:
                    break
                if len(urls) < page_size:
                    break
                page += 1
            log_event(logger, "discovery_search", source=source_name, count=len(discovered))

        # 4) Fallback crawl
        if len(discovered) < 50:
            fallback_queue = [normalize_url(base_url)]
            fallback_seen: Set[str] = set()
            while fallback_queue and len(fallback_seen) < 200:
                current = fallback_queue.pop(0)
                if current in fallback_seen:
                    continue
                fallback_seen.add(current)
                html = await fetch_for_discovery(current)
                if not html:
                    continue
                links = extract_links(html, base_url)
                for link in links:
                    if not is_same_domain(link, base_url):
                        continue
                    if is_article_url(link, patterns):
                        discovered.add(normalize_url(link))
                    else:
                        if link not in fallback_seen and link not in fallback_queue:
                            fallback_queue.append(link)
            log_event(logger, "discovery_fallback", source=source_name, pages=len(fallback_seen), count=len(discovered))

    return sorted(discovered)


async def discover_urls(config: Dict[str, Any], logger) -> List[str]:
    merged: Set[str] = set()
    for source_name, source_cfg in get_sources(config, enabled_only=True):
        source_urls = await _discover_urls_for_source(config, logger, source_name, source_cfg)
        merged.update(source_urls)
        log_event(logger, "discovery_source_complete", source=source_name, count=len(source_urls))
    return sorted(merged)


def write_urls(path: str, urls: List[str]) -> None:
    write_json(path, {"count": len(urls), "urls": urls})
