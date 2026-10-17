"""One-time preprocessing of the national GTFS zip into a slice-sized index.

Kept:
- stops (location_type 0/empty) inside the bbox,
- trips that call at one of those stops, or whose shape has a point inside the bbox,
- the routes and shapes of those trips (shapes densified to <= ``densify_m``).

The national feed is large (stop_times.txt alone is ~1 GB), so every file is streamed
straight from the zip, and cheap WGS84 envelope tests run before any exact projection.
"""

from __future__ import annotations

import logging
import time
import zipfile
from collections import defaultdict
from pathlib import Path

from ..config import BBoxRD
from ..geo import rd_to_wgs84, wgs84_to_rd_many
from ..polyline import Polyline, cumulative_distances, densify
from .csvzip import iter_rows
from .model import GtfsIndex, Route, Shape, Stop, Trip, mode_for_route_type, route_colour

log = logging.getLogger(__name__)

_ENVELOPE_PAD_DEG = 0.01  # ~1 km; envelope is only a prefilter, exact test follows


def _wgs_envelope(bbox: BBoxRD) -> tuple[float, float, float, float]:
    corners = [rd_to_wgs84(x, y) for x in (bbox.xmin, bbox.xmax) for y in (bbox.ymin, bbox.ymax)]
    lats, lons = [c[0] for c in corners], [c[1] for c in corners]
    p = _ENVELOPE_PAD_DEG
    return min(lats) - p, min(lons) - p, max(lats) + p, max(lons) + p


def _read_stops(zf: zipfile.ZipFile, bbox: BBoxRD, env: tuple[float, float, float, float]) -> dict[str, Stop]:
    lat0, lon0, lat1, lon1 = env
    cand: list[tuple[str, str, float, float]] = []
    cols = ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"]
    for sid, name, slat, slon, ltype in iter_rows(zf, "stops.txt", cols, optional=frozenset({"location_type"})):
        if ltype not in ("", "0") or not slat or not slon:
            continue
        lat, lon = float(slat), float(slon)
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            cand.append((sid, name, lat, lon))
    rd = wgs84_to_rd_many([c[2] for c in cand], [c[3] for c in cand])
    return {
        sid: Stop(sid, name, lat, lon, x, y)
        for (sid, name, lat, lon), (x, y) in zip(cand, rd)
        if bbox.contains(x, y)
    }


def _trips_calling_at(zf: zipfile.ZipFile, stop_ids: set[str]) -> set[str]:
    out: set[str] = set()
    for trip_id, stop_id in iter_rows(zf, "stop_times.txt", ["trip_id", "stop_id"]):
        if stop_id in stop_ids:
            out.add(trip_id)
    return out


def _shapes_touching(zf: zipfile.ZipFile, bbox: BBoxRD, env: tuple[float, float, float, float]) -> set[str]:
    lat0, lon0, lat1, lon1 = env
    cand_ids: list[str] = []
    cand_lat: list[float] = []
    cand_lon: list[float] = []
    for sid, slat, slon in iter_rows(zf, "shapes.txt", ["shape_id", "shape_pt_lat", "shape_pt_lon"]):
        lat, lon = float(slat), float(slon)
        if lat0 <= lat <= lat1 and lon0 <= lon <= lon1:
            cand_ids.append(sid)
            cand_lat.append(lat)
            cand_lon.append(lon)
    return {sid for sid, (x, y) in zip(cand_ids, wgs84_to_rd_many(cand_lat, cand_lon)) if bbox.contains(x, y)}


def _read_trips(zf: zipfile.ZipFile, calling: set[str], touching_shapes: set[str]) -> dict[str, Trip]:
    cols = ["trip_id", "route_id", "shape_id", "trip_headsign"]
    opt = frozenset({"shape_id", "trip_headsign"})
    out: dict[str, Trip] = {}
    for trip_id, route_id, shape_id, headsign in iter_rows(zf, "trips.txt", cols, optional=opt):
        if trip_id in calling or (shape_id and shape_id in touching_shapes):
            out[trip_id] = Trip(trip_id, route_id, shape_id or None, headsign)
    return out


def _read_routes(zf: zipfile.ZipFile, route_ids: set[str]) -> dict[str, Route]:
    cols = ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"]
    opt = frozenset({"agency_id", "route_short_name", "route_long_name", "route_color"})
    out: dict[str, Route] = {}
    for rid, agency, short, long_, rtype, colour in iter_rows(zf, "routes.txt", cols, optional=opt):
        if rid in route_ids:
            rt = int(rtype)
            mode = mode_for_route_type(rt)
            out[rid] = Route(rid, agency, short, long_, rt, mode, route_colour(colour, mode))
    return out


def _read_shapes(zf: zipfile.ZipFile, shape_ids: set[str], densify_m: float) -> dict[str, Shape]:
    raw: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    cols = ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"]
    for sid, seq, slat, slon in iter_rows(zf, "shapes.txt", cols):
        if sid in shape_ids:
            raw[sid].append((int(seq), float(slat), float(slon)))
    out: dict[str, Shape] = {}
    for sid, pts in raw.items():
        pts.sort()
        rd = wgs84_to_rd_many([p[1] for p in pts], [p[2] for p in pts])
        dense = densify(rd, densify_m)
        if len(dense) >= 2:
            out[sid] = Shape(sid, Polyline(dense, cumulative_distances(dense)))
    return out


def build_index(zip_path: Path, bbox: BBoxRD, densify_m: float) -> GtfsIndex:
    t0 = time.monotonic()
    env = _wgs_envelope(bbox)
    with zipfile.ZipFile(zip_path) as zf:
        stops = _read_stops(zf, bbox, env)
        log.info("GTFS: %d stops in bbox", len(stops))
        calling = _trips_calling_at(zf, set(stops))
        log.info("GTFS: %d trips call at those stops", len(calling))
        touching = _shapes_touching(zf, bbox, env)
        trips = _read_trips(zf, calling, touching)
        routes = _read_routes(zf, {t.route_id for t in trips.values()})
        trips = {k: t for k, t in trips.items() if t.route_id in routes}
        shapes = _read_shapes(zf, {t.shape_id for t in trips.values() if t.shape_id}, densify_m)
    log.info("GTFS: kept %d routes, %d trips, %d shapes in %.1f s", len(routes), len(trips), len(shapes), time.monotonic() - t0)
    return GtfsIndex(routes=routes, trips=trips, stops=stops, shapes=shapes, meta={"builtAt": int(time.time()), "densifyM": densify_m})
