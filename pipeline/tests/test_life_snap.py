"""Bus shapes pulled onto road centrelines (life/snap.py)."""

from __future__ import annotations

import numpy as np
from shapely.geometry import LineString

from blox_pipeline.life.polyline import densify
from blox_pipeline.life.snap import snap_path

MAIN = LineString([(0, 0), (200, 0)])  # east-west street
CROSS = LineString([(100, -100), (100, 100)])  # north-south street


def test_offset_shape_lands_on_the_street() -> None:
    pts = densify([(0, 5), (200, 5)], 10.0)  # GTFS runs 5 m off the centreline
    out = snap_path(pts, [MAIN, CROSS])
    assert np.abs(out[:, 1]).max() < 1e-6
    assert np.allclose(out[:, 0], pts[:, 0])  # moved sideways only


def test_junction_keeps_to_the_street_the_bus_is_on() -> None:
    pts = densify([(0, 4), (200, 4)], 10.0)
    out = snap_path(pts, [MAIN, CROSS])
    near = np.abs(out[:, 0] - 100) < 15  # at the crossing the cross street is as close: not taken
    assert np.abs(out[near, 1]).max() < 1e-6


def test_far_or_missing_roads_leave_points_alone() -> None:
    pts = densify([(0, 40), (200, 40)], 10.0)
    assert np.allclose(snap_path(pts, [MAIN]), pts)
    assert np.allclose(snap_path(pts, []), pts)


def test_single_point_jump_is_smoothed_away() -> None:
    side = LineString([(95, 9), (105, 9)])  # a short parallel service road next to one point
    pts = densify([(0, 6), (200, 6)], 10.0)
    out = snap_path(pts, [MAIN, side])
    assert np.abs(out[:, 1]).max() < 1e-6
