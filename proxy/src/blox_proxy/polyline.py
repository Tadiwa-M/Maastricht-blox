"""Polyline maths in a planar metric CRS (RD / world metres).

A polyline is a list of ``(x, y)`` points plus a parallel list of cumulative distances.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass
from typing import Sequence

Point = tuple[float, float]


def cumulative_distances(points: Sequence[Point]) -> list[float]:
    out = [0.0]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        out.append(out[-1] + math.hypot(x1 - x0, y1 - y0))
    return out


def densify(points: Sequence[Point], max_step_m: float) -> list[Point]:
    """Insert evenly spaced points so no segment is longer than ``max_step_m``.

    Original vertices are kept; consecutive duplicate points are dropped.
    """
    if max_step_m <= 0:
        raise ValueError("max_step_m must be > 0")
    out: list[Point] = []
    for p in points:
        if out and out[-1] == p:
            continue
        if out:
            x0, y0 = out[-1]
            seg = math.hypot(p[0] - x0, p[1] - y0)
            n = math.ceil(seg / max_step_m)
            for s in range(1, n):
                t = s / n
                out.append((x0 + (p[0] - x0) * t, y0 + (p[1] - y0) * t))
        out.append((float(p[0]), float(p[1])))
    return out


@dataclass(frozen=True)
class Projection:
    dist_along_m: float  # cumulative distance of the projected point
    offset_m: float  # perpendicular distance from the query point to the polyline
    segment: int  # index i of segment (points[i], points[i+1])
    heading_deg: float  # compass bearing of that segment (0 = north, 90 = east)


def _heading(dx: float, dy: float) -> float:
    return math.degrees(math.atan2(dx, dy)) % 360.0


def angle_diff_deg(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return 360.0 - d if d > 180.0 else d


class Polyline:
    """A densified polyline that supports nearest-point projection."""

    def __init__(self, points: Sequence[Point], cum: Sequence[float] | None = None) -> None:
        if len(points) < 2:
            raise ValueError("polyline needs at least 2 points")
        self.points: list[Point] = list(points)
        self.cum: list[float] = list(cum) if cum is not None else cumulative_distances(self.points)
        self.length_m = self.cum[-1]

    def _project_segment(self, i: int, x: float, y: float) -> tuple[float, float]:
        """Return ``(offset, along)`` for projecting (x, y) onto segment i."""
        (ax, ay), (bx, by) = self.points[i], self.points[i + 1]
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / seg2))
        px, py = ax + t * dx, ay + t * dy
        return math.hypot(x - px, y - py), self.cum[i] + t * (self.cum[i + 1] - self.cum[i])

    def segment_heading(self, i: int) -> float:
        (ax, ay), (bx, by) = self.points[i], self.points[i + 1]
        return _heading(bx - ax, by - ay)

    def _segment_range(self, d_min: float, d_max: float) -> range:
        lo = bisect_right(self.cum, d_min) - 1
        hi = bisect_right(self.cum, d_max)
        return range(max(lo, 0), min(hi, len(self.points) - 1))

    def project(
        self,
        x: float,
        y: float,
        *,
        window: tuple[float, float] | None = None,
        bearing_deg: float | None = None,
        bearing_penalty_m: float = 50.0,
    ) -> Projection | None:
        """Nearest point on the polyline (optionally restricted to a distance window).

        If ``bearing_deg`` is given, segments heading more than 90 degrees away from it
        get ``bearing_penalty_m`` added to their score. That separates the two directions
        of an out-and-back or looping route that share the same street.
        """
        seg_range = self._segment_range(*window) if window else range(len(self.points) - 1)
        best: tuple[float, float, float, int] | None = None  # score, offset, along, i
        for i in seg_range:
            off, along = self._project_segment(i, x, y)
            score = off
            if bearing_deg is not None and angle_diff_deg(self.segment_heading(i), bearing_deg) > 90.0:
                score += bearing_penalty_m
            if best is None or score < best[0]:
                best = (score, off, along, i)
        if best is None:
            return None
        _, off, along, i = best
        return Projection(along, off, i, self.segment_heading(i))

