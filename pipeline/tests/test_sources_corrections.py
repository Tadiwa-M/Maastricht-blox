"""corrections/corrections.json: hand fixes applied to the loaded sources."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import box

from blox_pipeline import geo
from blox_pipeline.sources.bag3d import footprint
from blox_pipeline.sources.corrections import CorrectionError, apply_corrections, check_fix, load_corrections
from blox_pipeline.sources.model import HeightGrid, OsmData, OsmFeature
from blox_pipeline.sources.osm_buildings import synth_building

X, Y = geo.X0 + 100.0, geo.Y0 + 100.0


def grids() -> tuple[HeightGrid, HeightGrid]:
    cells = geo.rd_box_to_cells(geo.RDBox(X - 20, Y - 20, X + 60, Y + 40))
    xs, ys = geo.cell_centres_rd(cells.i0, cells.j0, cells.ni, cells.nj)
    dtm = np.full(xs.shape, 50.0, np.float32)
    dsm = np.where((xs > X) & (xs < X + 16) & (ys > Y) & (ys < Y + 8), 58.0, 50.0).astype(np.float32)
    return HeightGrid(cells.i0, cells.j0, dtm), HeightGrid(cells.i0, cells.j0, dsm)


def house(bid: str = "NL.IMBAG.Pand.1"):
    dtm, dsm = grids()
    return synth_building(bid, box(X, Y, X + 16, Y + 8), dtm, dsm)


def test_remove_by_id_and_by_point() -> None:
    dtm, _ = grids()
    a, b = house("A"), house("B")
    out, rep = apply_corrections([{"kind": "remove_building", "bag": "A"}], [a, b], OsmData(), dtm)
    assert [x.bag_id for x in out] == ["B"] and len(rep.applied) == 1
    out, rep = apply_corrections([{"kind": "remove_building", "at": [X + 5, Y + 4]}], [a], OsmData(), dtm)
    assert out == []
    out, rep = apply_corrections([{"id": "gone", "kind": "remove_building", "at": [X - 15, Y]}], [a], OsmData(), dtm)
    assert len(out) == 1 and rep.unmatched == ["gone (remove_building)"]


def test_set_height_and_add_building() -> None:
    dtm, _ = grids()
    out, _ = apply_corrections([{"kind": "set_height", "bag": "A", "height_m": 12.0}], [house("A")], OsmData(), dtm)
    assert out[0].roof_max_z == pytest.approx(62.0)
    poly = [[X + 30, Y], [X + 40, Y], [X + 40, Y + 6], [X + 30, Y + 6]]
    out, _ = apply_corrections([{"id": "kiosk", "kind": "add_building", "polygon": poly, "height_m": 5, "roof": "gable",
                                 "eave_m": 3}], [], OsmData(), dtm)
    b = out[0]
    assert b.bag_id == "fix-kiosk" and b.ground_z == pytest.approx(50.0) and b.roof_max_z == pytest.approx(55.0)
    assert footprint(b).area == pytest.approx(60.0, rel=1e-6)


def test_osm_tags() -> None:
    dtm, _ = grids()
    osm = OsmData(roads=[OsmFeature("way/7", {"highway": "primary", "tunnel": "yes"}, box(0, 0, 1, 1))])
    apply_corrections([{"kind": "osm_tags", "osm": "way/7", "set": {"bridge": "yes"}, "remove": ["tunnel"]}], [], osm, dtm)
    assert osm.roads[0].tags == {"highway": "primary", "bridge": "yes"}


def test_validation_and_file(tmp_path: Path) -> None:
    with pytest.raises(CorrectionError, match="kind"):
        check_fix({"kind": "paint_it_red"})
    with pytest.raises(CorrectionError, match="bag"):
        check_fix({"kind": "remove_building"})
    with pytest.raises(CorrectionError, match="polygon"):
        check_fix({"kind": "add_building", "polygon": [[0, 0]], "height_m": 3})
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"version": 1, "fixes": [{"kind": "remove_building", "at": [1, 2]}]}))
    assert len(load_corrections(p)) == 1
    assert load_corrections(tmp_path / "missing.json") == []
    repo_file = Path(__file__).resolve().parents[2] / "corrections" / "corrections.json"
    load_corrections(repo_file)  # the checked-in file must always validate
