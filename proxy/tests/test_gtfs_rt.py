from __future__ import annotations

import pytest

from blox_proxy.config import LIVE_BBOX_RD
from blox_proxy.gtfs.model import GtfsIndex
from blox_proxy.http import UpstreamError
from blox_proxy.matching import ShapeMatcher
from blox_proxy.sources.gtfs_rt import parse_trip_delays, parse_vehicle_positions
from blox_proxy.vehicles import build_vehicles

from builders import BONNEFANTEN, HEERLEN, MARKT, STATION, VRIJTHOF, lerp, trip_update_feed, vehicle_feed

NOW = 1_760_700_000


def _feed() -> bytes:
    return vehicle_feed(
        NOW,
        [
            {"id": "1234", "trip": "t4", "rd": lerp(VRIJTHOF, MARKT, 0.5), "ts": NOW - 10, "bearing": 40.0, "speed": 6.1},
            {"id": "ARR:777", "trip": "t1", "rd": lerp(STATION, BONNEFANTEN, 0.25), "ts": NOW - 5},
            {"id": "far", "trip": "t9", "rd": HEERLEN, "ts": NOW - 5},
            {"id": "ghost", "trip": "unknown-trip", "rd": (176500.0, 317500.0), "ts": NOW - 5},
            {"id": "old", "trip": "t4b", "rd": VRIJTHOF, "ts": NOW - 3600},
        ],
    )


def test_parse_vehicle_positions() -> None:
    ts, obs = parse_vehicle_positions(_feed())
    assert ts == NOW
    assert [o.key for o in obs] == ["1234", "ARR:777", "far", "ghost", "old"]
    o = obs[0]
    assert o.trip_id == "t4" and o.bearing_deg == pytest.approx(40.0) and o.speed_mps == pytest.approx(6.1)
    assert obs[1].bearing_deg is None and obs[1].speed_mps is None


def test_bad_protobuf_raises() -> None:
    with pytest.raises(UpstreamError):
        parse_vehicle_positions(b"\xff\xff\xff not a protobuf")


def test_trip_delays_pick_next_stop_or_trip_delay() -> None:
    assert parse_trip_delays(trip_update_feed(NOW), NOW) == {"t4": 45, "t1": -20}


def test_build_vehicles(gtfs_index: GtfsIndex) -> None:
    ts, obs = parse_vehicle_positions(_feed())
    delays = parse_trip_delays(trip_update_feed(NOW), NOW)
    out = build_vehicles(obs, delays, gtfs_index, ShapeMatcher(), LIVE_BBOX_RD, NOW, ts, 300)
    by_id = {v["id"]: v for v in out}
    assert set(by_id) == {"ARR:1234", "ARR:777", "ghost"}  # far + old dropped

    v = by_id["ARR:1234"]
    assert v["mode"] == "bus" and v["operator"] == "ARR" and v["routeShort"] == "4"
    assert v["routeId"] == "r4" and v["tripId"] == "t4" and v["headsign"] == "Station"
    assert v["shapeId"] == "sh4" and v["delaySec"] == 45 and v["observedTs"] == NOW - 10
    half_leg = ((MARKT[0] - VRIJTHOF[0]) ** 2 + (MARKT[1] - VRIJTHOF[1]) ** 2) ** 0.5 / 2
    assert v["distAlongShapeM"] == pytest.approx(half_leg, abs=2.0)
    wx = (VRIJTHOF[0] + MARKT[0]) / 2 - 175700
    wz = (VRIJTHOF[1] + MARKT[1]) / 2 - 316500
    assert v["world"] == pytest.approx([wx, wz], abs=0.5)
    assert v["bearingDeg"] == 40.0 and v["speedMps"] == 6.1

    loop = by_id["ARR:777"]
    assert loop["shapeId"] == "sh1" and loop["delaySec"] == -20
    assert loop["bearingDeg"] is not None  # filled from shape heading

    ghost = by_id["ghost"]
    assert ghost["shapeId"] is None and ghost["distAlongShapeM"] is None and ghost["routeShort"] is None
