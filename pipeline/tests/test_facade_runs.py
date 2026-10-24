"""Facade grammar on the real-data path: the synthetic town (``town_fixture``) through
sources -> prepare -> runs -> voxel tiles -> layout, chunk by chunk like ``blox build``."""

from __future__ import annotations

from collections import Counter

import numpy as np
import pytest
from shapely import affinity
from shapely.geometry import box as shp_box

from blox_pipeline import geo
from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade.frame import DIRS
from blox_pipeline.facade.spec import GroundFloor
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.layout.placed import placed_box
from blox_pipeline.rotation import rot_to_facing
from blox_pipeline.sources import load_all
from blox_pipeline.voxelise import VoxelConfig, iter_chunk_tiles, palette, prepare_world
from blox_pipeline.voxelise.facade_runs import axis_edges, facade_stats

import town_fixture as town

CAT = load_catalogue()
DETAIL = {CAT.id(n) for n in ("window_1x2x3", "window_1x2x2", "door_1x2x4", "arch_1x4", "window_1x2x4",
                             "shop_window_1x2x4")}


def build_town(root, islands: bool = True):
    src = load_all(town.LOAD, root)
    world = prepare_world(src, VoxelConfig(use_ortho_ground=False, islands=islands))
    chunks = {}
    for cx, cy, tile in iter_chunk_tiles(world, geo.rd_box_to_cells(town.BBOX)):
        rec = layout_tile(tile.color, tile.feature, tile.shape, tile.k0, tile.I0, tile.J0,
                          border=1, placed=tile.placed)
        chunks[(cx, cy)] = (tile, rec)
    return world, chunks


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = town.write_data_dir(tmp_path_factory.mktemp("town"))
    world, chunks = build_town(root)
    return root, world, chunks


def fid_of(world, suffix: str) -> int:
    return next(b.feature_id for b in world.buildings if b.bag_id == town.bag_id(suffix))


def runs_of(world, suffix: str):
    return [r for r in world.facades if r.fid == fid_of(world, suffix)]


def placed_all(chunks) -> np.ndarray:
    parts = [t.placed for t, _ in chunks.values() if t.placed is not None]
    return np.concatenate(parts)


def test_layout_verifies_with_placed_pieces(built):
    _, _, chunks = built
    for (cx, cy), (t, rec) in chunks.items():
        assert verify_layout(t.color, t.feature, t.shape, rec, t.k0, t.I0, t.J0, border=1, placed=t.placed) == []
    names = Counter(CAT[int(x)].name for x in placed_all(chunks)["type"])
    # the town lies in the old centre (look v2): tall sash windows, stone shop fronts, vents
    assert names["window_1x2x3"] + names["window_1x2x4"] >= 80 and names["door_1x2x4"] >= 4
    assert names["window_1x2x2"] >= 2 and names["window_1x2x4"] >= 40 and names["vent_1x2"] >= 4
    # old-centre shops are stone fronts with lettered shop windows, not arcades
    assert names["shop_window_1x2x4"] >= 4 and names["grille_1x2"] >= 4 and names["slope30_1x2"] >= 40


