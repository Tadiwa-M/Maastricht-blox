import math

import numpy as np
import pytest

from blox_pipeline import geo
from blox_pipeline.geo import CellBox, RDBox


def test_contract_constants():
    assert (geo.X0, geo.Y0) == (175700.0, 316500.0)
    assert geo.STUD_M == 0.5 and geo.PLATE_M == 0.2 and geo.BASE_NAP_M == 30.0
    assert geo.SLICE_STUDS == 4096 and geo.SLICE_M == 2048.0


def test_rd_to_grid_floor_semantics():
    assert geo.rd_to_grid(175700.0, 316500.0) == (0, 0)
    assert geo.rd_to_grid(175700.49, 316500.99) == (0, 1)
    assert geo.rd_to_grid(175699.99, 316499.99) == (-1, -1)
    # Vrijthof reference point
    assert geo.rd_to_grid(176185, 317717) == (970, 2434)


def test_z_to_k_and_back():
    assert geo.z_to_k(30.0) == 0
    assert geo.z_to_k(30.19) == 0
    assert geo.z_to_k(30.2) == 1  # exact level boundaries are not lost to float error
    assert geo.z_to_k(44.1) == 70
    assert geo.z_to_k(29.9) == -1
    for k in (0, 1, 70, 123, 999):
        assert geo.z_to_k(geo.k_to_z(k)) == k
        assert geo.z_to_k(geo.k_to_z(k) + 0.1) == k


def test_grid_rd_round_trip():
    rng = np.random.default_rng(1)
    for _ in range(200):
        i, j = (int(v) for v in rng.integers(0, 4096, 2))
        x, y = geo.grid_to_rd(i, j, centre=True)
        assert geo.rd_to_grid(x, y) == (i, j)
        x0, y0 = geo.grid_to_rd(i, j)
        assert geo.rd_to_grid(x0, y0) == (i, j)


def test_vectorised_matches_scalar():
    xs = np.array([175700.0, 176185.3, 177747.9])
    ys = np.array([316500.0, 317717.7, 318547.9])
    I, J = geo.rd_to_grid_np(xs, ys)
    assert [geo.rd_to_grid(x, y) for x, y in zip(xs, ys)] == list(zip(I.tolist(), J.tolist()))
    assert geo.z_to_k_np([30.2, 44.1]).tolist() == [1, 70]


def test_unity_space():
    assert geo.grid_to_unity(10, 20, 5) == (5.0, 1.0, 10.0)
    x, y, z = geo.rd_to_unity(176185.0, 317717.0, 50.0)
    assert (x, y, z) == pytest.approx((485.0, 20.0, 1217.0))


def test_wgs84_round_trip_and_location():
    lon, lat = geo.grid_to_wgs84(*geo.rd_to_grid(176430, 318007))  # Markt
    assert 5.68 < lon < 5.70 and 50.84 < lat < 50.86
    I, J = geo.wgs84_to_grid(lon, lat)
    assert abs(I - 1460) <= 1 and abs(J - 3014) <= 1
    x, y = geo.wgs84_to_rd(*geo.rd_to_wgs84(176000.0, 317500.0))
    assert float(x) == pytest.approx(176000.0, abs=1e-3) and float(y) == pytest.approx(317500.0, abs=1e-3)


def test_chunks():
    assert geo.chunk_of(0, 0) == (0, 0, 0, 0)
    assert geo.chunk_of(4095, 64) == (63, 1, 63, 0)
    assert geo.chunk_cells(2, 3) == CellBox(128, 192, 192, 256)
    assert list(CellBox(60, 0, 70, 10).chunks()) == [(0, 0), (1, 0)]
    assert list(CellBox(-5, -5, 3, 3).chunks()) == [(0, 0)]


def test_boxes_and_blocks():
    box = RDBox.parse("175700,316500,176212,316756")
    cells = geo.rd_box_to_cells(box)
    assert cells == CellBox(0, 0, 1024, 512)
    assert cells.to_rd() == box
    blocks = list(geo.iter_blocks(RDBox(175710, 316510, 176300, 316600), 512))
    assert [b.as_tuple() for b in blocks] == [(175700, 316500, 176212, 317012), (176212, 316500, 176724, 317012)]
    assert all(math.isclose((b.xmin - geo.X0) % 512, 0) for b in blocks)
    with pytest.raises(ValueError):
        RDBox.parse("1,2,3")
    w, s, e, n = geo.slice_box().to_wgs84()
    assert w < e and s < n and 5.6 < w < 5.8
