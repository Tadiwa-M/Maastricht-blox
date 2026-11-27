"""Wedge ramps on sloping paved ground (voxelise/ramps.py)."""

from __future__ import annotations

import numpy as np

from blox_pipeline import geo
from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.geo import CellBox
from blox_pipeline.layout.placed import placed_box
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.facade_paint import TileCanvas
from blox_pipeline.voxelise.grid import FULL, TILE, VoxelTile
from blox_pipeline.voxelise.layers import Layers
from blox_pipeline.voxelise.ramps import RAMP_PIECE, paint_ramps, ramp_sites

N = 12
ROAD = palette.idx("dark_grey")


def street(steps_at: tuple[int, ...] = (6,)) -> Layers:
    """An N x N paved patch climbing towards +j: one plate up at each j in ``steps_at``."""
    L = Layers.empty(CellBox(0, 0, N, N))
    jj = np.arange(N)[None, :]
    L.ground_k[:] = 10 + sum((jj >= s).astype(np.int32) for s in steps_at)
    L.ground_shape[:] = TILE
    L.ground_color[:] = ROAD
    return L


def canvas(L: Layers) -> TileCanvas:
    t = VoxelTile.empty(L.box.i0, L.box.j0, 0, L.box.ni, L.box.nj, 16)
    return TileCanvas(t, border=0)


def test_one_wedge_per_column_below_each_step_facing_downhill() -> None:
    sites = ramp_sites(street())
    assert len(sites) == N  # every column across the street
    assert all(j == 5 and (di, dj, f) == (0, 1, "S") for _, j, di, dj, f in sites)


def test_wedges_are_placed_on_the_low_level_against_the_step() -> None:
    L = street()
    cv = canvas(L)
    assert paint_ramps(cv, L) == N
    cat = load_catalogue()
    for rec in cv.records():
        assert cat[int(rec["type"])].name == RAMP_PIECE
        i0, i1, j0, j1, k0, k1 = placed_box(cat, rec)
        assert (j0, j1, k0, k1) == (4, 6, 11, 12) and i1 - i0 == 1  # cells j 4-5, one plate above k 10


def test_steps_stay_where_there_is_no_room_or_no_pavement() -> None:
    assert ramp_sites(street((6, 7))) == ramp_sites(street((6, 7)))  # deterministic
    two = ramp_sites(street((6, 7)))  # two steps in a row: only the lower one has two flat cells below
    assert {j for _, j, *_ in two} == {5}
    L = street()
    L.ground_shape[:, :] = FULL  # grass: no wedges
    assert ramp_sites(L) == []
    L = street()
    L.bld_top[:, 4] = 30  # a building on the low cells
    assert ramp_sites(L) == []


def test_a_lamp_or_tree_keeps_its_spot_and_chunk_borders_are_left_alone() -> None:
    L = street()
    cv = canvas(L)
    cv.tile.color[3, 5, 11] = palette.idx("soil")  # something standing on the high cell
    assert paint_ramps(cv, L) == N - 1
    n = geo.CHUNK_STUDS
    L = Layers.empty(CellBox(0, n - 6, N, n + 6))  # the step's two low cells straddle a chunk border
    jj = np.arange(12)[None, :]
    L.ground_k[:] = 10 + (jj >= 7).astype(np.int32)
    L.ground_shape[:] = TILE
    L.ground_color[:] = ROAD
    cv = canvas(L)
    assert len(ramp_sites(L)) == N and paint_ramps(cv, L) == 0