def test_pieces_never_cross_chunk_borders(built):
    _, _, chunks = built
    for (cx, cy), (t, rec) in chunks.items():
        for row in rec:
            i0, i1, j0, j1, _, _ = placed_box(CAT, row)
            assert (i0 // 64, (i1 - 1) // 64, j0 // 64, (j1 - 1) // 64) == (cx, cx, cy, cy)


def test_window_pieces_face_out_of_their_wall(built):
    """Every window/door/arch sits in a detailed run's wall plane (or its gable row for attic
    windows), faces that run's outward normal, with air in front and wall behind."""
    _, world, chunks = built
    seen = 0
    for (cx, cy), (t, _) in chunks.items():
        for row in t.placed if t.placed is not None else []:
            if int(row["type"]) not in DETAIL:
                continue
            i0, i1, j0, j1, k0, k1 = placed_box(CAT, row)
            km = (k0 + k1) // 2  # mid-height: below it may sit a flower box
            facing = rot_to_facing(int(row["rot"]) & 3).name
            owners = [r for r in world.facades if r.detail and r.fid == int(row["featureId"])
                      and any(r.cell(a, d) == (i0, j0) for a in range(r.a0, r.a1)
                              for d in (0, 1, *(df for _, df, _, _ in r.dormers)))]
            assert owners, f"piece at {(i0, j0, k0)} belongs to no run"
            assert facing in {r.normal for r in owners}
            di, dj = DIRS[facing]
            front = t.at(i0 + di, j0 + dj, km)[0]
            back = t.at(i0 - di, j0 - dj, km)[0]
            assert front == 0 and back != 0
            seen += 1
    assert seen >= 80


def test_rotated_building_falls_back_cleanly_without_islands(built):
    """``--no-islands`` (v2 behaviour): the turned house stays on the world grid as a
    staircase of short runs with the glass-cell rhythm."""
    root, _, _ = built
    world, chunks = build_town(root, islands=False)
    assert world.islands == []
    fid = fid_of(world, "5")
    runs = runs_of(world, "5")
    assert runs and all(not r.detail for r in runs)
    assert {r.reason for r in runs} <= {"short", "skew"}
    assert not (placed_all(chunks)["featureId"] == fid).any()
    glass = palette.idx("glass")
    assert sum(int(((t.color == glass) & (t.feature == fid)).sum()) for t, _ in chunks.values()) > 50


def test_ground_floors_follow_streets_and_shops(built):
    _, world, _ = built
    kinds = {(sfx, r.normal): r.run.ground for sfx in "1234" for r in runs_of(world, sfx) if r.detail}
    assert kinds[("3", "S")] is GroundFloor.SHOP          # café inside
    assert kinds[("1", "W")] is GroundFloor.SHOP          # faces the pedestrian street
    assert kinds[("1", "S")] in (GroundFloor.HOUSE, GroundFloor.ARCHED)
    assert kinds[("4", "S")] in (GroundFloor.HOUSE, GroundFloor.ARCHED)
    for sfx in "1234":
        assert kinds[(sfx, "N")] is GroundFloor.PLAIN       # back walls face no street
    assert kinds[("4", "E")] is GroundFloor.PLAIN


def test_storeys_from_building_height(built):
    _, world, _ = built
    for sfx, _, _, eave, _, along_x, _ in town.TERRACE:
        front = next(r for r in runs_of(world, sfx) if r.normal == "S")
        run = front.run
        # wall top below the roof band (2 slope stacks) on the eave side
        assert run.eave_k(front.base) - front.base >= 18 + 15 * run.storeys
        assert run.eave_extra < 15
    storeys = {sfx: next(r for r in runs_of(world, sfx) if r.normal == "S").run.storeys for sfx in "1234"}
    assert storeys == {"1": 2, "2": 1, "3": 3, "4": 1}


def test_terrace_is_fully_detailed_and_share_measured(built):
    _, world, _ = built
    for sfx in "1234":
        assert all(r.detail for r in runs_of(world, sfx)), sfx
    terrace = {fid_of(world, sfx) for sfx in "1234"}
    st = facade_stats([r for r in world.facades if r.fid in terrace])
    assert st.detailed == 10 and st.detailed_length == 170 and st.length == 170
    assert st.by_reason == {} and st.share == 1.0


def test_chunk_border_handling(built):
    """The café front crosses a chunk border along i (bays move off it, no piece straddles);
    the back walls sit on the first row of the next chunk in j (sills there become stand-ins)."""
    _, world, chunks = built
    shop = next(r for r in runs_of(world, "3") if r.normal == "S")
    assert shop.run.cuts == (2,)
    backs = [r for sfx in "1234" for r in runs_of(world, sfx) if r.normal == "N"]
    assert all(r.ring % 64 == 0 for r in backs)
    # window pieces of the back walls live in chunk cy=31 (wall plane), their sills are voxels
    back_windows = [row for row in placed_all(chunks) if int(row["J"]) == backs[0].ring - 1
                    and CAT[int(row["type"])].kind == "window"]
    assert len(back_windows) >= 10


def test_same_input_same_chunks(built):
    root, _, chunks = built
    _, again = build_town(root)
    assert set(again) == set(chunks)
    for key, (_, rec) in chunks.items():
        assert np.array_equal(again[key][1], rec)


def test_neighbouring_tiles_agree_on_their_rims(built):
    _, _, chunks = built
    tiles = {k: t for k, (t, _) in chunks.items()}
    for (cx, cy), t in tiles.items():
        for dx, dy in ((1, 0), (0, 1)):
            u = tiles.get((cx + dx, cy + dy))
            if u is None:
                continue
            i0, i1 = max(t.I0, u.I0), min(t.I0 + t.dims[0], u.I0 + u.dims[0])
            j0, j1 = max(t.J0, u.J0), min(t.J0 + t.dims[1], u.J0 + u.dims[1])
            k0, k1 = max(t.k0, u.k0), min(t.k0 + t.dims[2], u.k0 + u.dims[2])
            a = t.color[i0 - t.I0:i1 - t.I0, j0 - t.J0:j1 - t.J0, k0 - t.k0:k1 - t.k0]
            b = u.color[i0 - u.I0:i1 - u.I0, j0 - u.J0:j1 - u.J0, k0 - u.k0:k1 - u.k0]
            assert np.array_equal(a, b), (cx, cy, dx, dy)


def test_axis_edges_only_on_grid_aligned_walls():
    rect = shp_box(0, 0, 10, 6)
    assert sorted(e[0] for e in axis_edges(rect)) == ["E", "N", "S", "W"]
    assert axis_edges(affinity.rotate(rect, 30)) == []
    assert len(axis_edges(affinity.rotate(rect, 0.5))) == 4  # drift < 0.25 m: still on the grid
    assert sorted(e[0] for e in axis_edges(affinity.rotate(rect, 2))) == ["E", "W"]  # 6 m sides only


def test_landmarks_get_no_facade_grammar():
    from test_voxelise_buildings import box_building, voxelise

    x, y = 176115.0, 317672.0  # Sint-Janstoren
    church = box_building("NL.IMBAG.Pand.SJ", x - 5, y - 5, x + 25, y + 5, 75.0, year=1400)
    house = box_building("NL.IMBAG.Pand.H", x + 40, y - 5, x + 50, y + 5, 62.0, year=1700)
    world, t = voxelise([church, house], geo.CellBox(*geo.rd_to_grid(x - 8, y - 8), *geo.rd_to_grid(x + 55, y + 8)),
                        facades=True)
    church_fid = next(b.feature_id for b in world.buildings if b.bag_id == "NL.IMBAG.Pand.SJ")
    assert world.facades and all(r.fid != church_fid for r in world.facades)
    assert t.placed is not None and len(t.placed) and not (t.placed["featureId"] == church_fid).any()


def test_style_is_deterministic_and_follows_the_era():
    from blox_pipeline.voxelise.facade_style import facade_style

    ids = [f"NL.IMBAG.Pand.{n:016d}" for n in range(200)]
    assert [facade_style(i, 1650, "mergel") for i in ids] == [facade_style(i, 1650, "mergel") for i in ids]
    old = [facade_style(i, 1650, "mergel") for i in ids]
    new = [facade_style(i, 1990, "light_grey") for i in ids]
    assert all(s.quoins and s.plinth == "mergel_dark" for s in old)  # mergel walls get quoins
    assert any(s.shutters for s in old) and any(s.flowers for s in old) and any(s.arched for s in old)
    assert not any(s.shutters or s.flowers or s.quoins or s.arched for s in new)
    assert all(s.trim != "light_grey" for s in new)  # trim contrasts with a light wall
