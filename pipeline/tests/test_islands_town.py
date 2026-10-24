"""Islands on the real-data path: the synthetic town (``town_fixture``) through sources ->
prepare (grouping, paving) -> island voxelising/layout -> .bxi -> preview.

The fixture has a house turned 30 deg (one island), a terrace of three touching houses turned
-20 deg (one island, yaw +20) with a pedestrian street along its front, and a house turned
only 2 deg that must stay on the world grid."""

from __future__ import annotations

import json
import math
import os
import shutil
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Polygon

from blox_pipeline import cli, geo
from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade.frame import DIRS
from blox_pipeline.facade.spec import GroundFloor
from blox_pipeline.io import read_manifest, read_world_islands, read_world_records
from blox_pipeline.islands import IslandPose, build_group, build_islands
from blox_pipeline.islands.build import ISLAND_STUDS, split_tiles
from blox_pipeline.islands.frame import local_dtm
from blox_pipeline.islands.orient import footprint_yaw
from blox_pipeline.layout import verify_layout
from blox_pipeline.layout.placed import placed_box
from blox_pipeline.layout.records import RECORD_DTYPE
from blox_pipeline.preview.topdown import Tops, column_tops, island_column_tops
from blox_pipeline.rotation import rot_to_facing
from blox_pipeline.sources import OsmData, SourceData, load_all
from blox_pipeline.sources.model import Building, HeightGrid, Surface
from blox_pipeline.voxelise import VoxelConfig, build_layers, palette, prepare_world
from blox_pipeline.voxelise.facade_runs import facade_stats

import town_fixture as town

CAT = load_catalogue()
DETAIL = {CAT.id(n) for n in ("window_1x2x3", "window_1x2x2", "door_1x2x4", "arch_1x4")}


def make_world(root, islands: bool = True):
    return prepare_world(load_all(town.LOAD, root), VoxelConfig(use_ortho_ground=False, islands=islands))


@pytest.fixture(scope="module")
def town_world(tmp_path_factory):
    root = town.write_data_dir(tmp_path_factory.mktemp("town_islands"))
    world = make_world(root)
    results = [build_group(world, g, keep_tiles=True) for g in world.islands]
    return root, world, results


def fid(world, sfx: str) -> int:
    return world.registry._by_key[("building", town.bag_id(sfx))]


def group_of(world, results, sfx: str):
    f = fid(world, sfx)
    return next((g, r) for g, r in zip(world.islands, results) if f in g.fids)


def test_turned_buildings_become_islands_and_two_degrees_stays(town_world):
    _, world, _ = town_world
    assert [sorted(g.fids) for g in world.islands] == [[fid(world, "5")], sorted(fid(world, s) for s in "678")]
    assert world.islands[0].yaw_deg == pytest.approx(-30.0, abs=0.1)
    assert world.islands[1].yaw_deg == pytest.approx(20.0, abs=0.1)
    near = next(b for b in world.buildings if b.bag_id == town.bag_id("9"))
    assert abs(footprint_yaw(near.footprint)[0]) == pytest.approx(2.0, abs=0.1)
    assert {b.bag_id[-1] for b in world.buildings} == set("12349")


def test_island_layouts_verify_with_placed_pieces(town_world):
    _, _, results = town_world
    pieces = 0
    for r in results:
        for t, rec in r.tiles:
            if t.dims[2] == 0:
                continue
            assert verify_layout(t.color, t.feature, t.shape, rec, t.k0, t.I0, t.J0, border=1, placed=t.placed) == []
            pieces += 0 if t.placed is None else len(t.placed)
    assert pieces >= 150


def test_island_records_fit_the_local_grid(town_world):
    _, world, results = town_world
    for g, r in zip(world.islands, results):
        assert len(r.islands) == 1
        rec = r.islands[0].records
        assert len(rec) > 500
        assert set(np.unique(rec["featureId"]).tolist()) <= set(g.fids)
        for row in rec:
            i0, i1, j0, j1, _, _ = placed_box(CAT, row)
            assert 0 <= i0 and i1 <= ISLAND_STUDS and 0 <= j0 and j1 <= ISLAND_STUDS
            assert i0 // 64 == (i1 - 1) // 64 and j0 // 64 == (j1 - 1) // 64  # sub-tile rule


def test_every_island_wall_is_detailed_and_shops_follow_the_world_street(town_world):
    _, world, results = town_world
    _, r = group_of(world, results, "7")
    assert r.facades and all(p.detail for p in r.facades)
    kinds = {(p.fid, p.normal): p.run.ground for p in r.facades}
    for sfx in "678":
        assert kinds[(fid(world, sfx), "N")] is GroundFloor.SHOP   # local +j: the street side
        assert kinds[(fid(world, sfx), "S")] is GroundFloor.PLAIN  # back yards
    long_runs = [p.length for p in r.facades if p.normal in ("N", "S")]
    assert min(long_runs) >= 12  # whole house fronts, not staircase steps


