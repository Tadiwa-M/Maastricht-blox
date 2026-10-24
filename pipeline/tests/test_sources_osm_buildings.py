"""OSM + AHN fallback buildings (used when 3D BAG is unreachable)."""

from __future__ import annotations

import numpy as np
import pytest
from shapely.geometry import box

from blox_pipeline import geo
from blox_pipeline.sources import fetch_all, http
from blox_pipeline.sources.bag3d import footprint
from blox_pipeline.sources.model import HeightGrid, OsmData, OsmFeature
from blox_pipeline.sources.osm_buildings import fallback_buildings, synth_building
from blox_pipeline.voxelise.prepare_buildings import roof_planes

X, Y = geo.X0 + 100.0, geo.Y0 + 100.0
HOUSE = box(X, Y, X + 16.0, Y + 8.0)  # ridge along x (east-west)


def grids(gable: bool) -> tuple[HeightGrid, HeightGrid]:
    cells = geo.rd_box_to_cells(geo.RDBox(X - 10, Y - 10, X + 30, Y + 20))
    xs, ys = geo.cell_centres_rd(cells.i0, cells.j0, cells.ni, cells.nj)
    dtm = np.full(xs.shape, 50.0, np.float32)
    inside = (xs > X) & (xs < X + 16) & (ys > Y) & (ys < Y + 8)
    roof = 59.0 - 3.0 * np.abs(ys - (Y + 4.0)) / 4.0 if gable else np.full(xs.shape, 58.0)
    dsm = np.where(inside, roof, 50.0).astype(np.float32)
    return HeightGrid(cells.i0, cells.j0, dtm), HeightGrid(cells.i0, cells.j0, dsm)


def test_gable_roof_follows_long_axis() -> None:
    dtm, dsm = grids(gable=True)
    b = synth_building("osm-way/1", HOUSE, dtm, dsm)
    assert b is not None and b.ground_z == pytest.approx(50.0)
    planes = roof_planes(b)
    assert len(planes) == 2
    for p in planes:
        assert abs(p.normal[0]) < 1e-6 and abs(p.normal[1]) > 0.1  # slopes face north/south
    assert b.roof_max_z == pytest.approx(58.7, abs=0.4)
    assert footprint(b).area == pytest.approx(HOUSE.area, rel=1e-6)


def test_flat_roof_when_dsm_is_level() -> None:
    dtm, dsm = grids(gable=False)
    b = synth_building("osm-way/2", HOUSE, dtm, dsm)
    assert b is not None
    planes = roof_planes(b)
    assert len(planes) == 1 and planes[0].normal[2] == pytest.approx(1.0)
    assert b.roof_max_z == pytest.approx(58.0)


def test_skips_footprints_3dbag_already_covers() -> None:
    dtm, dsm = grids(gable=True)
    real = synth_building("NL.IMBAG.Pand.1", HOUSE, dtm, dsm)
    other = box(X + 40, Y, X + 50, Y + 8)
    osm = OsmData(buildings=[OsmFeature("way/1", {"building": "yes"}, HOUSE),
                             OsmFeature("way/2", {"building": "yes"}, other)])
    out = fallback_buildings(osm, [real], dtm, dsm)
    assert [b.bag_id for b in out] == []  # way/2 lies outside the DSM: no samples, skipped
    assert len(fallback_buildings(osm, [], dtm, dsm)) == 1


def test_fetch_continues_after_a_failed_source(monkeypatch: pytest.MonkeyPatch) -> None:
    import blox_pipeline.sources as src

    calls: list[str] = []

    def boom(*_a, **_k):
        calls.append("bag3d")
        raise http.DownloadError("api down")

    monkeypatch.setattr(src, "fetch_bag3d", boom)
    monkeypatch.setattr(src, "fetch_osm", lambda *_a, **_k: calls.append("osm"))
    with pytest.raises(http.DownloadError, match="bag3d"):
        fetch_all(geo.slice_box(), only=("bag3d", "osm"))
    assert calls == ["bag3d", "osm"]
