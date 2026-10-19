"""The ``hide_studs`` flag (rotFlags bit3, CONTRACT section 4).

Why: a building is stored hollow. A floor brick whose top touches the (unstored)
interior of the wall above still has studs, and a renderer would draw them although no
camera can ever see them. The pipeline knows the interior, so it marks such bricks.

Rule: set the flag when **every** stud cell of the brick has, directly above it, a solid
input cell that no record covers (it was hollow-culled). Bricks without studs never get
the flag. Cells above the top of the tile count as air (studs visible).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue
from .records import Records


def _stud_offsets(cat: Catalogue, type_id: int, rot: int) -> NDArray[np.int64]:
    if type_id not in cat:
        return np.zeros((0, 2), np.int64)
    return np.asarray(cat[type_id].stud_offsets(rot), np.int64).reshape(-1, 2)


def hidden_studs(
    rec: Records, interior: NDArray[np.bool_], I0: int, J0: int, k0: int, cat: Catalogue,
) -> NDArray[np.bool_]:
    """Per record: are all its studs under ``interior`` cells (solid input, not stored)?"""
    out = np.zeros(len(rec), bool)
    if len(rec) == 0:
        return out
    _, _, eh = cat.extent_tables()
    t = rec["type"].astype(np.int64)
    rot = rec["rot"].astype(np.int64) & 3
    top = rec["K"].astype(np.int64) + eh[t] - k0  # array k of the cell above the brick
    I = rec["I"].astype(np.int64) - I0
    J = rec["J"].astype(np.int64) - J0
    nx, ny, nz = interior.shape
    for key in np.unique(t * 4 + rot):
        sel = np.flatnonzero(t * 4 + rot == key)
        offs = _stud_offsets(cat, int(key // 4), int(key % 4))
        if len(offs) == 0:
            continue
        ok = np.ones(len(sel), bool)
        for di, dj in offs:
            i, j, k = I[sel] + di, J[sel] + dj, top[sel]
            inside = (i >= 0) & (i < nx) & (j >= 0) & (j < ny) & (k >= 0) & (k < nz)
            hit = np.zeros(len(sel), bool)
            hit[inside] = interior[i[inside], j[inside], k[inside]]
            ok &= hit
        out[sel] = ok
    return out
