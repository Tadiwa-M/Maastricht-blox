"""GTFS static -> the compact timetable the web game animates (``life/transit.json``).

Kept: bus routes whose shapes come within the margin of the slice, their shapes (clipped to
the box, densified <= 10 m, with the *full* shape's cumulative distance), and every trip that
runs on one of the seven reference dates (``calendar.py``). Each trip's stop times are
projected onto its shape in calling order; only the stops bracketing the clipped part are kept.

Trips sharing shape, route, headsign and the same relative timing collapse into one
**pattern**; a trip is then ``[pattern, startSec, dayMask]``. That keeps a city's week of
buses well under a few MB. Format: ``docs/guide/05-movers-and-models.md``.
"""

from __future__ import annotations

import logging
import time
import zipfile
from collections import defaultdict
from dataclasses import dataclass
import datetime as dt
from pathlib import Path

import numpy as np

from .. import geo
from ..geo import RDBox
from .calendar import read_calendar, reference_week
from .csvzip import gtfs_seconds, iter_rows
from .polyline import cumulative, densify, inside_run, project

log = logging.getLogger(__name__)

DENSIFY_M = 10.0
STOP_SNAP_M = 60.0  # a stop further than this from its shape is ignored
_DEFAULT_COLOURS = {"bus": "#1F6FB2", "tram": "#C8102E", "rail": "#FFC917", "ferry": "#00A3E0"}


def mode_for_route_type(route_type: int) -> str:
    """GTFS basic + extended route types -> bus | tram | rail | metro | ferry | other."""
    basic = {0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry", 5: "tram", 11: "bus", 12: "rail"}
    if route_type in basic:
        return basic[route_type]
    fam = route_type // 100
    return {1: "rail", 3: "rail", 2: "bus", 7: "bus", 8: "bus", 4: "metro", 9: "tram", 10: "ferry", 12: "ferry"}.get(fam, "other")


def route_colour(raw: str, mode: str) -> str:
    raw = (raw or "").strip().lstrip("#")
    if len(raw) == 6 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return "#" + raw.upper()
    return _DEFAULT_COLOURS.get(mode, "#808080")


def q(v: float) -> float:
    """Quantise metres to 0.1 m."""
    return round(float(v), 1)


@dataclass
class _Shape:
    pts: np.ndarray  # RD, densified
    cum: np.ndarray
    run: tuple[int, int]  # clipped index range (inclusive)

    @property
    def d0(self) -> float:
        return float(self.cum[self.run[0]])

    @property
    def d1(self) -> float:
        return float(self.cum[self.run[1]])


def _rd(lat: list[float], lon: list[float]) -> np.ndarray:
    if not lat:
        return np.zeros((0, 2))
    x, y = geo.wgs84_to_rd(np.asarray(lon), np.asarray(lat))
    return np.column_stack([x, y])


def _envelope(box: RDBox, pad_deg: float = 0.01) -> tuple[float, float, float, float]:
    w, s, e, n = box.to_wgs84()
    return w - pad_deg, s - pad_deg, e + pad_deg, n + pad_deg


def _shapes_touching(zf: zipfile.ZipFile, box: RDBox) -> set[str]:
    w, s, e, n = _envelope(box)
    ids: list[str] = []
    lat: list[float] = []
    lon: list[float] = []
    for sid, la, lo in iter_rows(zf, "shapes.txt", ["shape_id", "shape_pt_lat", "shape_pt_lon"]):
        a, o = float(la), float(lo)
        if s <= a <= n and w <= o <= e:
            ids.append(sid); lat.append(a); lon.append(o)
    rd = _rd(lat, lon)
    inside = (rd[:, 0] >= box.xmin) & (rd[:, 0] <= box.xmax) & (rd[:, 1] >= box.ymin) & (rd[:, 1] <= box.ymax)
    return {sid for sid, ok in zip(ids, inside) if ok}


def _read_shapes(zf: zipfile.ZipFile, ids: set[str], box: RDBox) -> dict[str, _Shape]:
    raw: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for sid, seq, la, lo in iter_rows(zf, "shapes.txt", ["shape_id", "shape_pt_sequence", "shape_pt_lat", "shape_pt_lon"]):
        if sid in ids:
            raw[sid].append((int(seq), float(la), float(lo)))
    out: dict[str, _Shape] = {}
    for sid, pts in raw.items():
        pts.sort()
        dense = densify(_rd([p[1] for p in pts], [p[2] for p in pts]), DENSIFY_M)
        run = inside_run(dense, box.as_tuple()) if len(dense) >= 2 else None
        if run is not None and run[1] > run[0]:
            out[sid] = _Shape(dense, cumulative(dense), run)
    return out


def build_transit(zip_path: Path, box: RDBox, start: dt.date, modes: tuple[str, ...] = ("bus",)) -> dict:
    """Read the GTFS zip and return the ``transit.json`` document for RD ``box``."""
    t0 = time.monotonic()
    with zipfile.ZipFile(zip_path) as zf:
        cal = read_calendar(zf)
        week = reference_week(cal, start)
        touching = _shapes_touching(zf, box)
        routes: dict[str, tuple[str, str, str, str]] = {}  # id -> short, long, colour, mode
        cols = ["route_id", "route_short_name", "route_long_name", "route_type", "route_color"]
        for rid, short, long_, rtype, colour in iter_rows(zf, "routes.txt", cols, frozenset({"route_short_name", "route_long_name", "route_color"})):
            mode = mode_for_route_type(int(rtype))
            if mode in modes:
                routes[rid] = (short or long_ or rid, long_, route_colour(colour, mode), mode)
        trips: dict[str, tuple[str, str, int, str]] = {}  # trip -> route, shape, mask, headsign
        tcols = ["trip_id", "route_id", "service_id", "shape_id", "trip_headsign"]
        masks: dict[str, int] = {}
        for tid, rid, svc, shp, head in iter_rows(zf, "trips.txt", tcols, frozenset({"shape_id", "trip_headsign"})):
            if rid not in routes or shp not in touching:
                continue
            if svc not in masks:
                masks[svc] = cal.week_mask(svc, week)
            if masks[svc]:
                trips[tid] = (rid, shp, masks[svc], head)
        shapes = _read_shapes(zf, {t[1] for t in trips.values()}, box)
        trips = {k: t for k, t in trips.items() if t[1] in shapes}
        calls: dict[str, list[tuple[int, int, int, str]]] = defaultdict(list)
        scols = ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]
        for tid, arr, dep, stop, seq in iter_rows(zf, "stop_times.txt", scols):
            if tid in trips and (arr or dep):
                a = gtfs_seconds(arr or dep)
                calls[tid].append((int(seq), a, gtfs_seconds(dep or arr), stop))
        need = {c[3] for cs in calls.values() for c in cs}
        stops: dict[str, tuple[float, float]] = {}
        sid_l: list[str] = []
        lat_l: list[float] = []
        lon_l: list[float] = []
        for sid, la, lo in iter_rows(zf, "stops.txt", ["stop_id", "stop_lat", "stop_lon"]):
            if sid in need and la and lo:
                sid_l.append(sid); lat_l.append(float(la)); lon_l.append(float(lo))
        for sid, p in zip(sid_l, _rd(lat_l, lon_l)):
            stops[sid] = (float(p[0]), float(p[1]))
    doc = _assemble(routes, trips, shapes, calls, stops, week)
    doc["meta"]["feed"] = zip_path.name
    log.info("transit: %d routes, %d shapes, %d patterns, %d trips (week from %s) in %.1f s",
             len(doc["routes"]), len(doc["shapes"]), len(doc["patterns"]), len(doc["trips"]), week[0],
             time.monotonic() - t0)
    return doc


