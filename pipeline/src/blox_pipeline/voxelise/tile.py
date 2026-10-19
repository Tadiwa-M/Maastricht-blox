"""Materialise a dense :class:`VoxelTile` from region layers."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .. import geo
from ..geo import CellBox
from . import palette
from .facade_paint import paint_facades
from .grid import FULL, SLOPE_STACK, TILE, WATER, VoxelTile
from .layers import NONE, Layers, shifted
from .trees import tree_cells
from .world import PreparedWorld, TreeSpec

NEIGHBOURS = ((1, 0), (-1, 0), (0, 1), (0, -1))
TREE_MARGIN = 12  # cells; crowns are at most 5 m (10 studs) in radius


def tile_box_for_chunk(cx: int, cy: int, border: int = 1) -> CellBox:
    return geo.chunk_cells(cx, cy).grow(border)


def voxelise_tile(world: PreparedWorld, layers: Layers, box: CellBox) -> VoxelTile:
    """Voxelise ``box`` (global cells). ``layers`` must cover ``box`` grown by 1."""
    ext = layers.window(box.grow(1))
    L = layers.window(box)
    cfg = world.config
    trees = [t for t in world.trees_near(box.i0, box.j0, box.i1, box.j1, TREE_MARGIN) if _tree_touches(t, box)]
    tree_vox = [tree_cells(t, int(layers_ground(layers, t.I, t.J))) for t in trees]
    tree_vox = [tv for tv in tree_vox if tv is not None]

    bottom = _terrain_bottom(ext, cfg.terrain_depth_plates)
    tops = [L.ground_k, L.water_k, L.deck_k, L.bld_top]
    k_hi = int(max(int(a.max()) for a in tops))
    for cells in tree_vox:
        k_hi = max(k_hi, int(cells[2].max()))
    valid_bottom = bottom[L.ground_k != NONE]
    if k_hi < 0 or valid_bottom.size == 0:
        return VoxelTile.empty(box.i0, box.j0, 0, box.ni, box.nj, 0)
    k0 = int(valid_bottom.min())
    tile = VoxelTile.empty(box.i0, box.j0, k0, box.ni, box.nj, k_hi - k0 + 1)
    kk = np.arange(k0, k_hi + 1, dtype=np.int32)[None, None, :]

    _fill_terrain(tile, L, bottom, kk)
    _fill_water(tile, L, kk)
    _fill_buildings(tile, L, kk)
    _fill_windows(tile, ext, L, kk, cfg.storey_plates, cfg.window_band)
    _fill_decks(tile, L, kk)
    for cells in tree_vox:
        _fill_tree(tile, *cells)
    if world.facades:  # last: facade pieces win over tree leaves and glass cells
        paint_facades(tile, world.facades_near(box.i0, box.j0, box.i1, box.j1))
    return tile


def layers_ground(layers: Layers, I: int, J: int) -> int:
    """Ground K at a column, or NONE where a tree cannot stand (building/water/outside)."""
    i, j = I - layers.box.i0, J - layers.box.j0
    if not (0 <= i < layers.box.ni and 0 <= j < layers.box.nj):
        return NONE
    if (layers.bld_top[i, j] != NONE or layers.water_k[i, j] != NONE or layers.deck_k[i, j] != NONE
            or layers.island_k[i, j] != NONE):
        return NONE
    return int(layers.ground_k[i, j])


def _tree_touches(t: TreeSpec, box: CellBox) -> bool:
    r = int(np.ceil(t.crown_r_m / geo.STUD_M)) + 1
    return box.i0 - r <= t.I < box.i1 + r and box.j0 - r <= t.J < box.j1 + r


def _terrain_bottom(ext: Layers, depth: int) -> NDArray[np.int32]:
    """Lowest terrain K per column: ``depth`` plates below the lowest 4-neighbour surface,
    so steep steps stay closed. Returns the array for the inner box (ext minus 1)."""
    g = ext.ground_k.astype(np.int64)
    big = np.iinfo(np.int32).max
    gm = np.where(g == NONE, big, g)
    low = gm.copy()
    for di, dj in NEIGHBOURS:
        low = np.minimum(low, shifted(gm, di, dj, big))
    low = np.where(low == big, g, low)
    bottom = (np.minimum(low, g) - depth + 1).astype(np.int32)
    return bottom[1:-1, 1:-1]


def _fill_terrain(tile: VoxelTile, L: Layers, bottom: NDArray[np.int32], kk: NDArray) -> None:
    g = L.ground_k[..., None]
    body = (kk >= bottom[..., None]) & (kk < g) & (g != NONE)
    top = (kk == g) & (g != NONE)
    tile.color[body] = palette.idx("soil")
    tile.color[top] = np.broadcast_to(L.ground_color[..., None], top.shape)[top]
    tile.shape[top] = np.broadcast_to(L.ground_shape[..., None], top.shape)[top]
    tile.feature[top] = np.broadcast_to(L.ground_feat[..., None], top.shape)[top]


def _put(tile: VoxelTile, mask: NDArray[np.bool_], color: NDArray, shape: NDArray | int, feat: NDArray | int) -> None:
    tile.color[mask] = np.broadcast_to(color[..., None], mask.shape)[mask]
    tile.shape[mask] = (np.broadcast_to(shape[..., None], mask.shape)[mask]
                        if isinstance(shape, np.ndarray) else shape)
    tile.feature[mask] = (np.broadcast_to(feat[..., None], mask.shape)[mask]
                          if isinstance(feat, np.ndarray) else feat)


def _fill_water(tile: VoxelTile, L: Layers, kk: NDArray) -> None:
    w, g = L.water_k[..., None], L.ground_k[..., None]
    has = w != NONE
    _put(tile, has & (kk > g) & (kk < w), L.water_color, FULL, L.water_feat)
    _put(tile, has & (kk == w) & (kk > g), L.water_color, WATER, L.water_feat)


def _roof_stack(L: Layers) -> NDArray[np.int32]:
    height = np.maximum(L.bld_top - L.ground_k, 0)
    stack = np.where(L.roof_shape > 0, SLOPE_STACK, 1)
    return np.minimum(stack, height).astype(np.int32)


def _roof_band(L: Layers) -> NDArray[np.int32]:
    """Roof-coloured cells at the top of each column: the slope stack plus, on pitched
    roofs, one full stack below it. That underlay is the studded back row the layout
    pairs with the next-lower slope stack (CONTRACT section 7 slope convention)."""
    height = np.maximum(L.bld_top - L.ground_k, 0)
    band = np.where(L.roof_shape > 0, 2 * SLOPE_STACK, 1)
    return np.minimum(band, height).astype(np.int32)


def _fill_buildings(tile: VoxelTile, L: Layers, kk: NDArray) -> None:
    t, g = L.bld_top[..., None], L.ground_k[..., None]
    has = (t != NONE) & (t > g)
    stack = _roof_stack(L)[..., None]
    band = _roof_band(L)[..., None]
    body = has & (kk > g) & (kk <= t)
    roof = body & (kk > t - stack)
    under = body & ~roof & (kk > t - band)
    _put(tile, body & ~roof & ~under, L.bld_wall, FULL, L.bld_feat)
    _put(tile, under, L.bld_roof, FULL, L.bld_feat)
    _put(tile, roof, L.bld_roof, L.roof_shape, L.bld_feat)


def _occupied_top(L: Layers) -> NDArray[np.int64]:
    """Highest solid K per column (terrain/water/building/island), NONE if empty."""
    return np.maximum.reduce([L.ground_k, L.water_k, L.bld_top, L.island_k]).astype(np.int64)


def _fill_windows(tile: VoxelTile, ext: Layers, L: Layers, kk: NDArray, storey: int, band: tuple[int, int]) -> None:
    occ = _occupied_top(ext)
    exposed = {}
    for di, dj in NEIGHBOURS:
        n_occ = shifted(occ, di, dj, NONE)[1:-1, 1:-1]
        exposed[(di, dj)] = kk > n_occ[..., None]
    face_j = exposed[(0, 1)] | exposed[(0, -1)]
    face_i = exposed[(1, 0)] | exposed[(-1, 0)]
    t, g = L.bld_top[..., None], L.ground_k[..., None]
    period = L.win_period.astype(np.int64)[..., None]
    offset = L.win_offset.astype(np.int64)[..., None]
    limit = t - _roof_band(L)[..., None]  # last wall level is limit - 1
    I = (np.arange(L.box.i0, L.box.i1)[:, None, None]).astype(np.int64)
    J = (np.arange(L.box.j0, L.box.j1)[None, :, None]).astype(np.int64)
    along = np.where(face_j, I, J)
    plate = np.mod(kk - (g + 1), storey)
    rhythm = np.mod(along + offset, np.maximum(period, 1)) == 0
    win = ((t != NONE) & (t > g) & (period > 0) & (kk > g) & (kk < limit)
           & (face_j ^ face_i) & (plate >= band[0]) & (plate < band[1]) & rhythm)
    tile.color[win] = palette.idx("glass")


def _fill_decks(tile: VoxelTile, L: Layers, kk: NDArray) -> None:
    d = L.deck_k[..., None]
    has = d != NONE
    free = (tile.color == 0) | (tile.shape == WATER) | np.isin(tile.color, _water_colours())
    _put(tile, has & free & (kk >= d - 2) & (kk < d), L.deck_body, FULL, L.deck_feat)
    _put(tile, has & free & (kk == d), L.deck_top, TILE, L.deck_feat)


def _water_colours() -> list[int]:
    return [palette.idx("water"), palette.idx("water_shallow")]


def _fill_tree(tile: VoxelTile, I: NDArray, J: NDArray, K: NDArray, col: NDArray) -> None:
    i, j, k = I - tile.I0, J - tile.J0, K - tile.k0
    ni, nj, nk = tile.dims
    ok = (i >= 0) & (i < ni) & (j >= 0) & (j < nj) & (k >= 0) & (k < nk)
    i, j, k, col = i[ok], j[ok], k[ok], col[ok]
    air = tile.color[i, j, k] == 0
    tile.color[i[air], j[air], k[air]] = col[air]


__all__ = ["voxelise_tile", "tile_box_for_chunk"]
