"""Hand-built fixtures that follow the real upstream formats (GTFS, GTFS-RT, Buienradar, RWS).

No network: everything here is constructed in-process. Coordinates are chosen in RD and
converted to WGS84 so the geometry relative to the slice is known exactly.
"""

from __future__ import annotations

import csv
import io
import zipfile
from pathlib import Path

from google.transit import gtfs_realtime_pb2 as rt

from blox_proxy.geo import rd_to_wgs84

# RD reference points (CONTRACT.md section 1)
VRIJTHOF = (176185.0, 317717.0)
MARKT = (176430.0, 318007.0)
BRUG = (176748.0, 317786.0)
STATION = (177403.0, 317800.0)
BONNEFANTEN = (177040.0, 317098.0)
HEERLEN = (194000.0, 320000.0)  # far outside the slice
HEERLEN2 = (196000.0, 321000.0)

SH4 = [VRIJTHOF, MARKT, BRUG, STATION]
SH1 = [STATION, BONNEFANTEN, STATION]  # out-and-back on the same street (looping route)
SH9 = [HEERLEN, HEERLEN2]
SH30 = [(170000.0, 317500.0), (176000.0, 317500.0), (180000.0, 318000.0), HEERLEN]  # passes through


def _csv(rows: list[list[object]]) -> str:
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue()


def _ll(p: tuple[float, float]) -> tuple[float, float]:
    lat, lon = rd_to_wgs84(*p)
    return round(lat, 7), round(lon, 7)


def _shape_rows(shape_id: str, pts: list[tuple[float, float]]) -> list[list[object]]:
    rows = []
    for seq, p in enumerate(pts, start=1):
        lat, lon = _ll(p)
        rows.append([shape_id, lat, lon, seq * 10])  # sequences need not be contiguous
    return rows