def test_island_pieces_face_out_of_their_local_wall(town_world):
    """Air in front, something behind: wall/backdrop voxels, or (where two detailed walls
    meet at a corner) the neighbouring wall's own piece."""
    _, _, results = town_world
    seen = 0
    for r in results:
        for t, _ in r.tiles:
            boxes = [placed_box(CAT, row) for row in (t.placed if t.placed is not None else [])]

            def in_piece(I: int, J: int, K: int) -> bool:
                return any(a <= I < b and c <= J < d and e <= K < f for a, b, c, d, e, f in boxes)

            for row in t.placed if t.placed is not None else []:
                if int(row["type"]) not in DETAIL:
                    continue
                i0, _, j0, _, k0, k1 = placed_box(CAT, row)
                di, dj = DIRS[rot_to_facing(int(row["rot"]) & 3).name]
                km = (k0 + k1) // 2
                assert t.at(i0 + di, j0 + dj, km)[0] == 0 and not in_piece(i0 + di, j0 + dj, km)
                assert t.at(i0 - di, j0 - dj, km)[0] != 0 or in_piece(i0 - di, j0 - dj, km)
                seen += 1
    assert seen >= 80


def test_plinth_goes_two_plates_below_local_ground(town_world):
    _, world, results = town_world
    for g, r in zip(world.islands, results):
        dtm = local_dtm(world, r.frame)
        lows = 0
        for t, _ in r.tiles:
            ni, nj, nk = t.dims
            if nk == 0:
                continue
            for i in range(1, ni - 1):
                for j in range(1, nj - 1):
                    col = t.feature[i, j]
                    if not np.isin(col, g.fids).any() or not (t.color[i, j] != 0).any():
                        continue
                    I, J = t.I0 + i, t.J0 + j
                    ground = geo.z_to_k(float(dtm.sample(I, J)))
                    low = int(np.flatnonzero(t.color[i, j])[0]) + t.k0
                    if low == ground - 1:
                        lows += 1
                    assert low >= ground - 1  # never deeper than 2 plates, no terrain kept
        assert lows > 100


def test_island_buildings_are_not_in_chunks_and_their_footprint_is_paved(town_world):
    _, world, _ = town_world
    from blox_pipeline.voxelise import iter_chunk_tiles

    pave = palette.idx("pavement")
    isl_fids = {f for g in world.islands for f in g.fids}
    centres = [b.footprint.representative_point() for g in world.islands for b in g.members]
    paved = 0
    for cx, cy, tile in iter_chunk_tiles(world, geo.rd_box_to_cells(town.BBOX)):
        assert not np.isin(tile.feature, list(isl_fids)).any()
        for p in centres:
            I, J = geo.rd_to_grid(p.x, p.y)
            if tile.I0 + 1 <= I < tile.I0 + tile.dims[0] - 1 and tile.J0 + 1 <= J < tile.J0 + tile.dims[1] - 1:
                top = tile.column_top(I, J)
                assert top is not None and tile.at(I, J, top)[0] == pave
                paved += 1
    assert paved == len(centres)


def test_neighbours_see_islands_as_occupied(town_world):
    _, world, _ = town_world
    p = world.islands[1].members[1].footprint.representative_point()
    I, J = geo.rd_to_grid(p.x, p.y)
    L = build_layers(world, geo.CellBox(I - 2, J - 2, I + 3, J + 3))
    assert L.island_k[2, 2] > L.ground_k[2, 2] + 40 and L.bld_top[2, 2] == -1


def test_facade_detail_share_before_and_after(town_world):
    root, world, results = town_world
    before = facade_stats(make_world(root, islands=False).facades)
    after = facade_stats(world.facades + [p for r in results for p in r.facades])
    assert before.share < 0.45 and before.by_reason.get("short", 0) > 200
    assert after.share > 0.9 and "short" not in after.by_reason
    assert after.detailed_length > 2 * before.detailed_length - 10


def test_islands_are_deterministic(town_world):
    _, world, results = town_world
    again = [build_group(world, g) for g in world.islands]
    for a, b in zip(results, again):
        assert [i.pose for i in a.islands] == [i.pose for i in b.islands]
        for x, y in zip(a.islands, b.islands):
            assert np.array_equal(x.records, y.records)


def test_split_tiles_keeps_bricks_whole_and_origins_adjacent():
    rec = np.zeros(3, RECORD_DTYPE)
    rec["I"], rec["J"], rec["K"] = [10, 256, 300], [5, 5, 260], 100
    rec["type"] = CAT.id("plate_1x1")
    pose = IslandPose((100.0, 50.0), 20.0)
    out = split_tiles(rec, pose, (1,))
    assert len(out) == 3
    for isl in out:
        assert (isl.records["I"] < 256).all() and (isl.records["J"] < 256).all()
    assert out[1].pose.to_world(0, 0) == pytest.approx(pose.to_world(128.0, 0.0))
    assert out[2].pose.to_world(44 * 0.5, 4 * 0.5) == pytest.approx(pose.to_world(300 * 0.5, 260 * 0.5))


