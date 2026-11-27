"""Deterministic brick trees: plane and horse-chestnut style (look v2, owner's Markt photos).

A tall bare trunk (about 45 % of the height, at least 4 m, two studs thick on big trees)
carries a large, irregular crown made of several overlapping leaf blobs (3 to 5 ellipsoids
around the crown centre, sizes and offsets from the tree's seed), with a few branch stubs
where the trunk enters the crown. Everything stays within ``crown_r_m`` of the trunk
horizontally, which ``tile.TREE_MARGIN`` relies on.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .. import geo
from . import palette
from .raster import cell_hash
from .world import TreeSpec

TreeCells = tuple[NDArray[np.int64], NDArray[np.int64], NDArray[np.int64], NDArray[np.uint8]]
TRUNK_MIN_M = 4.0


def _blobs(t: TreeSpec, rh: float, rv: float) -> list[tuple[float, float, float, float, float]]:
    """``(di, dj, dk, radius_h, radius_v)`` of the crown's blobs (studs / plates)."""
    rng = np.random.default_rng(t.seed & 0xFFFFFFFF)
    n = 3 + int(t.seed % 3)
    out = [(0.0, 0.0, 0.0, rh * 0.72, rv * 0.72)]  # core
    for q in range(n):
        a = rng.uniform(0, 2 * np.pi) + q * 2 * np.pi / n
        r = rng.uniform(0.35, 0.55) * rh
        s = rng.uniform(0.4, 0.6)
        out.append((r * np.cos(a), r * np.sin(a), rng.uniform(-0.35, 0.45) * rv, rh * s, rv * (s + 0.05)))
    return out


def tree_cells(t: TreeSpec, ground_k: int) -> TreeCells | None:
    """Global cells ``(I, J, K, colour)`` of a tree standing on ``ground_k``; None if the
    tree has nowhere to stand (``ground_k < 0``)."""
    if ground_k < 0:
        return None
    base = ground_k + 1
    h_cells = max(8, int(round(t.height_m / geo.PLATE_M)))
    rh = max(1.5, t.crown_r_m / geo.STUD_M)                     # horizontal radius in studs
    trunk_h = max(TRUNK_MIN_M / geo.PLATE_M, 0.45 * h_cells)
    trunk_h = min(trunk_h, h_cells - 6)
    rv = max(3.0, (h_cells - trunk_h) / 2 + 1.5)               # crown half-height in plates
    centre_k = base + trunk_h + rv - 1.5
    trunk_top = int(np.ceil(centre_k))

    offs = [(0, 0)]  # one stud (0.5 m): plane and chestnut trunks are slender for their height
    trunk_k = np.arange(base, trunk_top, dtype=np.int64)
    ti = np.concatenate([np.full_like(trunk_k, t.I + a) for a, _ in offs])
    tj = np.concatenate([np.full_like(trunk_k, t.J + b) for _, b in offs])
    tk = np.concatenate([trunk_k] * len(offs))
    # branch stubs: short diagonal runs out of the trunk at the crown base
    rng = np.random.default_rng((t.seed >> 7) & 0xFFFFFFFF)
    bi, bj, bk = [], [], []
    k_branch = int(base + trunk_h - 2)
    for q in range(3):
        a = rng.uniform(0, 2 * np.pi)
        for s in range(1, 4):
            bi.append(t.I + int(round(np.cos(a) * s)))
            bj.append(t.J + int(round(np.sin(a) * s)))
            bk.append(k_branch + 2 * s + q)
    ti = np.concatenate([ti, np.array(bi, np.int64)])
    tj = np.concatenate([tj, np.array(bj, np.int64)])
    tk = np.concatenate([tk, np.array(bk, np.int64)])
    tc = np.full(ti.shape, palette.idx("trunk"), np.uint8)

    r = int(np.ceil(rh))
    zr = int(np.ceil(rv * 1.5)) + 1
    di, dj, dk = np.meshgrid(np.arange(-r, r + 1), np.arange(-r, r + 1), np.arange(-zr, zr + 1), indexing="ij")
    di, dj, dk = di.ravel(), dj.ravel(), dk.ravel()
    I, J = t.I + di, t.J + dj
    K = (np.floor(centre_k) + dk).astype(np.int64)
    noise = cell_hash(I, J, K, seed=t.seed) % 1000 / 1000.0
    best = np.full(di.shape, np.inf)
    for bx, by, bz, ph, pv in _blobs(t, rh, rv):
        d2 = ((di - bx) / ph) ** 2 + ((dj - by) / ph) ** 2 + ((K - centre_k - bz) / pv) ** 2
        best = np.minimum(best, d2)
    inside = (best <= 1.0 - 0.45 * noise) & (di ** 2 + dj ** 2 <= rh * rh) & (K > base + trunk_h - 3)
    I, J, K = I[inside], J[inside], K[inside]
    tone = cell_hash(I, J, K, seed=t.seed + 1) % 16
    col = np.where(tone < 5, t.leaf_alt, t.leaf).astype(np.uint8)
    col[tone == 15] = palette.idx("sand_green")  # paler leaves: the first touch of autumn
    return (np.concatenate([ti, I]), np.concatenate([tj, J]), np.concatenate([tk, K]),
            np.concatenate([tc, col]))
