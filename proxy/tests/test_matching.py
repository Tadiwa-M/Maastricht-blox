from __future__ import annotations

import pytest

from blox_proxy.matching import ShapeMatcher
from blox_proxy.polyline import Polyline, densify

# Out-and-back route, 1000 m each way along y = 0 (a "looping" route sharing one street)
LOOP = Polyline(densify([(0.0, 0.0), (1000.0, 0.0), (0.0, 0.0)], 10.0))


def test_tracks_monotonically_through_the_turnaround_without_bearing() -> None:
    m = ShapeMatcher()
    xs = [100, 300, 500, 700, 900, 990, 900, 700, 500, 300, 100]
    dists = []
    for k, x in enumerate(xs):
        r = m.match("v1", "t1", "s1", LOOP, float(x), 2.0, ts=1000.0 + 20 * k)
        assert r is not None
        dists.append(r.dist_along_m)
    assert dists == sorted(dists)
    assert dists[-1] == pytest.approx(1900.0, abs=1.0)  # on the way back, not 100 m


def test_first_fix_uses_bearing_to_pick_direction() -> None:
    r = ShapeMatcher().match("v2", "t1", "s1", LOOP, 300.0, 1.0, ts=0.0, bearing_deg=270.0)
    assert r is not None and r.dist_along_m == pytest.approx(1700.0, abs=1.0)


def test_speed_estimated_from_progress() -> None:
    m = ShapeMatcher()
    m.match("v3", "t1", "s1", LOOP, 100.0, 0.0, ts=0.0)
    r = m.match("v3", "t1", "s1", LOOP, 200.0, 0.0, ts=20.0)
    assert r is not None and r.speed_mps == pytest.approx(5.0)


def test_repeated_report_keeps_speed() -> None:
    # The proxy rebuilds vehicles every poll; an unchanged feed entry must not lose its speed.
    m = ShapeMatcher()
    m.match("v5", "t1", "s1", LOOP, 100.0, 0.0, ts=0.0)
    first = m.match("v5", "t1", "s1", LOOP, 200.0, 0.0, ts=20.0)
    again = m.match("v5", "t1", "s1", LOOP, 200.0, 0.0, ts=20.0)
    assert first is not None and again == first and again.speed_mps == pytest.approx(5.0)


def test_too_far_from_shape_returns_none() -> None:
    assert ShapeMatcher(max_offset_m=60).match("v4", "t1", "s1", LOOP, 500.0, 200.0, ts=0.0) is None


def test_trip_change_resets_track() -> None:
    m = ShapeMatcher()
    for k, x in enumerate([700, 900, 990, 800]):
        m.match("v5", "t1", "s1", LOOP, float(x), 0.0, ts=20.0 * k)
    r = m.match("v5", "t2", "s1", LOOP, 300.0, 0.0, ts=100.0, bearing_deg=90.0)
    assert r is not None and r.dist_along_m == pytest.approx(300.0, abs=1.0)


def test_forget_stale() -> None:
    m = ShapeMatcher(forget_after_s=60)
    m.match("v6", "t1", "s1", LOOP, 100.0, 0.0, ts=0.0)
    m.forget_stale(now=1000.0)
    assert m._tracks == {}
