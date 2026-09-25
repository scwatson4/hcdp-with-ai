"""A small in-memory rate limiter for the navigator endpoint.

The site has no sign-in, and every /api/navigate call costs model credits, so:
per client IP a sliding window per minute and per hour, plus a global daily
budget after which the backend answers from the catalog by keyword instead.
Uvicorn runs with --proxy-headers so request.client.host is the real visitor
address behind Caddy. State is per process (two workers → roughly double the
nominal limits), which is fine for a prototype.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, per_minute: int = 12, per_hour: int = 120, global_per_day: int = 5000, clock=time.time):
        self.per_minute, self.per_hour, self.global_per_day = per_minute, per_hour, global_per_day
        self.clock = clock
        self._hits: dict[str, deque] = defaultdict(deque)
        self._day = None
        self.today_count = 0

    def _roll_day(self, now: float) -> None:
        day = int(now // 86400)
        if day != self._day:
            self._day, self.today_count = day, 0

    def check(self, ip: str) -> str:
        """Returns "" (allowed), "ip" (this client is over its limit) or "global" (daily budget spent)."""
        now = self.clock()
        self._roll_day(now)
        q = self._hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= self.per_hour or sum(1 for t in q if now - t <= 60) >= self.per_minute:
            return "ip"
        if self.today_count >= self.global_per_day:
            return "global"
        q.append(now)
        self.today_count += 1
        if len(self._hits) > 50000:  # forget idle clients
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 3600]:
                del self._hits[k]
        return ""