def turned_block(bag_id: str, centre, length: float, depth: float, deg: float, roof: float, ground: float) -> Building:
    a = math.radians(deg)
    u, v = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
    c = np.array(centre)
    ring = [c + sx * length / 2 * u + sy * depth / 2 * v for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    top = np.array([[*p, roof] for p in ring])
    floor = top[::-1].copy()
    floor[:, 2] = ground
    attrs = {"identificatie": bag_id, "oorspronkelijkbouwjaar": 1990, "b3_h_maaiveld": ground, "b3_h_dak_max": roof}
    return Building(bag_id, attrs, "2.2", [Surface("roof", top), Surface("ground", floor)])


def test_long_block_splits_into_adjacent_islands():
    """A 150 m block turned 15 deg is 300+ local studs long: two islands, same yaw,
    origins 128 m apart along local i, together covering the whole block."""
    centre = (176500.0, 317500.0)
    I, J = geo.rd_to_grid(*centre)
    dtm = HeightGrid(I - 300, J - 300, np.full((600, 600), 50.0, np.float32))
    b = turned_block("NL.IMBAG.Pand.LONG", centre, 150.0, 8.0, 15.0, 59.0, 50.0)
    world = prepare_world(SourceData(dtm, None, [b], OsmData(), None), VoxelConfig(facade_detail=False))
    assert len(world.islands) == 1 and world.buildings == []
    islands, _ = build_islands(world)
    assert len(islands) == 2 and [i.id for i in islands] == [1, 2]
    a, c = islands
    assert a.pose.yaw_deg == c.pose.yaw_deg == pytest.approx(-15.0, abs=0.1)
    assert c.pose.to_world(0, 0) == pytest.approx(a.pose.to_world(128.0, 0.0))
    assert int(a.records["I"].max()) >= 250 and int(c.records["I"].min()) == 0
    # the block's world footprint is covered by the two islands' columns
    tops = Tops(np.full((300, 600), -1, np.int64), np.zeros((300, 600), np.uint8), np.zeros((300, 600), bool))
    for isl in islands:
        island_column_tops(isl.records, isl.pose.origin, isl.pose.yaw_deg, I - 300, J - 150, 600, 300, CAT, into=tops)
    fp = Polygon(world.islands[0].members[0].footprint.exterior).buffer(-0.5)
    xs = np.linspace(fp.bounds[0], fp.bounds[2], 200)
    hits = [tops.top[geo.rd_to_grid(x, y)[1] - (J - 150), geo.rd_to_grid(x, y)[0] - (I - 300)]
            for x in xs for y in np.linspace(fp.bounds[1], fp.bounds[3], 30) if fp.contains(_pt(x, y))]
    assert hits and min(hits) > geo.z_to_k(50.0)


def test_party_wall_against_an_on_grid_neighbour_gets_no_facade():
    """An island house whose west wall is shared with an axis-aligned neighbour (which stays
    on the world grid): the island's local world must see the neighbour as occupied, so that
    wall is not planned as a street front. Before the fix it got a full detailed facade."""
    centre = (176500.0, 317500.0)
    I, J = geo.rd_to_grid(*centre)
    dtm = HeightGrid(I - 200, J - 200, np.full((400, 400), 50.0, np.float32))
    house = turned_block("NL.IMBAG.Pand.R", centre, 12.0, 8.0, 15.0, 59.0, 50.0)
    a = math.radians(15.0)
    u, v, c = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)]), np.array(centre)
    p0, p3 = c - 6.0 * u - 4.0 * v, c - 6.0 * u + 4.0 * v  # the house's west wall
    ring = [tuple(p3), (p3[0] - 14, p3[1]), (p0[0] - 14, p0[1]), tuple(p0)]
    top = np.array([[*p, 59.0] for p in ring])
    floor = top[::-1].copy()
    floor[:, 2] = 50.0
    attrs = {"identificatie": "NL.IMBAG.Pand.N", "oorspronkelijkbouwjaar": 1990, "b3_h_maaiveld": 50.0,
             "b3_h_dak_max": 59.0}
    neighbour = Building("NL.IMBAG.Pand.N", attrs, "2.2", [Surface("roof", top), Surface("ground", floor)])

    def west_detail(blds: list[Building]) -> int:
        w = prepare_world(SourceData(dtm, None, blds, OsmData(), None), VoxelConfig(use_ortho_ground=False))
        assert len(w.islands) == 1
        return sum(p.length for p in build_group(w, w.islands[0]).facades if p.normal == "W" and p.detail)

    assert west_detail([house]) >= 15          # free-standing: the west wall is a facade
    assert west_detail([house, neighbour]) == 0  # against the neighbour: party wall


