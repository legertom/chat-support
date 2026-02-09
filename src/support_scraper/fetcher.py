import asyncio
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from .logger import log_event
from .rate_limiter import RateLimiter
from .utils import ensure_dir, now_iso, safe_filename

BLOCKED_KEYWORDS = (
    "access denied",
    "forbidden",
    "blocked",
    "verify you are human",
)


class FetchError(Exception):
    pass


class BlockedError(FetchError):
    pass


@dataclass
class FetchResult:
    url: str
    status: Optional[int]
    html: Optional[str]
    final_url: Optional[str] = None
    headers: Optional[Dict[str, Any]] = None
    not_modified: bool = False
    used_playwright: bool = False
    screenshot_path: Optional[str] = None
    fetched_at: str = field(default_factory=now_iso)


class HttpFetcher:
    def __init__(self, config: Dict[str, Any], limiter: RateLimiter, logger) -> None:
        self.config = config
        self.limiter = limiter
        self.logger = logger
        self.client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        timeout = httpx.Timeout(self.config["fetch"]["timeout_seconds"])
        headers = {"User-Agent": self.config["user_agent"]}
        headers.update(self.config["fetch"].get("headers", {}))
        cookies = self.config["fetch"].get("cookies", {})
        self.client = httpx.AsyncClient(timeout=timeout, headers=headers, cookies=cookies, follow_redirects=True)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.client:
            await self.client.aclose()
            self.client = None

    async def fetch(self, url: str, cache_entry: Optional[Dict[str, Any]] = None) -> FetchResult:
        if not self.client:
            raise RuntimeError("HttpFetcher not initialized")
        retries = self.config["fetch"].get("retries", 3)
        backoff_base = self.config["fetch"].get("backoff_base", 1.5)
        backoff_max = self.config["fetch"].get("backoff_max_seconds", 30)
        headers = {}
        if cache_entry:
            if cache_entry.get("etag"):
                headers["If-None-Match"] = cache_entry["etag"]
            if cache_entry.get("last_modified"):
                headers["If-Modified-Since"] = cache_entry["last_modified"]
        for attempt in range(retries):
            try:
                await self.limiter.wait()
                response = await self.client.get(url, headers=headers)
                if response.status_code == 304:
                    return FetchResult(url=url, status=304, html=None, final_url=str(response.url), headers=dict(response.headers), not_modified=True)
                if response.status_code in (401, 403):
                    raise BlockedError(f"HTTP {response.status_code}")
                if response.status_code >= 500:
                    raise FetchError(f"HTTP {response.status_code}")
                html = response.text
                if _is_blocked_html(html):
                    raise BlockedError("Blocked or captcha detected")
                return FetchResult(url=url, status=response.status_code, html=html, final_url=str(response.url), headers=dict(response.headers))
            except (httpx.RequestError, FetchError) as exc:
                if attempt >= retries - 1:
                    raise
                delay = min(backoff_base ** attempt, backoff_max)
                await asyncio.sleep(delay)


def _is_blocked_html(html: str) -> bool:
    # Ignore script/style content so normal pages containing captcha scripts
    # are not treated as blocked.
    lower = html.lower()
    lower = re.sub(r"(?is)<script.*?>.*?</script>", " ", lower)
    lower = re.sub(r"(?is)<style.*?>.*?</style>", " ", lower)
    text = re.sub(r"(?is)<[^>]+>", " ", lower)
    text = re.sub(r"\s+", " ", text)

    if any(keyword in text for keyword in BLOCKED_KEYWORDS):
        return True
    if "captcha" in text and "i'm not a robot" in text:
        return True
    return False


