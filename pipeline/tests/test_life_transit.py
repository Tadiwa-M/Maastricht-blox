"""``blox life`` transit export: GTFS (synthetic national-feed-like zip) -> transit.json."""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path

import pytest

from blox_pipeline import geo
from blox_pipeline.life.calendar import reference_week
from blox_pipeline.life.csvzip import gtfs_seconds
from blox_pipeline.life.polyline import cumulative, densify, inside_run, project
from blox_pipeline.life.transit import build_transit, mode_for_route_type, route_colour
from life_fixture import BRUG, MARKT, MONDAY, SH4, STATION, VRIJTHOF, build_gtfs_zip

import numpy as np

BOX = geo.slice_box().buffer(500.0)


@pytest.fixture(scope="module")
def doc(tmp_path_factory: pytest.TempPathFactory) -> dict:
    zp = build_gtfs_zip(tmp_path_factory.mktemp("gtfs") / "gtfs-nl.zip")
    return build_transit(zp, BOX, dt.date.fromisoformat(MONDAY))


def _route(doc: dict, short: str) -> int:
    return [r["short"] for r in doc["routes"]].index(short)


def _trips(doc: dict, short: str) -> list[tuple[dict, int, int]]:
    r = _route(doc, short)
    return [(doc["patterns"][p], s, m) for p, s, m in doc["trips"] if doc["patterns"][p]["route"] == r]


def test_keeps_bus_routes_touching_the_slice(doc: dict) -> None:
    assert sorted(r["short"] for r in doc["routes"]) == ["30", "4"]  # not Heerlen-only 50, not the train
    r4 = doc["routes"][_route(doc, "4")]
    assert r4["agency"] == "ARR"  # operator, for the bus livery (viewer life/livery.js)
    assert (r4["colour"], r4["mode"]) == ("#00A0E0", "bus")
    assert doc["routes"][_route(doc, "30")]["colour"] == "#1F6FB2"  # default bus colour
    assert doc["meta"]["week"][0] == MONDAY and len(doc["meta"]["week"]) == 7


def test_shapes_are_unity_metres_densified_with_cumulative_distance(doc: dict) -> None:
    sh4 = next(s for s in doc["shapes"] if s["id"] == "sh4")
    pts = np.asarray(sh4["pts"]).reshape(-1, 3)
    assert pts[0, :2] == pytest.approx([VRIJTHOF[0] - geo.X0, VRIJTHOF[1] - geo.Y0], abs=0.6)
    assert pts[-1, :2] == pytest.approx([STATION[0] - geo.X0, STATION[1] - geo.Y0], abs=0.6)
    steps = np.hypot(*np.diff(pts[:, :2], axis=0).T)
    assert steps.max() <= 10.0 + 0.2
    assert np.all(np.diff(pts[:, 2]) > 0)
    assert pts[-1, 2] == pytest.approx(sum(math.dist(a, b) for a, b in zip(SH4, SH4[1:])), abs=1.0)
    assert all(round(v, 1) == v for v in sh4["pts"])  # quantised to 0.1 m


def test_long_shape_is_clipped_but_keeps_full_distance(doc: dict) -> None:
    sh30 = next(s for s in doc["shapes"] if s["id"] == "sh30")
    pts = np.asarray(sh30["pts"]).reshape(-1, 3)
    assert pts[:, 0].min() >= BOX.xmin - geo.X0 - 10.5 and pts[:, 0].max() <= BOX.xmax - geo.X0 + 10.5
    assert pts[0, 2] > 5000  # distance from the shape's real start in the far west
    (pat, start, _), = _trips(doc, "30")
    st = np.asarray(pat["st"]).reshape(-1, 3)
    # only the stops bracketing the clipped part: west (before), centre (inside), east (after)
    assert len(st) == 3 and start == gtfs_seconds("09:00:00")
    assert st[0, 2] <= pts[0, 2] and st[-1, 2] >= pts[-1, 2]


def test_stop_times_projected_with_dwell(doc: dict) -> None:
    trips = _trips(doc, "4")
    pat, start, _ = next(t for t in trips if t[1] == 10 * 3600)
    st = np.asarray(pat["st"]).reshape(-1, 3)
    assert st[:, 0].tolist() == [0, 180, 360, 600]
    assert st[:, 1].tolist() == [0, 240, 360, 600]  # 60 s dwell at the Markt
    d_markt = math.dist(VRIJTHOF, MARKT)
    assert st[:, 2].tolist() == pytest.approx([0, d_markt, d_markt + math.dist(MARKT, BRUG),
                                               st[-1, 2]], abs=1.0)
    assert pat["head"] == "Station"


