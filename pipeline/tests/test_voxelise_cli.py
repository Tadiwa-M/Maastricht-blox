"""CLI: argument handling and an end-to-end ``blox build`` from a cached fixture data dir
(downloads are not exercised; layout/io stages are replaced by recording fakes)."""

import json
from pathlib import Path

import numpy as np
import pytest

from blox_pipeline import cli, geo
from blox_pipeline.geo import RDBox, iter_blocks
from blox_pipeline.sources import ahn, bag3d, osm
from blox_pipeline.sources import config as src_config

from test_sources_ahn import write_tif
from test_sources_osm import write_osm

FIXTURE = Path(__file__).parent / "fixtures" / "sources" / "gabled_building.city.json"
BBOX = RDBox(175956, 316988, 176044, 317044)  # chunks (8..10, 15..16) around the fixture building


def make_data_dir(root: Path) -> None:
    load = RDBox(175940, 316940, 176100, 317100)
    for kind in ("dtm", "dsm"):
        for block in iter_blocks(load, src_config.AHN_BLOCK_M):
            n = int((block.xmax - block.xmin) / 0.5)
            write_tif(ahn.block_path(kind, block, root), block.xmin, block.ymax, np.full((n, n), 50.0, np.float32))
    doc = json.loads(FIXTURE.read_text())
    feature = {"type": "CityJSONFeature", "id": "b", "CityObjects": doc["CityObjects"], "vertices": doc["vertices"]}
    for block in iter_blocks(load, src_config.BAG3D_BLOCK_M):
        d = bag3d.block_dir(block, root)
        d.mkdir(parents=True, exist_ok=True)
        (d / "page_0000.json").write_text(json.dumps({"metadata": {"transform": doc["transform"]},
                                                      "features": [feature], "links": []}))
        (d / "done").write_text("1")
    clip = osm.clip_path(root)
    clip.parent.mkdir(parents=True, exist_ok=True)
    write_osm(clip)


def test_bbox_parsing_and_clipping():
    assert cli._bbox(None) == geo.slice_box()
    assert cli._bbox("175000,316000,175800,316600") == RDBox(175700, 316500, 175800, 316600)
    with pytest.raises(SystemExit):
        cli._bbox("1,1,2,2")


def test_build_reports_missing_stages(monkeypatch, capsys):
    def missing():
        raise cli.MissingStage("brick layout stage unavailable")

    monkeypatch.setattr(cli, "_import_stages", missing)
    assert cli.main(["build", "--bbox", "176000,317000,176010,317010"]) == 2
    assert "layout" in capsys.readouterr().err


def test_build_end_to_end_with_fake_stages(tmp_path, monkeypatch):
    data = tmp_path / "raw"
    make_data_dir(data)
    seen: dict = {"tiles": []}

    def fake_layout(color, feature, shape, k0, I0, J0, border=None, placed=None):
        from blox_pipeline.voxelise.grid import VoxelTile

        tile = VoxelTile(I0, J0, k0, color, feature, shape)
        seen["tiles"].append(tile)
        ii, jj, kk = np.nonzero(tile.color)
        rec = np.zeros(len(ii), [("I", "<i4"), ("J", "<i4"), ("K", "<i4")])
        rec["I"], rec["J"], rec["K"] = ii + tile.I0, jj + tile.J0, kk + tile.k0
        return rec

    def fake_write(out_dir, chunks, features, sources):
        seen.update(out=out_dir, chunks=chunks, features=features, sources=sources)

    monkeypatch.setattr(cli, "_import_stages", lambda: (fake_layout, fake_write, None))
    out = tmp_path / "world"
    assert cli.main(["build", "--bbox", ",".join(str(v) for v in BBOX.as_tuple()),
                     "--data-dir", str(data), "--out", str(out)]) == 0
    assert set(seen["chunks"]) == {(cx, cy) for cx in (8, 9, 10) for cy in (15, 16)}
    for (cx, cy), rec in seen["chunks"].items():
        assert np.all(rec["I"] // 64 == cx) and np.all(rec["J"] // 64 == cy)  # border cells dropped
    kinds = sorted(f["kind"] for f in seen["features"]["features"])
    assert "building" in kinds and "street" in kinds
    assert any(s["name"] == "3D BAG" for s in seen["sources"])
    building_tile = next(t for t in seen["tiles"] if t.I0 <= 610 < t.I0 + t.dims[0] and t.J0 <= 1005 < t.J0 + t.dims[1])
    assert building_tile.column_top(610, 1005) > geo.z_to_k(56.0)


def test_layout_called_with_arrays_and_border():
    from blox_pipeline.voxelise.grid import VoxelTile

    tile = VoxelTile.empty(1, 2, 3, 2, 2, 2)

    def layout(color, feature, shape, k0, I0, J0, *, border=None):
        return (color.shape, k0, I0, J0, border)

    assert cli.call_layout(layout, tile) == ((2, 2, 2), 3, 1, 2, 1)
    assert cli.call_layout(layout, VoxelTile.empty(0, 0, 0, 2, 2, 0)) is None


def test_build_with_real_layout_and_writer(tmp_path):
    """Full chain with the real B2 stages (skipped while they are not importable)."""
    try:
        cli._import_stages()
    except cli.MissingStage as exc:
        pytest.skip(str(exc))
    data = tmp_path / "raw"
    make_data_dir(data)
    out = tmp_path / "world"
    assert cli.main(["build", "--bbox", ",".join(str(v) for v in BBOX.as_tuple()),
                     "--data-dir", str(data), "--out", str(out)]) == 0
    manifest = json.loads((out / "manifest.json").read_text())
    assert {(c["cx"], c["cy"]) for c in manifest["chunks"]} == {(cx, cy) for cx in (8, 9, 10) for cy in (15, 16)}
    feats = json.loads((out / "features.json").read_text())["features"]
    assert any(f.get("bagId") == "NL.IMBAG.Pand.0935100000000001" for f in feats)


def test_real_build_maps_gabled_roof_to_slope_bricks(tmp_path, monkeypatch):
    """B1 roof stacks + underlay must come out of B2 layout as slope/ridge bricks, and every
    written chunk must pass B2's independent verifier against the voxel tile."""
    try:
        cli._import_stages()
    except cli.MissingStage as exc:
        pytest.skip(str(exc))
    from blox_pipeline.catalogue import load_catalogue
    from blox_pipeline.io.chunk_reader import read_world_records

    from blox_pipeline.layout.verify import verify_layout

    layout_tile, write_world, _ = cli._import_stages()
    problems: list[str] = []

    def checked_layout(color, feature, shape, k0, I0, J0, *, border=None, placed=None):
        rec = layout_tile(color, feature, shape, k0, I0, J0, border=border, placed=placed)
        problems.extend(verify_layout(color, feature, shape, rec, k0, I0, J0, border=border, placed=placed))
        return rec

    monkeypatch.setattr(cli, "_import_stages", lambda: (checked_layout, write_world, None))
    data = tmp_path / "raw"
    make_data_dir(data)
    out = tmp_path / "world"
    assert cli.main(["build", "--bbox", ",".join(str(v) for v in BBOX.as_tuple()),
                     "--data-dir", str(data), "--out", str(out), "--no-preview"]) == 0
    assert problems == []
    cat = load_catalogue()
    kinds = [cat[int(t)].kind for _, ch in read_world_records(out) for t in ch.records["type"]]
    assert kinds.count("slope") >= 40 and kinds.count("slope_double") >= 5
