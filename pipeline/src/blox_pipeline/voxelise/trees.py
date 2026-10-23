"""Deterministic brick trees: a trunk column plus a lumpy leaf ellipsoid."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .. import geo
from . import palette
from .raster import cell_hash
from .world import TreeSpec

TreeCells = tuple[NDArray[np.int64], NDArray[np.int64], NDArray[np.int64], NDArray[np.uint8]]


def tree_cells(t: TreeSpec, ground_k: int) -> TreeCells | None:
    """Global cells ``(I, J, K, colour)`` of a tree standing on ``ground_k``; None if the
    tree has nowhere to stand (``ground_k < 0``)."""
    if ground_k < 0:
        return None
    base = ground_k + 1
    h_cells = max(6, int(round(t.height_m / geo.PLATE_M)))
    rh = max(1.0, t.crown_r_m / geo.STUD_M)  # horizontal radius in studs
    rv = max(3.0, 0.85 * t.crown_r_m / geo.PLATE_M)  # vertical radius in plates
    rv = min(rv, h_cells * 0.45)
    centre_k = base + h_cells - rv
    trunk_top = int(np.ceil(centre_k))

    trunk_k = np.arange(base, trunk_top, dtype=np.int64)
    ti = np.full_like(trunk_k, t.I)
    tj = np.full_like(trunk_k, t.J)
    tc = np.full(trunk_k.shape, palette.idx("trunk"), np.uint8)

    r = int(np.ceil(rh))
    di, dj, dk = np.meshgrid(np.arange(-r, r + 1), np.arange(-r, r + 1),
                             np.arange(int(np.floor(-rv)), int(np.ceil(rv)) + 1), indexing="ij")
    I, J = t.I + di.ravel(), t.J + dj.ravel()
    K = (np.floor(centre_k) + dk.ravel()).astype(np.int64)
    d2 = (di.ravel() / rh) ** 2 + (dj.ravel() / rh) ** 2 + ((K - centre_k) / rv) ** 2
    noise = cell_hash(I, J, K, seed=t.seed) % 1000 / 1000.0
    inside = d2 <= 1.0 - 0.3 * noise  # lumpy outline
    I, J, K = I[inside], J[inside], K[inside]
    alt = (cell_hash(I, J, K, seed=t.seed + 1) % 4) == 0
    col = np.where(alt, t.leaf_alt, t.leaf).astype(np.uint8)
    return (np.concatenate([ti, I]), np.concatenate([tj, J]), np.concatenate([trunk_k, K]),
            np.concatenate([tc, col]))
