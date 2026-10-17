from __future__ import annotations

import math

import pytest

from blox_proxy.polyline import Polyline, angle_diff_deg, cumulative_distances, densify


def test_densify_max_spacing_and_keeps_vertices() -> None:
    pts = [(0.0, 0.0), (0.0, 25.0), (0.0, 25.0), (31.0, 25.0)]
    d = densify(pts, 10.0)
    assert d[0] == (0.0, 0.0) and d[-1] == (31.0, 25.0)
    assert (0.0, 25.0) in d
    steps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(d, d[1:])]
    assert max(steps) <= 10.0 + 1e-9
    assert min(steps) > 0
    assert cumulative_distances(d)[-1] == pytest.approx(56.0)


def test_densify_rejects_bad_step() -> None:
    with pytest.raises(ValueError):
        densify([(0, 0), (1, 1)], 0)


def test_project_simple() -> None:
    line = Polyline(densify([(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)], 10.0))
    p = line.project(50.0, 3.0)
    assert p is not None
    assert p.dist_along_m == pytest.approx(50.0)
    assert p.offset_m == pytest.approx(3.0)
    assert p.heading_deg == pytest.approx(90.0)
    p2 = line.project(104.0, 40.0)
    assert p2 is not None and p2.dist_along_m == pytest.approx(140.0)


def test_project_window_and_bearing_on_out_and_back() -> None:
    # 0..100 east then back west on the same line: x=30 is at 30 m and at 170 m
    line = Polyline(densify([(0.0, 0.0), (100.0, 0.0), (0.0, 0.0)], 10.0))
    east = line.project(30.0, 0.0, bearing_deg=90.0)
    west = line.project(30.0, 0.0, bearing_deg=270.0)
    assert east is not None and east.dist_along_m == pytest.approx(30.0)
    assert west is not None and west.dist_along_m == pytest.approx(170.0)
    windowed = line.project(30.0, 0.0, window=(150.0, 200.0))
    assert windowed is not None and windowed.dist_along_m == pytest.approx(170.0)


def test_angle_diff() -> None:
    assert angle_diff_deg(350, 10) == pytest.approx(20)
    assert angle_diff_deg(90, 270) == pytest.approx(180)
