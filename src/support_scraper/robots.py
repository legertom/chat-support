import urllib.robotparser
from typing import Optional
from urllib.parse import urljoin

import httpx

from .logger import log_event


async def load_robots(base_url: str, user_agent: str, logger=None) -> urllib.robotparser.RobotFileParser:
    robots_url = urljoin(base_url, "/robots.txt")
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    try:
        async with httpx.AsyncClient(timeout=20, headers={"User-Agent": user_agent}) as client:
            resp = await client.get(robots_url)
            if resp.status_code == 200:
                parser.parse(resp.text.splitlines())
            else:
                if logger:
                    log_event(logger, "robots_fetch_non_200", url=robots_url, status=resp.status_code)
                parser.parse("")
    except Exception as exc:
        if logger:
            log_event(logger, "robots_fetch_error", url=robots_url, error=str(exc))
        parser.parse("")
    return parser


def allowed_by_robots(parser: Optional[urllib.robotparser.RobotFileParser], url: str, user_agent: str) -> bool:
    if not parser:
        return True
    try:
        return parser.can_fetch(user_agent, url)
    except Exception:
        return True
