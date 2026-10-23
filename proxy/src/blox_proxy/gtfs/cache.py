"""Compact on-disk cache of a ``GtfsIndex`` (gzip JSON) so startup takes well under a second."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path

from ..polyline import Polyline
from .model import GtfsIndex, Route, Shape, Stop, Trip

CACHE_FORMAT = 1


def save_index(index: GtfsIndex, path: Path) -> None:
    doc = {
        "format": CACHE_FORMAT,
        "meta": index.meta,
        "routes": [[r.route_id, r.agency_id, r.short_name, r.long_name, r.route_type, r.mode, r.color] for r in index.routes.values()],
        "trips": [[t.trip_id, t.route_id, t.shape_id, t.headsign] for t in index.trips.values()],
        "stops": [[s.stop_id, s.name, s.lat, s.lon, round(s.x, 2), round(s.y, 2)] for s in index.stops.values()],
        "shapes": {
            sid: {"xy": [[round(x, 2), round(y, 2)] for x, y in sh.line.points], "cum": [round(c, 2) for c in sh.line.cum]}
            for sid, sh in index.shapes.items()
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(tmp, path)


def load_index(path: Path) -> GtfsIndex | None:
    """Load a cache file; returns None if it is missing or has an old format."""
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        doc = json.load(f)
    if doc.get("format") != CACHE_FORMAT:
        return None
    routes = {r[0]: Route(r[0], r[1], r[2], r[3], int(r[4]), r[5], r[6]) for r in doc["routes"]}
    trips = {t[0]: Trip(t[0], t[1], t[2], t[3]) for t in doc["trips"]}
    stops = {s[0]: Stop(s[0], s[1], s[2], s[3], s[4], s[5]) for s in doc["stops"]}
    shapes = {
        sid: Shape(sid, Polyline([(p[0], p[1]) for p in v["xy"]], v["cum"]))
        for sid, v in doc["shapes"].items()
    }
    return GtfsIndex(routes, trips, stops, shapes, dict(doc.get("meta", {})))
