from __future__ import annotations

import pytest

from blox_proxy.geo import rd_to_cell, rd_to_wgs84, rd_to_world, wgs84_to_rd, wgs84_to_world, world_to_rd


def test_vrijthof_rd_to_world_follows_contract_section_1() -> None:
    # I = (176185 - 175700) / 0.5 = 970 -> unity.x = I * 0.5 = 485 m; J = 2434 -> unity.z = 1217 m
    assert rd_to_cell(176185, 317717) == (970, 2434)
    assert rd_to_world(176185, 317717) == pytest.approx((485.0, 1217.0))
    assert world_to_rd(485.0, 1217.0) == pytest.approx((176185.0, 317717.0))


def test_slice_corners() -> None:
    assert rd_to_world(175700, 316500) == (0.0, 0.0)
    assert rd_to_world(175700 + 2048, 316500 + 2048) == (2048.0, 2048.0)


def test_amersfoort_reference_point() -> None:
    # Onze Lieve Vrouwetoren, Amersfoort: RD origin (155000, 463000)
    x, y = wgs84_to_rd(52.15517440, 5.38720621)
    assert abs(x - 155000) < 1.0 and abs(y - 463000) < 1.0


def test_round_trip_and_vrijthof_wgs84() -> None:
    lat, lon = rd_to_wgs84(176185, 317717)
    assert lat == pytest.approx(50.8489, abs=0.0005)
    assert lon == pytest.approx(5.6880, abs=0.0005)
    wx, wz = wgs84_to_world(lat, lon)
    assert wx == pytest.approx(485.0, abs=0.01)
    assert wz == pytest.approx(1217.0, abs=0.01)
