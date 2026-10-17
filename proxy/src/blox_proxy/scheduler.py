"""Asyncio background pollers with per-source health and exponential backoff."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class SourceStatus:
    ok: bool = False
    last_fetch: int = 0  # Unix seconds of the last *successful* fetch (0 = never)
    error: str | None = "not fetched yet"
    consecutive_errors: int = 0

    def as_dict(self, now: float, stale_after_s: float) -> dict[str, Any]:
        ok, error = self.ok, self.error
        if ok and self.last_fetch and now - self.last_fetch > stale_after_s:
            ok, error = False, f"stale: last successful fetch {int(now - self.last_fetch)} s ago"
        return {"ok": ok, "lastFetch": self.last_fetch, "error": error}


@dataclass
class Poller:
    name: str
    interval_s: float
    step: Callable[[], Awaitable[None]]
    backoff_initial_s: float = 30.0
    backoff_max_s: float = 900.0
    status: SourceStatus = field(default_factory=SourceStatus)
    clock: Callable[[], float] = time.time

    async def run_once(self) -> bool:
        try:
            await self.step()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - any upstream failure must not kill the loop
            self.status.ok = False
            self.status.error = f"{type(e).__name__}: {e}"[:300]
            self.status.consecutive_errors += 1
            log.warning("source %s failed (%d in a row): %s", self.name, self.status.consecutive_errors, self.status.error)
            return False
        self.status.ok = True
        self.status.error = None
        self.status.consecutive_errors = 0
        self.status.last_fetch = int(self.clock())
        return True

    def next_delay(self) -> float:
        n = self.status.consecutive_errors
        if n == 0:
            return self.interval_s
        backoff = self.backoff_initial_s * (2 ** (n - 1))
        return min(max(backoff, self.interval_s), max(self.backoff_max_s, self.interval_s))

    @property
    def stale_after_s(self) -> float:
        return max(3 * self.interval_s, 120.0)

    async def run_forever(self) -> None:
        while True:
            await self.run_once()
            await asyncio.sleep(self.next_delay())


class Scheduler:
    def __init__(self) -> None:
        self.pollers: dict[str, Poller] = {}
        self._tasks: list[asyncio.Task[None]] = []

    def add(self, poller: Poller) -> Poller:
        self.pollers[poller.name] = poller
        return poller

    def start(self) -> None:
        for p in self.pollers.values():
            self._tasks.append(asyncio.create_task(p.run_forever(), name=f"poll:{p.name}"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def health(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        sources = {name: p.status.as_dict(now, p.stale_after_s) for name, p in self.pollers.items()}
        return {"ok": all(s["ok"] for s in sources.values()), "sources": sources}
