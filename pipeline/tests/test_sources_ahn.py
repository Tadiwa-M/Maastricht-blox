from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from blox_pipeline.geo import RDBox, iter_blocks
from blox_pipeline.sources import ahn

NODATA = 3.4028234663852886e38  # what AHN GeoTIFFs use


def write_tif(path: Path, west: float, north: float, data: np.ndarray, nodata: float | None = NODATA) -> None:
    """GeoTIFF exactly like a PDOK WCS response: RD, 0.5 m, north-up, float32."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", width=data.shape[1], height=data.shape[0], count=1,
                       dtype="float32", crs="EPSG:28992", transform=from_origin(west, north, 0.5, 0.5),
                       nodata=nodata) as dst:
        dst.write(data.astype(np.float32), 1)


def test_wcs_params():
    p = dict((k, v) for k, v in ahn.wcs_params("dtm", RDBox(175700, 316500, 176212, 317012)) if k != "SUBSET")
    assert p["COVERAGEID"] == "dtm_05m" and p["REQUEST"] == "GetCoverage" and p["FORMAT"] == "image/tiff"
    subsets = [v for k, v in ahn.wcs_params("dsm", RDBox(175700, 316500, 176212, 317012)) if k == "SUBSET"]
    assert subsets == ["x(175700.0,176212.0)", "y(316500.0,317012.0)"]


def test_mosaic_orientation_and_nodata(tmp_path):
    # 4 x 6 px raster with distinct values; row 0 is the northern edge
    data = np.arange(24, dtype=np.float32).reshape(4, 6) + 40.0
    data[1, 2] = NODATA
    f = tmp_path / "a.tif"
    write_tif(f, 175700.0, 316502.0, data)
    grid = ahn.mosaic([f], RDBox(175700, 316500, 175703, 316502))
    assert (grid.I0, grid.J0) == (0, 0) and grid.values.shape == (6, 4)
    # pixel (row 3, col 0) is the SW corner cell (0, 0); (row 0, col 5) is NE cell (5, 3)
    assert grid.values[0, 0] == data[3, 0]
    assert grid.values[5, 3] == data[0, 5]
    assert np.isnan(grid.values[2, 2])  # row 1 -> j = 2
    filled = ahn.fill_gaps(grid)
    assert not np.isnan(filled.values).any()
    assert 40 < filled.values[2, 2] < 64


def test_mosaic_two_blocks_and_partial_window(tmp_path):
    a = np.full((4, 4), 50.0, np.float32)
    b = np.full((4, 4), 52.0, np.float32)
    write_tif(tmp_path / "a.tif", 175700.0, 316502.0, a)
    write_tif(tmp_path / "b.tif", 175702.0, 316502.0, b)
    grid = ahn.mosaic([tmp_path / "a.tif", tmp_path / "b.tif"], RDBox(175701, 316500, 175705, 316502))
    assert (grid.I0, grid.J0) == (2, 0) and grid.values.shape == (8, 4)
    assert np.all(grid.values[:2] == 50.0) and np.all(grid.values[2:6] == 52.0)
    assert np.isnan(grid.values[6:]).all()  # beyond the data


def test_load_ahn_uses_block_cache(tmp_path):
    bbox = RDBox(175700, 316500, 175710, 316510)
    [block] = list(iter_blocks(bbox, 512.0))
    path = ahn.block_path("dtm", block, tmp_path)
    write_tif(path, block.xmin, block.ymin + 6, np.full((12, 12), 48.5, np.float32))
    grid = ahn.load_ahn("dtm", bbox, tmp_path)
    assert grid.values.shape == (20, 20)
    assert grid.values[0, 0] == pytest.approx(48.5)
    assert not np.isnan(grid.values).any()  # filled from the data that exists
    with pytest.raises(FileNotFoundError):
        ahn.load_ahn("dsm", bbox, tmp_path)


def test_rejects_wrong_pixel_size(tmp_path):
    f = tmp_path / "c.tif"
    with rasterio.open(f, "w", driver="GTiff", width=2, height=2, count=1, dtype="float32",
                       crs="EPSG:28992", transform=from_origin(175700, 316502, 1.0, 1.0)) as dst:
        dst.write(np.zeros((2, 2), np.float32), 1)
    with pytest.raises(ValueError):
        ahn.mosaic([f], RDBox(175700, 316500, 175702, 316502))


def test_local_tiles_fallback_windowed_and_no_wcs(tmp_path, monkeypatch):
    """A large hand-downloaded sheet (AHN5-style, extends far past the bbox) and a second
    tile are mosaicked by windowed reads; fetch_ahn then never touches the WCS."""
    from blox_pipeline.sources import ahn_tiles

    bbox = RDBox(175700, 316500, 175764, 316564)
    d = ahn_tiles.tiles_dir("dtm", tmp_path)
    west = np.full((400, 100), 51.0, np.float32)  # x 175650..175700: ends exactly at the bbox edge
    write_tif(d / "2024_M_west.TIF", 175650.0, 316600.0, west)  # does not reach the bbox
    big = np.full((300, 100), 50.0, np.float32)  # x 175700..175750, y 316450..316600
    big[0, :] = NODATA  # top row, outside the bbox
    write_tif(d / "2024_M_big.TIF", 175700.0, 316600.0, big)
    east = np.full((200, 60), 52.0, np.float32)  # x 175750..175780, y 316500..316600
    write_tif(d / "2024_M_east.tif", 175750.0, 316600.0, east)

    tiles = ahn_tiles.local_tiles("dtm", tmp_path)
    assert len(tiles) == 3
    assert ahn_tiles.covered_fraction(tiles, bbox) == 1.0

    def no_wcs(*a, **k):
        raise AssertionError("WCS must not be called when local tiles cover the bbox")

    monkeypatch.setattr(ahn, "download", no_wcs)
    assert ahn.fetch_ahn("dtm", bbox, tmp_path) == tiles
    g = ahn.load_ahn("dtm", bbox, tmp_path)
    assert g.values.shape == (128, 128)
    assert np.all(g.values[:100] == 50.0) and np.all(g.values[100:] == 52.0)


def test_local_tiles_partial_coverage_is_an_error(tmp_path):
    from blox_pipeline.sources import ahn_tiles

    bbox = RDBox(175700, 316500, 175764, 316564)
    write_tif(ahn_tiles.tiles_dir("dtm", tmp_path) / "a.tif", 175700.0, 316564.0, np.full((128, 64), 50.0, np.float32))
    with pytest.raises(FileNotFoundError, match="cover only 50%"):
        ahn.load_ahn("dtm", bbox, tmp_path)
