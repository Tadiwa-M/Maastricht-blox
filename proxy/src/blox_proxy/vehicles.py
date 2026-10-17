"""Turn decoded GTFS-RT observations into contract ``/v1/vehicles`` records."""

from __future__ import annotations

from typing import Any

from .config import BBoxRD
from .geo import rd_to_world, round_world, wgs84_to_rd
from .gtfs.model import GtfsIndex
from .matching import ShapeMatcher
from .sources.gtfs_rt import VehicleObs


def _vehicle_id(raw: str, operator: str | None) -> str:
    if operator and ":" not in raw:
        return f"{operator}:{raw}"
    return raw


def build_vehicles(
    observations: list[VehicleObs],
    delays: dict[str, int],
    index: GtfsIndex,
    matcher: ShapeMatcher,
    bbox: BBoxRD,
    now: int,
    feed_ts: int | None,
    max_age_s: float,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for ob in observations:
        observed = ob.timestamp or feed_ts or now
        if now - observed > max_age_s:
            continue
        x, y = wgs84_to_rd(ob.lat, ob.lon)
        if not bbox.contains(x, y):
            continue
        trip = index.trips.get(ob.trip_id) if ob.trip_id else None
        route = index.routes.get(trip.route_id if trip else (ob.route_id or ""))
        operator = route.agency_id if route and route.agency_id else None
        vid = _vehicle_id(ob.key, operator)

        shape_id: str | None = None
        dist: float | None = None
        bearing = ob.bearing_deg
        speed = ob.speed_mps
        shape = index.shapes.get(trip.shape_id) if trip and trip.shape_id else None
        if trip and shape:
            m = matcher.match(vid, trip.trip_id, shape.shape_id, shape.line, x, y, observed, ob.bearing_deg)
            if m is not None:
                shape_id, dist = shape.shape_id, round(m.dist_along_m, 1)
                if bearing is None:
                    bearing = m.heading_deg
                if speed is None:
                    speed = m.speed_mps

        wx, wz = rd_to_world(x, y)
        out.append(
            {
                "id": vid,
                "mode": route.mode if route else "bus",
                "operator": operator,
                "routeShort": route.short_name if route else None,
                "routeId": route.route_id if route else ob.route_id,
                "tripId": ob.trip_id,
                "headsign": trip.headsign if trip else None,
                "shapeId": shape_id,
                "lat": round(ob.lat, 6),
                "lon": round(ob.lon, 6),
                "world": [round_world(wx), round_world(wz)],
                "bearingDeg": round(bearing, 1) if bearing is not None else None,
                "speedMps": round(speed, 2) if speed is not None else None,
                "distAlongShapeM": dist,
                "delaySec": delays.get(ob.trip_id) if ob.trip_id else None,
                "observedTs": int(observed),
            }
        )
    matcher.forget_stale(now)
    out.sort(key=lambda v: v["id"])
    return out
