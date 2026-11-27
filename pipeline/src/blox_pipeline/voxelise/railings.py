"""Railings along bridge deck edges (accuracy A2).

A deck column is an edge when its neighbour in one of the four directions has no deck at the
same level (within one plate) and no ground up to the deck: open air beside the deck. Bridge
ends, where the deck meets the street, have ground there and stay open. Two neighbouring edge
columns facing the same way get one ``railing_1x2`` on top of the deck, its front outward. A
pair that would straddle a chunk, or whose cells are taken (lamps, trees), is skipped.
"""

from __future__ import annotations

import numpy as np

from .. import geo
from .facade_paint import TileCanvas
from .layers import NONE, Layers
from .ramps import _shift

RAILING_PIECE = "railing_1x2"
RAILING_COLOUR = "metal"
RAILING_PLATES = 4
# outward (di, dj), the facing of a railing on that edge, the run direction (along the edge)
EDGES = ((0, 1, "N", (1, 0)), (0, -1, "S", (1, 0)), (1, 0, "E", (0, 1)), (-1, 0, "W", (0, 1)))


def edge_masks(ext: Layers) -> list[tuple[np.ndarray, str, tuple[int, int]]]:
    """Per direction: deck columns whose outward neighbour is open (over ``ext``, the tile's
    layers grown by one so edges at the tile border are judged right)."""
    d, g = ext.deck_k, ext.ground_k
    out = []
    for di, dj, facing, run in EDGES:
        dn, gn = _shift(d, di, dj, NONE), _shift(g, di, dj, NONE)
        deck_beside = (dn != NONE) & (np.abs(dn - d) <= 1)
        ground_beside = (gn != NONE) & (gn >= d - 1)
        out.append(((d != NONE) & ~deck_beside & ~ground_beside & (gn != NONE), facing, run))
    return out


def paint_railings(cv: TileCanvas, ext: Layers, box: geo.CellBox) -> int:
    """Place railings on the deck edges inside ``box`` (the tile's own cells)."""
    t, n, placed = cv.tile, geo.CHUNK_STUDS, 0
    for mask, facing, (ri, rj) in edge_masks(ext):
        taken = np.zeros_like(mask)
        for i, j in np.argwhere(mask):
            i2, j2 = i + ri, j + rj
            if i2 >= mask.shape[0] or j2 >= mask.shape[1] or taken[i, j] or not mask[i2, j2] or taken[i2, j2]:
                continue
            if ext.deck_k[i, j] != ext.deck_k[i2, j2]:
                continue
            I0, J0 = ext.box.i0 + i, ext.box.j0 + j
            I1, J1 = I0 + ri, J0 + rj
            if not (box.i0 <= I0 and I1 < box.i1 and box.j0 <= J0 and J1 < box.j1):
                continue  # the neighbouring tile places it
            if I0 // n != I1 // n or J0 // n != J1 // n:
                continue
            k = int(ext.deck_k[i, j]) + 1
            cells = [(I0 - t.I0, J0 - t.J0), (I1 - t.I0, J1 - t.J0)]
            kz = k - t.k0
            if kz < 0 or kz + RAILING_PLATES > t.dims[2]:
                continue
            if any(t.color[a, b, kz:kz + RAILING_PLATES].any() or cv.locked[a, b, kz:kz + RAILING_PLATES].any()
                   for a, b in cells):
                continue
            cv.place(RAILING_PIECE, I0, J0, k, facing, RAILING_COLOUR, int(ext.deck_feat[i, j]))
            taken[i, j] = taken[i2, j2] = True
            placed += 1
    return placed


__all__ = ["RAILING_PIECE", "edge_masks", "paint_railings"]
