import asyncio
import logging
from pathlib import Path

from support_scraper.fetcher import FetchResult
from support_scraper.scraper import scrape_urls
import support_scraper.scraper as scraper_module


def _build_config(tmp_path: Path, use_playwright=False):
    data_dir = tmp_path / "data"
    return {
        "base_url": "https://support.clever.com",
        "user_agent": "SupportScraperTest/1.0",
        "obey_robots": False,
        "rate_limit_rps": 0,
        "concurrency": 1,
        "use_playwright": use_playwright,
        "save_raw_html": False,
        "save_screenshots": False,
        "extraction": {"selectors": ["article"]},
        "paths": {
            "data_dir": str(data_dir),
            "articles_path": str(data_dir / "articles.jsonl"),
            "errors_path": str(data_dir / "errors.jsonl"),
            "cache_path": str(data_dir / "cache.sqlite"),
            "raw_html_dir": str(data_dir / "raw_html"),
            "screenshots_dir": str(data_dir / "screenshots"),
        },
    }


def test_resume_does_not_skip_when_cached_article_missing(monkeypatch, tmp_path):
    url = "https://support.clever.com/s/article/abc"
    cache_rows = {
        url: {
            "url": url,
            "doc_id": "support-clever:abc",
            "content_hash": "old-hash",
            "etag": "etag-1",
            "last_modified": "Mon, 01 Jan 2024 00:00:00 GMT",
            "status": "success",
        }
    }
    writes = {}

    class FakeCache:
        def __init__(self, path):
            self.path = path

        async def open(self):
            return None

        async def close(self):
            return None

        async def get(self, incoming_url):
            return cache_rows.get(incoming_url)

        async def upsert(self, incoming_url, **fields):
            merged = dict(cache_rows.get(incoming_url, {"url": incoming_url}))
            merged.update({k: v for k, v in fields.items() if v is not None})
            cache_rows[incoming_url] = merged

    class FakeHttpFetcher:
        def __init__(self, config, limiter, logger):
            self.config = config
            self.limiter = limiter
            self.logger = logger

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def fetch(self, incoming_url, cache_entry=None):
            assert incoming_url == url
            # This is the regression we want to guard: no conditional fetch headers
            # when we do not have the cached article body on disk.
            assert cache_entry is None
            return FetchResult(
                url=incoming_url,
                status=200,
                html="<html><body><article>body</article></body></html>",
                headers={},
            )

    class UnexpectedPlaywrightFetcher:
        def __init__(self, config, limiter, logger):
            raise AssertionError("Playwright should not initialize when use_playwright is false")

    def fake_write_jsonl(path, rows):
        writes["path"] = path
        writes["rows"] = list(rows)

    monkeypatch.setattr(scraper_module, "Cache", FakeCache)
    monkeypatch.setattr(scraper_module, "HttpFetcher", FakeHttpFetcher)
    monkeypatch.setattr(scraper_module, "PlaywrightFetcher", UnexpectedPlaywrightFetcher)
    monkeypatch.setattr(scraper_module, "read_jsonl", lambda path: [])
    monkeypatch.setattr(scraper_module, "write_jsonl", fake_write_jsonl)
    monkeypatch.setattr(
        scraper_module,
        "extract_article",
        lambda html, incoming_url, cfg: {
            "doc_id": "support-clever:abc",
            "url": incoming_url,
            "title": "A",
            "updated_at": None,
            "content_hash": "new-hash",
        },
    )

    config = _build_config(tmp_path, use_playwright=False)
    logger = logging.getLogger("test_resume_does_not_skip_when_cached_article_missing")
    stats = asyncio.run(scrape_urls([url], config, logger, resume=True))

    assert stats.success == 1
    assert stats.skipped == 0
    assert len(writes["rows"]) == 1
    assert writes["rows"][0]["doc_id"] == "support-clever:abc"


def test_playwright_not_initialized_when_disabled(monkeypatch, tmp_path):
    url = "https://support.clever.com/s/article/def"
    playwright_inits = {"count": 0}
    writes = {}

    class FakeCache:
        def __init__(self, path):
            self.path = path
            self.rows = {}

        async def open(self):
            return None

        async def close(self):
            return None

        async def get(self, incoming_url):
            return self.rows.get(incoming_url)

        async def upsert(self, incoming_url, **fields):
            merged = dict(self.rows.get(incoming_url, {"url": incoming_url}))
            merged.update({k: v for k, v in fields.items() if v is not None})
            self.rows[incoming_url] = merged

    class FakeHttpFetcher:
        def __init__(self, config, limiter, logger):
            self.config = config
            self.limiter = limiter
            self.logger = logger

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def fetch(self, incoming_url, cache_entry=None):
            return FetchResult(
                url=incoming_url,
                status=200,
                html="<html><body><article>body</article></body></html>",
                headers={},
            )

    class CountingPlaywrightFetcher:
        def __init__(self, config, limiter, logger):
            playwright_inits["count"] += 1

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

    def fake_write_jsonl(path, rows):
        writes["rows"] = list(rows)

    monkeypatch.setattr(scraper_module, "Cache", FakeCache)
    monkeypatch.setattr(scraper_module, "HttpFetcher", FakeHttpFetcher)
    monkeypatch.setattr(scraper_module, "PlaywrightFetcher", CountingPlaywrightFetcher)
    monkeypatch.setattr(scraper_module, "read_jsonl", lambda path: [])
    monkeypatch.setattr(scraper_module, "write_jsonl", fake_write_jsonl)
    monkeypatch.setattr(
        scraper_module,
        "extract_article",
        lambda html, incoming_url, cfg: {
            "doc_id": "support-clever:def",
            "url": incoming_url,
            "title": "B",
            "updated_at": None,
            "content_hash": "hash-def",
        },
    )

    config = _build_config(tmp_path, use_playwright=False)
    logger = logging.getLogger("test_playwright_not_initialized_when_disabled")
    stats = asyncio.run(scrape_urls([url], config, logger, resume=False))

    assert stats.success == 1
    assert playwright_inits["count"] == 0
    assert len(writes["rows"]) == 1
