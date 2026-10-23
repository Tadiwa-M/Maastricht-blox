"""Polyline helpers in a planar metric CRS (RD metres or Unity metres), numpy based."""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np
from numpy.typing import NDArray

Points = NDArray[np.float64]  # (n, 2)


def densify(points: Sequence[Sequence[float]] | Points, max_step_m: float) -> Points:
    """Insert evenly spaced points so no segment is longer than ``max_step_m``.
    Original vertices are kept; consecutive duplicates are dropped."""
    if max_step_m <= 0:
        raise ValueError("max_step_m must be > 0")
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    if len(pts) == 0:
        return pts
    keep = np.ones(len(pts), bool)
    keep[1:] = np.any(np.diff(pts, axis=0) != 0, axis=1)
    pts = pts[keep]
    out = [pts[:1]]
    for a, b in zip(pts[:-1], pts[1:]):
        n = max(1, math.ceil(float(np.hypot(*(b - a))) / max_step_m))
        t = (np.arange(1, n + 1) / n)[:, None]
        out.append(a + (b - a) * t)
    return np.concatenate(out)


def cumulative(points: Points) -> NDArray[np.float64]:
    """Cumulative distance at each point (first = 0)."""
    if len(points) < 2:
        return np.zeros(len(points))
    return np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(points, axis=0).T))])


def project(points: Points, cum: NDArray[np.float64], p: tuple[float, float], from_dist: float = 0.0,
            tolerance_m: float = 5.0) -> tuple[float, float]:
    """Distance along the polyline of the projection of ``p`` at or after ``from_dist``.

    Takes the *earliest* segment whose distance to ``p`` is within ``tolerance_m`` of the best
    one, so a stop on an out-and-back street maps to the leg the trip is on (stops are
    projected in calling order with ``from_dist`` = the previous stop's distance).
    Returns ``(dist_along, offset)``.
    """
    a, b = points[:-1], points[1:]
    ab = b - a
    seg_len2 = np.maximum((ab**2).sum(axis=1), 1e-12)
    q = np.asarray(p, dtype=np.float64)
    t = np.clip(((q - a) * ab).sum(axis=1) / seg_len2, 0.0, 1.0)
    foot = a + ab * t[:, None]
    off = np.hypot(*(foot - q).T)
    along = cum[:-1] + t * np.sqrt(seg_len2)
    ok = along >= from_dist - 1e-6
    if not ok.any():
        return float(cum[-1]), float(np.hypot(*(points[-1] - q)))
    best = off[ok].min()
    cand = np.nonzero(ok & (off <= best + tolerance_m))[0]
    i = int(cand[0])
    return float(along[i]), float(off[i])


def inside_run(points: Points, box: tuple[float, float, float, float]) -> tuple[int, int] | None:
    """Index range ``[i0, i1]`` from one point before the first point inside ``box`` to one
    after the last inside (so the clipped line runs off the edge), or None if none is inside."""
    xmin, ymin, xmax, ymax = box
    inside = (points[:, 0] >= xmin) & (points[:, 0] <= xmax) & (points[:, 1] >= ymin) & (points[:, 1] <= ymax)
    idx = np.nonzero(inside)[0]
    if len(idx) == 0:
        return None
    return max(0, int(idx[0]) - 1), min(len(points) - 1, int(idx[-1]) + 1)