def _pt(x: float, y: float):
    from shapely.geometry import Point

    return Point(x, y)


def test_blox_build_writes_islands_and_preview(town_world, tmp_path):
    root, world, _ = town_world
    out = tmp_path / "world"
    bbox = ",".join(str(v) for v in town.BBOX.as_tuple())
    assert cli.main(["build", "--data-dir", str(root), "--bbox", bbox, "--out", str(out), "--no-ortho"]) == 0
    m = read_manifest(out)
    assert m["contractVersion"] == 4 and len(m["islands"]) == 2
    isl = {e["id"]: d for e, d in read_world_islands(out)}
    assert sorted(isl) == [1, 2] and all(len(d.records) > 500 for d in isl.values())
    assert {round(d.yaw_deg) for d in isl.values()} == {-30, 20}
    chunk_fids = {int(f) for _, ch in read_world_records(out) for f in np.unique(ch.records["featureId"])}
    assert not chunk_fids & {f for g in world.islands for f in g.fids}
    assert (out / "preview.png").is_file()
    # the preview's column tops: the terrace centre is roof (island), not the paving below it
    cx0, cy0 = min(c["cx"] for c in m["chunks"]), min(c["cy"] for c in m["chunks"])
    ni, nj = 64 * 4, 64 * 3
    base = Tops(np.full((nj, ni), -1, np.int64), np.zeros((nj, ni), np.uint8), np.zeros((nj, ni), bool))
    for _, ch in read_world_records(out):
        column_tops(ch.records, cx0 * 64, cy0 * 64, ni, nj, CAT, into=base)
    I, J = geo.rd_to_grid(*town.TURNED_CENTRE)
    ground_top = int(base.top[J - cy0 * 64, I - cx0 * 64])
    for d in isl.values():
        island_column_tops(d.records, d.origin, d.yaw_deg, cx0 * 64, cy0 * 64, ni, nj, CAT, into=base)
    assert int(base.top[J - cy0 * 64, I - cx0 * 64]) > ground_top + 50


def test_island_share_estimate_on_a_pre_islands_world(town_world, tmp_path):
    """The estimator behind the samples/markt number, checked where the truth is known:
    rebuilt from a ``--no-islands`` world it finds the same 4 island buildings in 2 groups."""
    from blox_pipeline.tools.island_share import island_share

    root, world, _ = town_world
    out = tmp_path / "flat"
    bbox = ",".join(str(v) for v in town.BBOX.as_tuple())
    assert cli.main(["build", "--data-dir", str(root), "--bbox", bbox, "--out", str(out), "--no-ortho",
                     "--no-islands", "--no-preview"]) == 0
    r = island_share(out)
    assert (r.buildings, r.islands, r.groups) == (9, 4, 2)
    assert r.yaws[fid(world, "5")] == pytest.approx(-30.0, abs=3.0)
    assert r.yaws[fid(world, "7")] == pytest.approx(20.0, abs=3.0)


TOWN_WORLD = Path(__file__).parent / "fixtures" / "town_world"


def _world_files(d: Path) -> dict[str, bytes]:
    out = {p.relative_to(d).as_posix(): p.read_bytes() for p in sorted(d.rglob("*")) if p.is_file()}
    m = json.loads(out.pop("manifest.json"))
    m.pop("generated")
    out["manifest.json"] = json.dumps(m, sort_keys=True).encode()
    return out


def test_committed_town_world_is_current(town_world, tmp_path):
    """``tests/fixtures/town_world`` is the town fixture built the real way (``blox build``,
    no preview). The C# tests read it (dotnet IslandTests) to prove that pipeline-built islands
    load and mesh there, so it must match what the pipeline writes today.
    Regenerate with ``BLOX_REGEN_FIXTURES=1 uv run pytest tests/test_islands_town.py``."""
    root, _, _ = town_world
    out = tmp_path / "world"
    bbox = ",".join(str(v) for v in town.BBOX.as_tuple())
    assert cli.main(["build", "--data-dir", str(root), "--bbox", bbox, "--out", str(out), "--no-ortho",
                     "--no-preview"]) == 0
    if os.environ.get("BLOX_REGEN_FIXTURES") == "1":
        shutil.rmtree(TOWN_WORLD, ignore_errors=True)
        shutil.copytree(out, TOWN_WORLD)
    fresh, committed = _world_files(out), _world_files(TOWN_WORLD)
    assert sorted(fresh) == sorted(committed)
    stale = [name for name in fresh if fresh[name] != committed[name]]
    assert not stale, f"stale fixture files {stale}: regenerate (see docstring)"
