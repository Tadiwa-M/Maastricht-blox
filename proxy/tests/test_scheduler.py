from __future__ import annotations

import pytest

from blox_proxy.scheduler import Poller, Scheduler


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


async def test_success_failure_backoff_and_last_good_kept() -> None:
    clock = Clock()
    calls = {"n": 0}
    data: dict[str, int] = {}

    async def step() -> None:
        calls["n"] += 1
        if calls["n"] in (2, 3):
            raise RuntimeError("upstream down")
        data["v"] = calls["n"]

    p = Poller("src", 20.0, step, backoff_initial_s=30.0, backoff_max_s=100.0, clock=clock)
    assert await p.run_once() and p.status.ok and p.status.last_fetch == 1000
    assert p.next_delay() == 20.0
    clock.t = 1020
    assert not await p.run_once()
    assert p.status.error == "RuntimeError: upstream down" and p.status.last_fetch == 1000
    assert data["v"] == 1  # last good data untouched
    assert p.next_delay() == 30.0
    assert not await p.run_once()
    assert p.next_delay() == 60.0
    p.status.consecutive_errors = 10
    assert p.next_delay() == 100.0
    p.status.consecutive_errors = 2
    clock.t = 1100
    assert await p.run_once() and p.status.error is None and p.status.last_fetch == 1100


def test_health_reports_stale_and_aggregates() -> None:
    s = Scheduler()

    async def noop() -> None:
        return None

    a = s.add(Poller("a", 20.0, noop))
    b = s.add(Poller("b", 20.0, noop))
    a.status.ok, a.status.last_fetch, a.status.error = True, 1000, None
    h = s.health(now=1010)
    assert h["sources"]["a"] == {"ok": True, "lastFetch": 1000, "error": None}
    assert h["sources"]["b"] == {"ok": False, "lastFetch": 0, "error": "not fetched yet"}
    assert h["ok"] is False
    b.status.ok, b.status.last_fetch, b.status.error = True, 1000, None
    assert s.health(now=1010)["ok"] is True
    stale = s.health(now=1000 + 500)
    assert stale["ok"] is False and stale["sources"]["a"]["error"].startswith("stale")


async def test_scheduler_start_stop() -> None:
    s = Scheduler()
    ran: list[int] = []

    async def step() -> None:
        ran.append(1)

    s.add(Poller("x", 3600.0, step))
    s.start()
    import asyncio

    await asyncio.sleep(0.01)
    await s.stop()
    assert ran == [1]


@pytest.mark.parametrize("interval", [1.0, 15.0])
def test_rt_interval_clamped_to_fair_use(interval: float) -> None:
    from blox_proxy.config import Settings

    assert Settings(gtfs_rt_interval_s=interval).effective_rt_interval_s == 15.0
