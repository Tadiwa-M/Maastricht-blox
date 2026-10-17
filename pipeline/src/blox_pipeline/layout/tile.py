"""``layout_tile``: voxel tile (CONTRACT section 7) -> brick records (global coords)."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue, load_catalogue
from ..palette import Palette, load_palette
from .cull import exposed_mask
from .pack2d import feet_table, pack_volume
from .records import CHUNK, RECORD_DTYPE, WORLD_STUDS, Records, sort_records
from .slopes import layout_slopes

FULL, TILE, WATER = 0, 7, 8
MAX_K = 65535 - 3  # a brick's top (k + h) must fit the uint16 maxK header field


def auto_border(dims: tuple[int, int, int], I0: int, J0: int) -> int:
    """1 when the tile looks like whole chunks plus a 1-cell border, else 0."""
    nx, ny, _ = dims
    if nx > 2 and ny > 2 and (nx - 2) % CHUNK == 0 and (ny - 2) % CHUNK == 0:
        if (I0 + 1) % CHUNK == 0 and (J0 + 1) % CHUNK == 0:
            return 1
    return 0


def emit_mask(dims: tuple[int, int, int], k0: int, I0: int, J0: int, border: int) -> NDArray[np.bool_]:
    """Cells this tile may emit: inside the border and inside the world/uint16 range."""
    nx, ny, nz = dims
    gi = I0 + np.arange(nx)
    gj = J0 + np.arange(ny)
    gk = k0 + np.arange(nz)
    mi = (np.arange(nx) >= border) & (np.arange(nx) < nx - border) & (gi >= 0) & (gi < WORLD_STUDS)
    mj = (np.arange(ny) >= border) & (np.arange(ny) < ny - border) & (gj >= 0) & (gj < WORLD_STUDS)
    mk = (gk >= 0) & (gk <= MAX_K)
    return mi[:, None, None] & mj[None, :, None] & mk[None, None, :]


def water_colours(color: NDArray[np.uint8], pal: Palette) -> NDArray[np.uint8]:
    """Colour of a water-surface tile: the cell colour if see-through, else ``water``."""
    see = pal.material_mask("trans")
    return np.where(see[color], color, np.uint8(pal.idx("water"))).astype(np.uint8)


def keep_mask(color, shape, emit, pal: Palette) -> NDArray[np.bool_]:
    """Cells that must be covered: exposed cells plus every slope/ridge cell."""
    sloped = (shape >= 1) & (shape <= 6) & (color != 0)
    return emit & (exposed_mask(color, shape, pal) | sloped)


def _labels(mask, color, feature):
    keys = (feature[mask].astype(np.uint64) << np.uint64(8)) | color[mask].astype(np.uint64)
    uniq, inv = np.unique(keys, return_inverse=True)
    lab = np.full(mask.shape, -1, np.int32)
    lab[mask] = inv.astype(np.int32)
    return lab, (uniq & np.uint64(0xFF)).astype(np.uint8), (uniq >> np.uint64(8)).astype(np.uint32)


def _feet(cat: Catalogue, kind: str) -> NDArray[np.int32]:
    return feet_table([(t.id, t.w, t.d) for t in cat.of_kind(kind)])


def _chunk_limits(n: int, origin: int) -> tuple[NDArray[np.int32], NDArray[np.int64]]:
    g = origin + np.arange(n)
    lim = np.minimum(n - np.arange(n), CHUNK - np.mod(g, CHUNK)).astype(np.int32)
    return lim, np.floor_divide(g, CHUNK)


def _pack(lab, owner, k0, bricks, plates, lim_i, lim_j, use_bricks, next_id):
    n_max = int((lab >= 0).sum())
    outs = [np.empty(n_max, np.int32) for _ in range(6)]
    n, next_id = pack_volume(lab, owner, k0, bricks, plates, lim_i, lim_j,
                             use_bricks, next_id, *outs)
    return [o[:n] for o in outs], next_id


def layout_tile(
    color: NDArray[np.uint8], feature: NDArray[np.uint32], shape: NDArray[np.uint8],
    k0: int, I0: int, J0: int, *, border: int | None = None,
    catalogue: Catalogue | None = None, palette: Palette | None = None,
) -> Records:
    """Lay out one voxel tile as bricks.

    ``border``: cells on each horizontal side that are context only (used for hollow
    culling, never emitted). ``None`` auto-detects a 1-cell border around whole chunks
    (see :func:`auto_border`). Returns records (``RECORD_DTYPE``) sorted by (K, J, I).
    """
    cat = catalogue or load_catalogue()
    pal = palette or load_palette()
    color = np.ascontiguousarray(color, np.uint8)
    feature = np.ascontiguousarray(feature, np.uint32)
    shape = np.ascontiguousarray(shape, np.uint8)
    if not (color.shape == feature.shape == shape.shape) or color.ndim != 3:
        raise ValueError("color/feature/shape must be 3D arrays of equal shape")
    dims = color.shape
    b = auto_border(dims, I0, J0) if border is None else border
    emit = emit_mask(dims, k0, I0, J0, b)
    keep = keep_mask(color, shape, emit, pal)
    lim_i, cxi = _chunk_limits(dims[0], I0)
    lim_j, cyj = _chunk_limits(dims[1], J0)

    sl = layout_slopes(color, feature, shape, emit & (color != 0), cxi, cyj, cat)
    assert sl.used is not None and sl.fallback is not None

    owner = np.full(dims, -1, np.int32)
    owner[sl.used] = 0
    parts: list[Records] = []
    if sl.bricks:
        arr = np.asarray(sl.bricks, np.int64)
        parts.append(_records(arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3], arr[:, 4], arr[:, 5], arr[:, 6], I0, J0, k0))

    tile_cells = keep & ((shape == TILE) | (shape == WATER)) & ~sl.used
    tile_color = np.where(shape == WATER, water_colours(color, pal), color)
    lab, lc, lf = _labels(tile_cells, tile_color, feature)
    (oi, oj, ok, ot, orot, ol), next_id = _pack(lab, owner, k0, _feet(cat, "brick"), _feet(cat, "tile"), lim_i, lim_j, False, 1)
    parts.append(_records(oi, oj, ok, ot, orot, lc[ol], lf[ol], I0, J0, k0))

    full_cells = ((keep & (shape == FULL)) | sl.fallback) & ~sl.used
    lab, lc, lf = _labels(full_cells, color, feature)
    (oi, oj, ok, ot, orot, ol), _ = _pack(lab, owner, k0, _feet(cat, "brick"), _feet(cat, "plate"), lim_i, lim_j, True, next_id)
    parts.append(_records(oi, oj, ok, ot, orot, lc[ol], lf[ol], I0, J0, k0))
    return sort_records(np.concatenate(parts))


def _records(i, j, k, t, rot, c, f, I0: int, J0: int, k0: int) -> Records:
    r = np.zeros(len(i), RECORD_DTYPE)
    r["I"], r["J"], r["K"] = np.asarray(i) + I0, np.asarray(j) + J0, np.asarray(k) + k0
    r["type"], r["rot"], r["color"], r["featureId"] = t, rot, c, f
    return r
