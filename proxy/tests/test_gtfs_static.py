from __future__ import annotations

import math
from pathlib import Path

import pytest

from blox_proxy.config import LIVE_BBOX_RD
from blox_proxy.gtfs.cache import load_index, save_index
from blox_proxy.gtfs.model import GtfsIndex, mode_for_route_type, route_colour
from blox_proxy.shapes_api import clip_indices, shapes_payload, stops_payload

from builders import SH4, STATION, VRIJTHOF


def test_filters_to_slice(gtfs_index: GtfsIndex) -> None:
    assert set(gtfs_index.stops) == {"s_vrijthof", "s_markt", "s_brug", "s_station", "s_bonne"}
    # t9 only serves Heerlen; t30 never stops in the slice but its shape crosses it
    assert set(gtfs_index.trips) == {"t4", "t4b", "t1", "t30", "t2"}
    assert set(gtfs_index.routes) == {"r4", "r1", "r30", "r2"}
    assert set(gtfs_index.shapes) == {"sh4", "sh1", "sh30"}
    assert gtfs_index.trips["t2"].shape_id is None


def test_route_attributes(gtfs_index: GtfsIndex) -> None:
    r4 = gtfs_index.routes["r4"]
    assert (r4.short_name, r4.agency_id, r4.mode, r4.color) == ("4", "ARR", "bus", "#00A0E0")
    assert gtfs_index.routes["r30"].mode == "bus"  # extended type 700
    assert gtfs_index.routes["r2"].mode == "rail"


def test_shapes_densified_and_ordered(gtfs_index: GtfsIndex) -> None:
    line = gtfs_index.shapes["sh4"].line
    assert line.points[0] == pytest.approx(VRIJTHOF, abs=0.5)
    assert line.points[-1] == pytest.approx(STATION, abs=0.5)
    steps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(line.points, line.points[1:])]
    assert max(steps) <= 10.0 + 1e-6
    expected = sum(math.dist(a, b) for a, b in zip(SH4, SH4[1:]))
    assert line.length_m == pytest.approx(expected, abs=1.0)
    assert line.cum == sorted(line.cum)


def test_cache_round_trip(gtfs_index: GtfsIndex, tmp_path: Path) -> None:
    p = tmp_path / "slice.json.gz"
    save_index(gtfs_index, p)
    back = load_index(p)
    assert back is not None
    assert back.routes == gtfs_index.routes
    assert back.trips == gtfs_index.trips
    assert set(back.shapes) == set(gtfs_index.shapes)
    a, b = back.shapes["sh1"].line, gtfs_index.shapes["sh1"].line
    assert len(a.points) == len(b.points)
    assert a.length_m == pytest.approx(b.length_m, abs=0.05)


def test_load_missing_cache_returns_none(tmp_path: Path) -> None:
    assert load_index(tmp_path / "nope.json.gz") is None


def test_shapes_payload_clips_but_keeps_full_cumdist(gtfs_index: GtfsIndex) -> None:
    payload = shapes_payload(gtfs_index, LIVE_BBOX_RD)
    by_id = {s["shapeId"]: s for s in payload["shapes"]}
    assert set(by_id) == {"sh4", "sh1", "sh30"}
    sh4 = by_id["sh4"]
    assert sh4["routeShort"] == "4" and sh4["mode"] == "bus" and sh4["color"] == "#00A0E0"
    assert sh4["points"][0][:2] == pytest.approx([485.0, 1217.0], abs=0.5)
    sh30 = by_id["sh30"]["points"]
    # sh30 starts 5.7 km west of the slice: clipped, but cumDist still counts from the shape start
    assert sh30[0][2] > 5000
    assert all(-520 <= p[0] <= 2568 for p in sh30)


def test_clip_indices_keeps_boundary_neighbours() -> None:
    from blox_proxy.config import BBoxRD

    bb = BBoxRD(0, 0, 10, 10)
    pts = [(-20.0, 5.0), (-5.0, 5.0), (5.0, 5.0), (15.0, 5.0), (25.0, 5.0)]
    assert clip_indices(pts, bb) == [1, 2, 3]


def test_stops_payload(gtfs_index: GtfsIndex) -> None:
    stops = {s["stopId"]: s for s in stops_payload(gtfs_index, LIVE_BBOX_RD)["stops"]}
    assert stops["s_vrijthof"]["name"] == "Maastricht, Vrijthof"
    assert stops["s_vrijthof"]["world"] == pytest.approx([485.0, 1217.0], abs=0.5)


def test_mode_and_colour_helpers() -> None:
    assert mode_for_route_type(0) == "tram"
    assert mode_for_route_type(109) == "rail"
    assert mode_for_route_type(715) == "bus"
    assert mode_for_route_type(1200) == "ferry"
    assert route_colour("zz", "bus") == "#1F6FB2"