def build_gtfs_zip(path: Path) -> Path:
    stops = [["stop_id", "stop_code", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"]]
    for sid, name, p, lt in [
        ("s_vrijthof", "Maastricht, Vrijthof", VRIJTHOF, "0"),
        ("s_markt", "Maastricht, Markt", MARKT, ""),
        ("s_brug", "Maastricht, Sint Servaasbrug", BRUG, "0"),
        ("s_station", "Maastricht, Station", STATION, "0"),
        ("st_station", "Maastricht (parent)", STATION, "1"),
        ("s_bonne", "Maastricht, Bonnefanten", BONNEFANTEN, "0"),
        ("s_heerlen", "Heerlen, Station", HEERLEN, "0"),
        ("s_heerlen2", "Heerlen, Centrum", HEERLEN2, "0"),
    ]:
        lat, lon = _ll(p)
        stops.append([sid, "", name, lat, lon, lt, ""])

    routes = [
        ["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color"],
        ["r4", "ARR", "4", "Vrijthof - Station", 3, "00a0e0"],
        ["r1", "ARR", "1", "Station - Bonnefanten", 3, ""],
        ["r9", "ARR", "50", "Heerlen local", 3, ""],
        ["r30", "ARR", "30", "Express", 700, ""],
        ["r2", "ARRIVA", "RE", "Maastricht - Heerlen", 2, ""],
    ]
    trips = [
        ["route_id", "service_id", "trip_id", "trip_headsign", "shape_id"],
        ["r4", "wk", "t4", "Station", "sh4"],
        ["r4", "wk", "t4b", "Station", "sh4"],
        ["r1", "wk", "t1", "Station", "sh1"],
        ["r9", "wk", "t9", "Heerlen", "sh9"],
        ["r30", "wk", "t30", "Heerlen", "sh30"],
        ["r2", "wk", "t2", "Heerlen", ""],
    ]
    st = [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]]
    for trip, seq_stops in {
        "t4": ["s_vrijthof", "s_markt", "s_brug", "s_station"],
        "t4b": ["s_vrijthof", "s_station"],
        "t1": ["s_station", "s_bonne", "s_station"],
        "t9": ["s_heerlen", "s_heerlen2"],
        "t30": ["s_heerlen", "s_heerlen2"],  # never stops in the slice, but its shape crosses it
        "t2": ["s_station", "s_heerlen"],
    }.items():
        for i, sid in enumerate(seq_stops, start=1):
            st.append([trip, f"10:{i:02d}:00", f"10:{i:02d}:00", sid, i])
    shapes = [["shape_id", "shape_pt_lat", "shape_pt_lon", "shape_pt_sequence"]]
    for sid, pts in [("sh4", SH4), ("sh1", SH1), ("sh9", SH9), ("sh30", SH30)]:
        rows = _shape_rows(sid, pts)
        shapes.extend([[r[0], r[1], r[2], r[3]] for r in reversed(rows)])  # unsorted on purpose

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("agency.txt", _csv([["agency_id", "agency_name", "agency_url", "agency_timezone"], ["ARR", "Arriva", "https://arriva.nl", "Europe/Amsterdam"]]))
        zf.writestr("stops.txt", "﻿" + _csv(stops))  # OVapi files may carry a BOM
        zf.writestr("routes.txt", _csv(routes))
        zf.writestr("trips.txt", _csv(trips))
        zf.writestr("stop_times.txt", _csv(st))
        zf.writestr("shapes.txt", _csv(shapes))
    return path


def lerp(a: tuple[float, float], b: tuple[float, float], t: float) -> tuple[float, float]:
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def vehicle_feed(now: int, vehicles: list[dict[str, object]]) -> bytes:
    """GTFS-RT VehiclePositions FeedMessage. Each dict: id, trip, rd, ts, [bearing], [speed], [label]."""
    msg = rt.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    msg.header.incrementality = rt.FeedHeader.FULL_DATASET
    msg.header.timestamp = now
    for v in vehicles:
        ent = msg.entity.add()
        ent.id = f"ent-{v['id']}"
        vp = ent.vehicle
        if v.get("trip"):
            vp.trip.trip_id = str(v["trip"])
            vp.trip.start_date = "20261017"
        vp.vehicle.id = str(v["id"])
        if v.get("label"):
            vp.vehicle.label = str(v["label"])
        lat, lon = rd_to_wgs84(*v["rd"])  # type: ignore[arg-type]
        vp.position.latitude = lat
        vp.position.longitude = lon
        if v.get("bearing") is not None:
            vp.position.bearing = float(v["bearing"])  # type: ignore[arg-type]
        if v.get("speed") is not None:
            vp.position.speed = float(v["speed"])  # type: ignore[arg-type]
        vp.timestamp = int(v["ts"])  # type: ignore[arg-type]
    return msg.SerializeToString()


def trip_update_feed(now: int) -> bytes:
    msg = rt.FeedMessage()
    msg.header.gtfs_realtime_version = "2.0"
    msg.header.timestamp = now
    # t4: past stop delay 30 s, next stop delay 45 s -> 45
    e = msg.entity.add()
    e.id = "tu-t4"
    tu = e.trip_update
    tu.trip.trip_id = "t4"
    for seq, (t_off, delay) in enumerate([(-120, 30), (60, 45), (300, 50)], start=1):
        stu = tu.stop_time_update.add()
        stu.stop_sequence = seq
        stu.arrival.delay = delay
        stu.arrival.time = now + t_off
    # t1: trip-level delay
    e = msg.entity.add()
    e.id = "tu-t1"
    e.trip_update.trip.trip_id = "t1"
    e.trip_update.delay = -20
    return msg.SerializeToString()


def buienradar_doc() -> dict[str, object]:
    """Shape of https://data.buienradar.nl/2.0/feed/json (trimmed to 3 stations)."""
    def station(sid: int, name: str, lat: float, lon: float, **kw: object) -> dict[str, object]:
        base: dict[str, object] = {
            "$id": str(sid), "stationid": sid, "stationname": name, "lat": lat, "lon": lon,
            "regio": name.split()[-1], "timestamp": "2026-10-17T14:50:00",
            "weatherdescription": "Zwaar bewolkt", "iconurl": "https://cdn.buienradar.nl/resources/images/icons/weather/30x30/c.png",
            "graphUrl": "https://www.buienradar.nl/nederland/weerbericht/weergrafieken/c",
            "winddirection": "ZW", "temperature": 11.0, "groundtemperature": 9.8, "feeltemperature": 9.0,
            "windgusts": 9.1, "windspeed": 4.2, "windspeedBft": 3, "humidity": 88.0, "precipitation": 0.0,
            "sunpower": 120.0, "rainFallLast24Hour": 2.1, "rainFallLastHour": 0.0, "winddirectiondegrees": 230.0,
            "airpressure": 1012.3, "visibility": 18000.0,
        }
        base.update(kw)
        return base

    return {
        "$id": "1",
        "buienradar": {"$id": "2", "copyright": "(C)opyright Buienradar / RTL. Alle rechten voorbehouden", "terms": "Deze feed mag vrij worden gebruikt onder voorwaarde van bronvermelding buienradar.nl inclusief een hyperlink naar https://www.buienradar.nl."},
        "actual": {
            "$id": "3",
            "actualradarurl": "https://api.buienradar.nl/image/1.0/RadarMapNL?w=500&h=512",
            "sunrise": "2026-10-17T08:12:00",
            "sunset": "2026-10-17T18:46:00",
            "stationmeasurements": [
                station(6260, "Meetstation De Bilt", 52.10, 5.18, temperature=13.5),
                station(6380, "Meetstation Maastricht", 50.92, 5.78, temperature=12.3, precipitation=0.4,
                        weatherdescription="Bewolkt en lichte regen", iconurl="https://cdn.buienradar.nl/resources/images/icons/weather/30x30/q.png"),
                station(6391, "Meetstation Arcen", 51.50, 6.20, temperature=12.0),
                station(9999, "Meetstation Kapot", 50.85, 5.69, temperature=None),  # nearest but no data
            ],
        },
        "forecast": {"$id": "4", "fivedayforecast": []},
    }


def rws_doc(values_cm: list[tuple[str, float]]) -> dict[str, object]:
    """Shape of a DDAPI20 OphalenWaarnemingen response (per ddlpy)."""
    return {
        "Succesvol": True,
        "WaarnemingenLijst": [
            {
                "Locatie": {"Code": "maastricht.borgharen.maas.beneden", "Naam": "Borgharen Dorp", "Coordinatenstelsel": "25831"},
                "AquoMetadata": {
                    "Compartiment": {"Code": "OW", "Omschrijving": "Oppervlaktewater"},
                    "Grootheid": {"Code": "WATHTE", "Omschrijving": "Waterhoogte"},
                    "Eenheid": {"Code": "cm", "Omschrijving": "centimeter"},
                },
                "MetingenLijst": [
                    {"Tijdstip": t, "Meetwaarde": {"Waarde_Numeriek": v}, "WaarnemingMetadata": {"Statuswaarde": "Ongecontroleerd", "Kwaliteitswaardecode": "00"}}
                    for t, v in values_cm
                ],
            }
        ],
    }
