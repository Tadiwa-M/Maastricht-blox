"""Wedge ramps on sloping paved ground (owner 2026-11-02: "steps on the road").

Bricks are whole plates tall, so a road that climbs rises in 0.2 m steps. Where a paved column
(roads, pavements, squares: ground shape TILE) lies exactly one plate below a paved neighbour,
a ``wedge_1x2`` (catalogue id 57: 1 plate rising over 2 studs, about 11 degrees) sits on top of
it with its high end against the step and its low edge facing downhill, the way brick builders
soften a step. Both columns under the wedge must be paved, open (no building, water, deck or
island) and at the same level, the cells it takes must be air, and the wedge must not straddle
a chunk; otherwise the step stays. Pieces placed earlier (lamps, bollards, facades) win.
"""

from __future__ import annotations

import numpy as np

from .. import geo
from .facade_paint import TileCanvas
from .grid import TILE
from .layers import NONE, Layers

RAMP_PIECE = "wedge_1x2"
# (di, dj) towards the higher neighbour -> the facing of the wedge's low edge (away from it)
UPHILL = ((0, 1, "S"), (0, -1, "N"), (1, 0, "W"), (-1, 0, "E"))


def open_paved(L: Layers) -> np.ndarray:
    """Columns whose top is paved ground with nothing standing on it."""
    return ((L.ground_k != NONE) & (L.ground_shape == TILE) & (L.bld_top == NONE) & (L.water_k == NONE)
            & (L.deck_k == NONE) & (L.island_k == NONE))


def _shift(a: np.ndarray, di: int, dj: int, fill) -> np.ndarray:
    """``out[i, j] = a[i + di, j + dj]`` (``fill`` outside)."""
    out = np.full_like(a, fill)
    ni, nj = a.shape
    out[max(0, -di):ni - max(0, di), max(0, -dj):nj - max(0, dj)] = a[max(0, di):ni - max(0, -di) or None,
                                                                         max(0, dj):nj - max(0, -dj) or None]
    return out


def ramp_sites(L: Layers) -> list[tuple[int, int, int, int, str]]:
    """``(i, j, di, dj, facing)`` (local columns): the wedge's high column ``(i, j)`` and the
    direction ``(di, dj)`` of the one-plate-higher neighbour. Pure; a column is in one wedge at most."""
    g, ok = L.ground_k, open_paved(L)
    out, taken = [], np.zeros_like(ok)
    for di, dj, facing in UPHILL:
        g_hi, g_lo = _shift(g, di, dj, NONE), _shift(g, -di, -dj, NONE)
        ok_hi, ok_lo = _shift(ok, di, dj, False), _shift(ok, -di, -dj, False)
        cand = ok & ok_hi & ok_lo & (g_hi == g + 1) & (g_lo == g)
        for i, j in np.argwhere(cand):
            lo = (i - di, j - dj)
            if taken[i, j] or taken[lo]:
                continue
            taken[i, j] = taken[lo] = True
            out.append((int(i), int(j), di, dj, facing))
    return out


def paint_ramps(cv: TileCanvas, L: Layers) -> int:
    """Place a wedge at every ramp site of the tile; returns how many were placed."""
    t, n, placed = cv.tile, geo.CHUNK_STUDS, 0
    for i, j, di, dj, facing in ramp_sites(L):
        I0, J0 = L.box.i0 + i, L.box.j0 + j
        I1, J1 = I0 - di, J0 - dj  # the low column
        if I0 // n != I1 // n or J0 // n != J1 // n:
            continue  # would straddle a chunk: keep the step
        k = int(L.ground_k[i, j]) + 1
        cells = [(I0 - t.I0, J0 - t.J0), (I1 - t.I0, J1 - t.J0)]
        kz = k - t.k0
        if not (0 <= kz < t.dims[2]) or any(not (0 <= a < t.dims[0] and 0 <= b < t.dims[1]) for a, b in cells):
            continue
        if any(t.color[a, b, kz] or cv.locked[a, b, kz] for a, b in cells):
            continue  # a tree trunk, prop or piece is there
        cv.place(RAMP_PIECE, min(I0, I1), min(J0, J1), k, facing, int(L.ground_color[i, j]))
        placed += 1
    return placed


__all__ = ["RAMP_PIECE", "open_paved", "paint_ramps", "ramp_sites"]