def _project_calls(shape: _Shape, seq: list[tuple[int, int, int, str]], stops: dict[str, tuple[float, float]],
                   cache: dict) -> list[tuple[int, int, float]]:
    """[(arr, dep, dist)] for the calls that snap to the shape, in order."""
    key = (id(shape), tuple(c[3] for c in seq))
    if key not in cache:
        dists: list[float | None] = []
        last = 0.0
        for c in seq:
            p = stops.get(c[3])
            if p is None:
                dists.append(None)
                continue
            d, off = project(shape.pts, shape.cum, p, last)
            if off > STOP_SNAP_M:
                dists.append(None)
                continue
            dists.append(d)
            last = d
        cache[key] = dists
    return [(c[1], c[2], d) for c, d in zip(seq, cache[key]) if d is not None]


def merge_trips(trips: list[tuple[int, int, int]]) -> list[list[int]]:
    """One row per (pattern, start) with the day masks OR-ed (feeds often split one timetable
    over several services, e.g. one per date set), sorted by start time."""
    merged: dict[tuple[int, int], int] = {}
    for p, start, mask in trips:
        merged[(p, start)] = merged.get((p, start), 0) | mask
    return [[p, start, mask] for (p, start), mask in sorted(merged.items(), key=lambda kv: (kv[0][1], kv[0][0]))]


def _assemble(routes: dict, trips: dict, shapes: dict[str, _Shape], calls: dict, stops: dict,
              week: list[dt.date]) -> dict:
    patterns: dict[tuple, int] = {}
    raw_trips: list[tuple[int, int, int]] = []
    cache: dict = {}
    for tid in sorted(trips):
        rid, sid, mask, head = trips[tid]
        shp = shapes[sid]
        st = _project_calls(shp, sorted(calls.get(tid, [])), stops, cache)
        if len(st) < 2:
            continue
        # keep the stops bracketing the clipped part of the shape
        lo = max([n for n, c in enumerate(st) if c[2] <= shp.d0], default=0)
        hi = min([n for n, c in enumerate(st) if c[2] >= shp.d1], default=len(st) - 1)
        st = st[lo:hi + 1]
        if len(st) < 2 or st[-1][2] <= shp.d0 or st[0][2] >= shp.d1:
            continue
        start = st[0][0]
        rel = tuple(v for a, d, dist in st for v in (a - start, d - start, q(dist)))
        key = (sid, rid, head, rel)
        if key not in patterns:
            patterns[key] = len(patterns)
        raw_trips.append((patterns[key], start, mask))
    shape_ids = sorted({k[0] for k in patterns})
    shape_idx = {s: n for n, s in enumerate(shape_ids)}
    route_ids = sorted({k[1] for k in patterns}, key=lambda r: (len(routes[r][0]), routes[r][0], r))
    route_idx = {r: n for n, r in enumerate(route_ids)}
    shapes_doc = []
    for sid in shape_ids:
        s = shapes[sid]
        i0, i1 = s.run
        pts: list[float] = []
        for (x, y), d in zip(s.pts[i0:i1 + 1], s.cum[i0:i1 + 1]):
            pts += [q(x - geo.X0), q(y - geo.Y0), q(d)]
        shapes_doc.append({"id": sid, "pts": pts})
    return {
        "version": 1,
        "kind": "transit",
        "meta": {"tz": "Europe/Amsterdam", "week": [d.isoformat() for d in week], "units": "m, s"},
        "routes": [{"short": routes[r][0], "long": routes[r][1], "colour": routes[r][2], "mode": routes[r][3]}
                   for r in route_ids],
        "shapes": shapes_doc,
        "patterns": [{"shape": shape_idx[k[0]], "route": route_idx[k[1]], "head": k[2], "st": list(k[3])}
                     for k in patterns],
        "trips": merge_trips(raw_trips),
    }
