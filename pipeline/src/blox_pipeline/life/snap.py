"""Pull GTFS bus shapes onto the OSM road centrelines.

GTFS shapes in the city run a median 4 m (often 6+ m) off the road centrelines; the viewer then
moves each bus to its lane, so buses ended up on the pavement, through trees and people. Each
densified shape point moves to the nearest road centreline within ``SNAP_M`` that runs the same
way as the shape there (so a point at a junction doesn't jump onto the cross street), keeping to
the road the previous point used when it is nearly as close. Points with no road nearby (outside
the slice, or a road OSM lacks) stay where they are; a running median over the moves removes
single-point jumps. Cumulative distances are not changed: they time the trip, the snapped points
only place the bus.
"""

from __future__ import annotations

import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

from ..sources.model import OsmData
from .streets import DRIVE
from .walkways import _lines

SNAP_M = 12.0
MIN_COS = 0.6  # the road must run within ~53 degrees of the shape there
STICKY_M = 2.0  # keep the previous road unless another is this much closer
SMOOTH = 5  # points in the running median of the moves
BUS_ONLY = {"busway", "bus_guideway"}


def road_lines(osm: OsmData, clip: Polygon) -> list[LineString]:
    """Centrelines buses can drive: the car roads plus bus-only ways and pedestrian streets with bus access."""
    out: list[LineString] = []
    for f in osm.roads:
        hw = f.tags.get("highway", "")
        bus = f.tags.get("bus") in ("yes", "designated") or f.tags.get("psv") in ("yes", "designated")
        if hw in DRIVE or hw in BUS_ONLY or (hw == "pedestrian" and bus):
            out += _lines(f.geom.intersection(clip))
    return out


def _dir(line: LineString, s: float) -> tuple[float, float]:
    a, b = line.interpolate(max(0.0, s - 1.0)), line.interpolate(min(line.length, s + 1.0))
    n = math.hypot(b.x - a.x, b.y - a.y) or 1.0
    return (b.x - a.x) / n, (b.y - a.y) / n


def snap_path(pts: np.ndarray, lines: list[LineString], tree: shapely.STRtree | None = None,
              max_m: float = SNAP_M) -> np.ndarray:
    """``pts`` (N x 2, RD) moved onto ``lines`` where a matching road is within ``max_m``."""
    if not lines or len(pts) < 2:
        return pts.copy()
    tree = tree or shapely.STRtree(lines)
    out = pts.astype(np.float64).copy()
    prev = -1
    for n, (x, y) in enumerate(pts):
        a, b = pts[max(0, n - 1)], pts[min(len(pts) - 1, n + 1)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L == 0:
            continue
        tx, ty = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        p = Point(x, y)
        best, best_d, best_q = -1, math.inf, None
        for k in tree.query(p, predicate="dwithin", distance=max_m):
            line = lines[int(k)]
            s = line.project(p)
            q = line.interpolate(s)
            dx, dy = _dir(line, s)
            if abs(dx * tx + dy * ty) < MIN_COS:
                continue
            d = q.distance(p) - (STICKY_M if int(k) == prev else 0.0)
            if d < best_d:
                best, best_d, best_q = int(k), d, q
        if best_q is not None:
            out[n] = (best_q.x, best_q.y)
        prev = best
    return pts + _median_moves(out - pts)


def _median_moves(d: np.ndarray, k: int = SMOOTH) -> np.ndarray:
    """Per-axis running median of the moves: an isolated point that jumped to another road (or
    stayed while its neighbours moved) follows its neighbours instead of making a spike."""
    if len(d) < k:
        return d
    h = k // 2
    pad = np.concatenate([np.repeat(d[:1], h, 0), d, np.repeat(d[-1:], h, 0)])
    win = np.lib.stride_tricks.sliding_window_view(pad, k, axis=0)  # (N, 2, k)
    return np.median(win, axis=2)


__all__ = ["SNAP_M", "road_lines", "snap_path"]
