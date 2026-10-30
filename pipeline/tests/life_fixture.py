"""Synthetic GTFS + OSM inputs for the ``blox life`` tests (no network).

Coordinates are chosen in RD and converted to WGS84, so distances along shapes and offsets
of sidewalks are known exactly. Reference week: Monday 2026-10-26 .. Sunday 2026-11-01.
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

import osmium
from osmium.osm.mutable import Node, Way

from blox_pipeline import geo

VRIJTHOF = (176185.0, 317717.0)
MARKT = (176430.0, 318007.0)
BRUG = (176748.0, 317786.0)
STATION = (177403.0, 317800.0)
HEERLEN = (194000.0, 320000.0)
HEERLEN2 = (196000.0, 321000.0)
W_FAR = (170000.0, 317500.0)
CENTRE = (176000.0, 317500.0)
E_OUT = (180000.0, 318000.0)

SH4 = [VRIJTHOF, MARKT, BRUG, STATION]
SH30 = [W_FAR, CENTRE, E_OUT, HEERLEN]
MONDAY = "2026-10-26"


def _ll(p: tuple[float, float]) -> tuple[float, float]:
    """RD -> (lat, lon) rounded like a real feed."""
    lon, lat = geo.rd_to_wgs84(p[0], p[1])
    return round(float(lat), 7), round(float(lon), 7)


def _csv(rows: list[list[object]]) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue()


def build_gtfs_zip(path: Path) -> Path:
    stops = [["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type"]]
    for sid, p in [("vrijthof", VRIJTHOF), ("markt", MARKT), ("brug", BRUG), ("station", STATION),
                   ("heerlen", HEERLEN), ("heerlen2", HEERLEN2), ("west", W_FAR), ("centre", CENTRE), ("east", E_OUT)]:
        stops.append([sid, sid.title(), *_ll(p), "0"])
    routes = [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"],
              ["r4", "ARR", "4", "Vrijthof - Station", 3, "00a0e0"],
              ["r9", "ARR", "50", "Heerlen local", 3, ""],
              ["r30", "ARR", "30", "Express", 700, ""],
              ["rt", "NS", "RE", "Train", 2, ""]]
    trips = [["route_id", "service_id", "trip_id", "trip_headsign", "shape_id", "realtime_trip_id"],
             ["r4", "wk", "t4a", "Station", "sh4", "ARR:21004:1001"],
             ["r4", "wk", "t4b", "Station", "sh4", "ARR:21004:1031"],  # same timing as t4a: shares its pattern
             ["r4", "sa", "t4sat", "Station", "sh4"],
             ["r4", "wk", "t4late", "Station", "sh4"],  # after midnight (25:10)
             ["r4", "old", "t4old", "Station", "sh4"],  # service not in the reference week
             ["r9", "wk", "t9", "Heerlen", "sh9"],
             ["r30", "wk", "t30", "Heerlen", "sh30"],
             ["rt", "wk", "ttrain", "Heerlen", "sh4"]]
    st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]

    def add(trip: str, calls: list[tuple[str, str, str]]) -> None:
        for n, (arr, dep, stop) in enumerate(calls, start=1):
            st.append([trip, arr, dep, stop, n * 10])

    def line4(h: int, m: int) -> list[tuple[str, str, str]]:
        t = lambda dm, ds=0: f"{h + (m + dm) // 60:02d}:{(m + dm) % 60:02d}:{ds:02d}"  # noqa: E731
        return [(t(0), t(0), "vrijthof"), (t(3), t(4), "markt"), (t(6), t(6), "brug"), (t(10), t(10), "station")]

    add("t4a", line4(10, 0))
    add("t4b", line4(10, 30))
    add("t4sat", line4(11, 0))
    add("t4late", line4(25, 10))
    add("t4old", line4(9, 0))
    add("t9", [("10:00:00", "10:00:00", "heerlen"), ("10:10:00", "10:10:00", "heerlen2")])
    add("t30", [("09:00:00", "09:00:00", "west"), ("09:10:00", "09:10:00", "centre"),
                ("09:20:00", "09:20:00", "east"), ("09:40:00", "09:40:00", "heerlen")])
    add("ttrain", [("10:00:00", "10:00:00", "vrijthof"), ("10:05:00", "10:05:00", "station")])
    shapes = [["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]]
    for sid, pts in [("sh4", SH4), ("sh9", [HEERLEN, HEERLEN2]), ("sh30", SH30)]:
        rows = [[sid, *_ll(p), n * 10] for n, p in enumerate(pts, start=1)]
        shapes.extend(reversed(rows))  # unsorted on purpose
    cal = [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "start_date", "end_date"],
           ["wk", 1, 1, 1, 1, 1, 0, 0, "20261001", "20261231"],
           ["old", 1, 1, 1, 1, 1, 1, 1, "20250101", "20250201"]]
    dates = [["service_id", "date", "exception_type"],
             ["sa", "20261031", 1],  # Saturday only via calendar_dates (how OVapi does it)
             ["wk", "20261028", 2]]  # no weekday service on Wednesday 28th
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("stops.txt", "﻿" + _csv(stops))  # OVapi files may carry a BOM
        zf.writestr("routes.txt", _csv(routes))
        zf.writestr("trips.txt", _csv(trips))
        zf.writestr("stop_times.txt", _csv(st))
        zf.writestr("shapes.txt", _csv(shapes))
        zf.writestr("calendar.txt", _csv(cal))
        zf.writestr("calendar_dates.txt", _csv(dates))
    return path


# ------------------------------------------------------------------------------------ OSM
# A small street network south-west of the Markt (RD metres)
PED = [(176300.0, 317900.0), (176400.0, 317900.0)]  # pedestrian shopping street
FOOT = [(176350.0, 317800.0), (176350.0, 317897.0)]  # footway ending 3 m short of PED
ROAD = [(176200.0, 317700.0), (176400.0, 317700.0)]  # residential, sidewalk=both, width 6
CYCLE = [(176200.0, 317600.0), (176400.0, 317600.0)]  # cycleway: not walked
NOFOOT = [(176200.0, 317650.0), (176400.0, 317650.0)]  # footway with foot=no
SQUARE = [(176420.0, 317880.0), (176460.0, 317880.0), (176460.0, 317920.0), (176420.0, 317920.0)]
SHOP = (176320.0, 317905.0)
CAFE = (176380.0, 317912.0)  # 12 m north of PED: terrace faces south
SHOPS3 = [(176310.0, 317890.0), (176330.0, 317892.0), (176340.0, 317910.0)]
ONEWAY = [(176450.0, 317700.0), (176550.0, 317700.0)]  # tertiary, oneway=yes, cycleway=lane
TREES = [(176470.0, 317885.0), (176470.0, 317895.0), (176470.0, 317905.0)]  # a tree line beside the Markt
PEDCAR = [(176450.0, 317750.0), (176550.0, 317750.0)]  # parking aisle: no cars
MAAS = [(176700.0, 316400.0), (176750.0, 317500.0), (176800.0, 318700.0)]
LIFE_BOX = geo.RDBox(176100.0, 317500.0, 176600.0, 318100.0)


def _lonlat(p: tuple[float, float]) -> tuple[float, float]:
    lon, lat = geo.rd_to_wgs84(p[0], p[1])
    return float(lon), float(lat)


def write_osm(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    nodes: dict[int, tuple[float, float]] = {}
    ways: list[tuple[int, list[int], dict[str, str]]] = []

    def way(wid: int, pts: list[tuple[float, float]], tags: dict[str, str], close: bool = False) -> None:
        ids = []
        for p in pts:
            nid = len(nodes) + 1
            nodes[nid] = p
            ids.append(nid)
        ways.append((wid, ids + ids[:1] if close else ids, tags))

    way(1, PED, {"highway": "pedestrian", "name": "Grote Staat"})
    way(2, FOOT, {"highway": "footway"})
    way(3, ROAD, {"highway": "residential", "sidewalk": "both", "width": "6"})
    way(4, CYCLE, {"highway": "cycleway"})
    way(5, NOFOOT, {"highway": "footway", "foot": "no"})
    way(6, SQUARE, {"place": "square", "name": "Markt"}, close=True)
    way(7, MAAS, {"waterway": "river", "name": "Maas"})
    way(8, ONEWAY, {"highway": "tertiary", "oneway": "yes", "cycleway": "lane"})
    way(9, PEDCAR, {"highway": "service", "service": "parking_aisle"})
    shop_id = len(nodes) + 1
    with osmium.SimpleWriter(str(path)) as w:
        for nid, p in sorted(nodes.items()):
            w.add_node(Node(id=nid, location=_lonlat(p)))
        w.add_node(Node(id=shop_id, location=_lonlat(SHOP), tags={"shop": "clothes", "name": "Winkel"}))
        w.add_node(Node(id=shop_id + 1, location=_lonlat(CAFE), tags={"amenity": "cafe", "name": "Cafe"}))
        for k, p in enumerate(TREES):
            w.add_node(Node(id=shop_id + 10 + k, location=_lonlat(p), tags={"natural": "tree"}))
        for k, p in enumerate(SHOPS3):
            w.add_node(Node(id=shop_id + 2 + k, location=_lonlat(p), tags={"shop": "shoes", "name": f"Shop {k}"}))
        for wid, ids, tags in ways:
            w.add_way(Way(id=wid, nodes=ids, tags=tags))
    return path
