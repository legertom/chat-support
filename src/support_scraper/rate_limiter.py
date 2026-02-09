import asyncio
import time
from typing import Optional

from .utils import jitter_delay


class RateLimiter:
    def __init__(self, rate_per_sec: Optional[float]) -> None:
        self.rate_per_sec = rate_per_sec
        self._lock = asyncio.Lock()
        self._next_allowed = 0.0

    async def wait(self) -> None:
        if not self.rate_per_sec or self.rate_per_sec <= 0:
            return
        interval = 1.0 / self.rate_per_sec
        async with self._lock:
            now = time.monotonic()
            if now < self._next_allowed:
                delay = self._next_allowed - now
                await asyncio.sleep(jitter_delay(delay))
            self._next_allowed = time.monotonic() + interval
