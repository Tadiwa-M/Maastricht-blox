"""Build the ``/v1/shapes`` and ``/v1/stops`` payloads from a ``GtfsIndex``."""

from __future__ import annotations

from typing import Any

from .config import BBoxRD
from .geo import rd_to_world, round_world
from .gtfs.model import GtfsIndex, Shape


def clip_indices(points: list[tuple[float, float]], bbox: BBoxRD) -> list[int]:
    """Indices of points inside ``bbox`` plus the first point outside at each crossing.

    Cumulative distances are kept from the full shape, so ``distAlongShapeM`` stays valid;
    if a shape leaves and re-enters the area, the cumDist jump marks the gap.
    """
    inside = [bbox.contains(x, y) for x, y in points]
    n = len(points)
    return [i for i in range(n) if inside[i] or (i > 0 and inside[i - 1]) or (i + 1 < n and inside[i + 1])]


def shape_points(shape: Shape, bbox: BBoxRD) -> list[list[float]]:
    pts, cum = shape.line.points, shape.line.cum
    out: list[list[float]] = []
    for i in clip_indices(pts, bbox):
        wx, wz = rd_to_world(*pts[i])
        out.append([round_world(wx), round_world(wz), round(cum[i], 1)])
    return out


def shapes_payload(index: GtfsIndex, bbox: BBoxRD) -> dict[str, Any]:
    routes = index.shape_routes()
    shapes = []
    for sid in sorted(index.shapes):
        pts = shape_points(index.shapes[sid], bbox)
        if len(pts) < 2:
            continue
        r = routes.get(sid)
        shapes.append(
            {
                "shapeId": sid,
                "routeShort": r.short_name if r else None,
                "mode": r.mode if r else "bus",
                "color": r.color if r else "#808080",
                "points": pts,
            }
        )
    return {"shapes": shapes}


def stops_payload(index: GtfsIndex, bbox: BBoxRD) -> dict[str, Any]:
    stops = []
    for sid in sorted(index.stops):
        s = index.stops[sid]
        if not bbox.contains(s.x, s.y):
            continue
        wx, wz = rd_to_world(s.x, s.y)
        stops.append({"stopId": s.stop_id, "name": s.name, "world": [round_world(wx), round_world(wz)]})
    return {"stops": stops}