def test_patterns_shared_and_week_masks(doc: dict) -> None:
    trips = _trips(doc, "4")
    by_start = {s: (p, m) for p, s, m in trips}
    assert sorted(by_start) == [10 * 3600, 10 * 3600 + 1800, 11 * 3600, 25 * 3600 + 600]  # t4old dropped
    assert by_start[36000][0] is by_start[37800][0]  # same timing -> one pattern
    weekdays_but_wed = 0b0011011
    assert by_start[36000][1] == weekdays_but_wed
    assert by_start[11 * 3600][1] == 1 << 5  # Saturday only
    assert by_start[25 * 3600 + 600][1] == weekdays_but_wed  # past midnight keeps its service day
    assert [t[1] for t in doc["trips"]] == sorted(t[1] for t in doc["trips"])


def test_size_is_small(doc: dict) -> None:
    assert len(json.dumps(doc, separators=(",", ":"))) < 20_000


def test_helpers() -> None:
    assert gtfs_seconds("25:10:05") == 25 * 3600 + 605
    assert mode_for_route_type(700) == "bus" and mode_for_route_type(2) == "rail"
    assert route_colour("abc", "bus") == "#1F6FB2" and route_colour("#ff0000", "bus") == "#FF0000"
    pts = densify([(0, 0), (25, 0), (25, 0), (25, 10)], 10)
    assert len(pts) == 5 and cumulative(pts)[-1] == pytest.approx(35)
    # out-and-back: the second visit of the same place maps to the return leg
    line = densify([(0, 0), (100, 0), (0, 0)], 10)
    cum = cumulative(line)
    assert project(line, cum, (30, 1))[0] == pytest.approx(30, abs=0.01)
    assert project(line, cum, (30, 1), from_dist=110)[0] == pytest.approx(170, abs=0.01)
    assert inside_run(line, (50, -1, 200, 1)) == (4, 16)
    assert inside_run(line, (500, 500, 600, 600)) is None


def test_reference_week_moves_into_feed(tmp_path: Path) -> None:
    from blox_pipeline.life.calendar import Calendar

    cal = Calendar()
    cal.weekly["x"] = ((True,) * 7, dt.date(2026, 11, 2), dt.date(2026, 12, 31))
    week = reference_week(cal, dt.date(2026, 10, 1))
    assert week[0] == dt.date(2026, 11, 2) and sorted(d.weekday() for d in week) == list(range(7))


def test_trips_split_over_services_are_merged() -> None:
    from blox_pipeline.life.transit import merge_trips

    assert merge_trips([(0, 600, 1), (1, 300, 4), (0, 600, 2), (0, 900, 1)]) == [[1, 300, 4], [0, 600, 3], [0, 900, 1]]


def test_v2_stops_route_ids_and_trip_ids(doc: dict) -> None:
    assert doc["version"] == 2
    names = {s["id"]: s["name"] for s in doc["stops"]}
    assert names["markt"] == "Markt" and names["station"] == "Station"
    r4 = doc["routes"][_route(doc, "4")]
    assert r4["id"] == "r4"  # the GTFS route id, as GTFS-Realtime reports it
    p = next(p for p, _, _ in _trips(doc, "4"))
    assert [doc["stops"][i]["id"] for i in p["stops"]] == ["vrijthof", "markt", "brug", "station"]
    assert len(p["stops"]) * 3 == len(p["st"])  # one stop per (arr, dep, dist) triplet
    assert len(doc["tripIds"]) == len(doc["trips"])
    rows = {tuple(ids) for ids in doc["tripIds"]}
    assert ("t4a",) in rows and ("t4b",) in rows  # same pattern, different start: own rows
    s = doc["stops"][p["stops"][1]]
    assert abs(s["x"] - (MARKT[0] - geo.X0)) < 0.5 and abs(s["y"] - (MARKT[1] - geo.Y0)) < 0.5


def test_trains_kept_with_rail_mode(tmp_path: Path) -> None:
    zp = build_gtfs_zip(tmp_path / "gtfs-nl.zip")
    d = build_transit(zp, BOX, dt.date.fromisoformat(MONDAY), modes=("bus", "rail"))
    train = next(r for r in d["routes"] if r["mode"] == "rail")
    assert train["id"] == "rt" and train["colour"] == "#FFC917"
    assert ["ttrain"] in d["tripIds"]


def test_trip_ids_follow_merged_rows() -> None:
    from blox_pipeline.life.transit import merge_trips_with_ids

    rows, ids = merge_trips_with_ids([(0, 600, 1, "a"), (1, 300, 4, "b"), (0, 600, 2, "c")])
    assert rows == [[1, 300, 4], [0, 600, 3]] and ids == [["b"], ["a", "c"]]


def test_realtime_ids_for_live_delays(doc: dict) -> None:
    assert len(doc["realtimeIds"]) == len(doc["trips"])
    row = doc["tripIds"].index(["t4a"])
    assert doc["realtimeIds"][row] == ["ARR:21004:1001"]  # OVapi journey key, as the relay returns it
    assert doc["realtimeIds"][doc["tripIds"].index(["t30"])] == []  # rows without one stay empty