class PlaywrightFetcher:
    def __init__(self, config: Dict[str, Any], limiter: RateLimiter, logger) -> None:
        self.config = config
        self.limiter = limiter
        self.logger = logger
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None

    async def __aenter__(self):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(headless=True)
        await self._ensure_context()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.context:
            await self.context.close()
            self.context = None
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None

    async def _ensure_context(self) -> None:
        if self.context:
            return
        storage_state = self.config["playwright"].get("storage_state_path")
        if storage_state and os.path.exists(storage_state):
            self.context = await self.browser.new_context(storage_state=storage_state)
        else:
            self.context = await self.browser.new_context()
        await self.context.set_extra_http_headers({"User-Agent": self.config["user_agent"]})
        if self.config["playwright"].get("login", {}).get("enabled"):
            await self._ensure_logged_in()

    async def _ensure_logged_in(self) -> None:
        login_cfg = self.config["playwright"].get("login", {})
        storage_state = self.config["playwright"].get("storage_state_path")
        if storage_state and os.path.exists(storage_state):
            return
        username = os.getenv(login_cfg.get("username_env", ""), "")
        password = os.getenv(login_cfg.get("password_env", ""), "")
        if not (username and password):
            log_event(self.logger, "auth_missing", message="Missing SUPPORT_USER/SUPPORT_PASS env vars")
            return
        if not all(
            [
                login_cfg.get("login_url"),
                login_cfg.get("username_selector"),
                login_cfg.get("password_selector"),
                login_cfg.get("submit_selector"),
            ]
        ):
            log_event(self.logger, "auth_missing", message="Login selectors not configured")
            return
        page = await self.context.new_page()
        await page.goto(login_cfg["login_url"], wait_until="networkidle")
        await page.fill(login_cfg["username_selector"], username)
        await page.fill(login_cfg["password_selector"], password)
        await page.click(login_cfg["submit_selector"])
        await page.wait_for_load_state("networkidle")
        if storage_state:
            await self.context.storage_state(path=storage_state)
        await page.close()

    async def fetch(self, url: str, selectors: Optional[list] = None, screenshot_dir: Optional[str] = None) -> FetchResult:
        if not self.context:
            raise RuntimeError("PlaywrightFetcher not initialized")
        retries = self.config["fetch"].get("retries", 3)
        backoff_base = self.config["fetch"].get("backoff_base", 1.5)
        backoff_max = self.config["fetch"].get("backoff_max_seconds", 30)
        for attempt in range(retries):
            await self.limiter.wait()
            page: Page = await self.context.new_page()
            try:
                await page.goto(url, wait_until="networkidle", timeout=self.config["fetch"]["timeout_seconds"] * 1000)
                if selectors:
                    await wait_for_any_selector(page, selectors, timeout=5000)
                html = await page.content()
                return FetchResult(url=url, status=200, html=html, final_url=page.url, used_playwright=True)
            except Exception as exc:
                screenshot_path = None
                if screenshot_dir:
                    ensure_dir(screenshot_dir)
                    screenshot_path = os.path.join(screenshot_dir, f"{safe_filename(url)}.png")
                    try:
                        await page.screenshot(path=screenshot_path, full_page=True)
                    except Exception:
                        screenshot_path = None
                if attempt >= retries - 1:
                    raise FetchError(str(exc))
                delay = min(backoff_base ** attempt, backoff_max)
                await asyncio.sleep(delay)
            finally:
                await page.close()

    async def screenshot(self, url: str, screenshot_dir: str) -> Optional[str]:
        if not self.context:
            raise RuntimeError("PlaywrightFetcher not initialized")
        ensure_dir(screenshot_dir)
        path = os.path.join(screenshot_dir, f"{safe_filename(url)}.png")
        await self.limiter.wait()
        page: Page = await self.context.new_page()
        try:
            await page.goto(url, wait_until="networkidle", timeout=self.config["fetch"]["timeout_seconds"] * 1000)
            await page.screenshot(path=path, full_page=True)
            return path
        except Exception:
            return None
        finally:
            await page.close()


async def wait_for_any_selector(page: Page, selectors: list, timeout: int = 5000) -> None:
    if not selectors:
        return
    tasks: List[asyncio.Task] = [asyncio.create_task(page.wait_for_selector(sel, timeout=timeout)) for sel in selectors]
    try:
        for task in asyncio.as_completed(tasks):
            try:
                await task
                return
            except Exception:
                continue
        raise FetchError("No selector matched")
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
