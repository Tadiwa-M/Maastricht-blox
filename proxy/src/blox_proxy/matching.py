"""Map a vehicle position to its trip's shape and track distance along it.

Projecting a point onto a looping or out-and-back polyline is ambiguous: the same
street may be at 1.2 km and at 7.9 km. The matcher therefore remembers each vehicle's
previous projection and first searches a window just around it, and it uses the travel
direction (GPS bearing, or heading of the last displacement) to prefer segments that
point the same way. Only if that fails does it fall back to a global search.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .polyline import Polyline, Projection


@dataclass
class _Track:
    shape_id: str
    trip_id: str
    dist_m: float
    x: float
    y: float
    ts: float
    match: "Match | None" = None


@dataclass(frozen=True)
class Match:
    dist_along_m: float
    heading_deg: float
    speed_mps: float | None  # estimated from progress along the shape, if possible


class ShapeMatcher:
    def __init__(
        self,
        max_offset_m: float = 60.0,
        back_window_m: float = 100.0,
        min_forward_window_m: float = 300.0,
        max_speed_mps: float = 40.0,
        forget_after_s: float = 1800.0,
    ) -> None:
        self.max_offset_m = max_offset_m
        self.back_window_m = back_window_m
        self.min_forward_window_m = min_forward_window_m
        self.max_speed_mps = max_speed_mps
        self.forget_after_s = forget_after_s
        self._tracks: dict[str, _Track] = {}

    def match(
        self,
        vehicle_key: str,
        trip_id: str,
        shape_id: str,
        line: Polyline,
        x: float,
        y: float,
        ts: float,
        bearing_deg: float | None = None,
    ) -> Match | None:
        prev = self._tracks.get(vehicle_key)
        if prev and (prev.trip_id != trip_id or prev.shape_id != shape_id):
            prev = None
        if prev is not None and prev.match is not None and ts == prev.ts and (x, y) == (prev.x, prev.y):
            # Same report seen again (304 / unchanged feed entry): keep the earlier result,
            # including its speed estimate, instead of re-matching with dt = 0.
            return prev.match
        bearing = bearing_deg if bearing_deg is not None else _motion_bearing(prev, x, y)

        proj: Projection | None = None
        if prev is not None:
            dt = max(ts - prev.ts, 0.0)
            ahead = max(self.min_forward_window_m, dt * self.max_speed_mps)
            proj = line.project(x, y, window=(prev.dist_m - self.back_window_m, prev.dist_m + ahead), bearing_deg=bearing)
            if proj is not None and proj.offset_m > self.max_offset_m:
                proj = None
        if proj is None:
            proj = line.project(x, y, bearing_deg=bearing)
            if proj is None or proj.offset_m > self.max_offset_m:
                self._tracks.pop(vehicle_key, None)
                return None

        speed = None
        if prev is not None and ts > prev.ts:
            progress = proj.dist_along_m - prev.dist_m
            if progress >= 0:
                speed = progress / (ts - prev.ts)
        result = Match(proj.dist_along_m, proj.heading_deg, speed)
        if prev is None or ts >= prev.ts:
            self._tracks[vehicle_key] = _Track(shape_id, trip_id, proj.dist_along_m, x, y, ts, result)
        return result

    def forget_stale(self, now: float) -> None:
        cutoff = now - self.forget_after_s
        for k in [k for k, t in self._tracks.items() if t.ts < cutoff]:
            del self._tracks[k]


def _motion_bearing(prev: _Track | None, x: float, y: float, min_move_m: float = 5.0) -> float | None:
    if prev is None:
        return None
    dx, dy = x - prev.x, y - prev.y
    if math.hypot(dx, dy) < min_move_m:
        return None
    return math.degrees(math.atan2(dx, dy)) % 360.0
