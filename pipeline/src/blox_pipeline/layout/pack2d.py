"""Numba kernels: greedy largest-first packing of labelled cells into bricks/plates/tiles.

Cells carry an int32 *label* (one per distinct colour+feature pair, -1 = nothing to
place). Pieces only merge cells of one label and never cross the per-axis limits
``lim_i``/``lim_j`` (distance to the next chunk border or array edge).

Running-bond stagger: every candidate is scored ``4 * area - 9 * seams`` where *seams*
counts unit edges of its outline that sit exactly on a seam of the level directly below
(between two different pieces) and are internal (same label on both sides, so seams
against a different wall or colour, which cannot be avoided, cost nothing). The penalty
outweighs the area gain of the next larger piece, so seams step sideways from layer to
layer; ties prefer the long axis along i on even layers and along j on odd ones.
"""

from __future__ import annotations

import numpy as np
from numba import njit
from numpy.typing import NDArray

AREA_W = 4
SEAM_W = 9


@njit(cache=True)
def _fits(lab, i0, j0, fw, fd, want):
    for a in range(i0, i0 + fw):
        for b in range(j0, j0 + fd):
            if lab[a, b] != want:
                return False
    return True


@njit(cache=True)
def _seam(below, a0, b0, a1, b1):
    u = below[a0, b0]
    v = below[a1, b1]
    return 1 if (u >= 0 and v >= 0 and u != v) else 0


@njit(cache=True)
def _seam_hits(below, ref, want, i0, j0, fw, fd):
    nx, ny = below.shape
    i1 = i0 + fw
    j1 = j0 + fd
    hits = 0
    for b in range(j0, j1):
        if i0 > 0 and ref[i0 - 1, b] == want:
            hits += _seam(below, i0 - 1, b, i0, b)
        if i1 < nx and ref[i1, b] == want:
            hits += _seam(below, i1 - 1, b, i1, b)
    for a in range(i0, i1):
        if j0 > 0 and ref[a, j0 - 1] == want:
            hits += _seam(below, a, j0 - 1, a, j0)
        if j1 < ny and ref[a, j1] == want:
            hits += _seam(below, a, j1 - 1, a, j1)
    return hits


@njit(cache=True)
def pack_level(lab, ref, below, feet, lim_i, lim_j, prefer_i, out_i, out_j, out_f, n):
    """Greedily cover every ``lab >= 0`` cell; placed cells are set to -1 in ``lab``.

    ``ref`` holds the level's labels before packing (seam test), ``below`` the piece ids
    of the level underneath (-1 = none). ``feet[f] = (size_i, size_j, typeId, rot)``
    must end with a 1x1 entry. Placements are
    appended to ``out_*`` from index ``n``; returns the new count.
    """
    nx, ny = lab.shape
    nf = feet.shape[0]
    for j in range(ny):
        for i in range(nx):
            want = lab[i, j]
            if want < 0:
                continue
            best = nf - 1
            best_score = -(1 << 30)
            for f in range(nf):
                fw = feet[f, 0]
                fd = feet[f, 1]
                if fw > lim_i[i] or fd > lim_j[j]:
                    continue
                if not _fits(lab, i, j, fw, fd, want):
                    continue
                score = AREA_W * fw * fd - SEAM_W * _seam_hits(below, ref, want, i, j, fw, fd)
                if fw != fd and (fw > fd) == prefer_i:
                    score += 1
                if score > best_score:
                    best_score = score
                    best = f
            fw = feet[best, 0]
            fd = feet[best, 1]
            for a in range(i, i + fw):
                for b in range(j, j + fd):
                    lab[a, b] = -1
            out_i[n] = i
            out_j[n] = j
            out_f[n] = best
            n += 1
    return n


@njit(cache=True)
def _stamp(owner3d, lab3d, i, j, k, fw, fd, h, pid):
    for a in range(i, i + fw):
        for b in range(j, j + fd):
            for c in range(k, k + h):
                owner3d[a, b, c] = pid
                lab3d[a, b, c] = -1


@njit(cache=True)
def pack_volume(lab3d, owner3d, k0, brick_feet, plate_feet, lim_i, lim_j,
                use_bricks, next_id, out_i, out_j, out_k, out_t, out_r, out_l):
    """Pack all ``lab3d >= 0`` cells, brick layer by brick layer (global ``K // 3``).

    Columns whose three plates of a layer share a label become bricks (``brick_feet``),
    the rest become plates (``plate_feet``), one plate level at a time. ``owner3d``
    receives piece ids (for seam tracking); ``lab3d`` is consumed. Returns
    ``(count, next_id)``; outputs hold local i, j, array k, typeId, rot, label.
    """
    nx, ny, nz = lab3d.shape
    n = 0
    tmp_i = np.empty(nx * ny, np.int32)
    tmp_j = np.empty(nx * ny, np.int32)
    tmp_f = np.empty(nx * ny, np.int32)
    none3 = np.full((nx, ny, 1), -1, np.int32)
    none = none3[:, :, 0]  # same (strided) array type as owner3d[:, :, k]
    l_lo = k0 // 3
    l_hi = (k0 + nz - 1) // 3
    for L in range(l_lo, l_hi + 1):
        kb = 3 * L - k0
        if use_bricks and kb >= 0 and kb + 2 < nz:
            elig = np.full((nx, ny), -1, np.int32)
            any_cell = False
            for i in range(nx):
                for j in range(ny):
                    a = lab3d[i, j, kb]
                    if a >= 0 and lab3d[i, j, kb + 1] == a and lab3d[i, j, kb + 2] == a:
                        elig[i, j] = a
                        any_cell = True
            if any_cell:
                below = owner3d[:, :, kb - 1] if kb >= 1 else none
                ref = lab3d[:, :, kb].copy()
                m = pack_level(elig, ref, below, brick_feet, lim_i, lim_j,
                               (L & 1) == 0, tmp_i, tmp_j, tmp_f, 0)
                for q in range(m):
                    f = tmp_f[q]
                    i = tmp_i[q]
                    j = tmp_j[q]
                    out_l[n] = lab3d[i, j, kb]
                    _stamp(owner3d, lab3d, i, j, kb, brick_feet[f, 0], brick_feet[f, 1], 3, next_id)
                    next_id += 1
                    out_i[n] = i
                    out_j[n] = j
                    out_k[n] = kb
                    out_t[n] = brick_feet[f, 2]
                    out_r[n] = brick_feet[f, 3]
                    n += 1
        for s in range(3):
            k = kb + s
            if k < 0 or k >= nz:
                continue
            lev = lab3d[:, :, k].copy()
            if lev.max() < 0:
                continue
            below = owner3d[:, :, k - 1] if k >= 1 else none
            m = pack_level(lev, lev.copy(), below, plate_feet, lim_i, lim_j,
                           ((k0 + k) & 1) == 0, tmp_i, tmp_j, tmp_f, 0)
            for q in range(m):
                f = tmp_f[q]
                i = tmp_i[q]
                j = tmp_j[q]
                out_l[n] = lab3d[i, j, k]
                _stamp(owner3d, lab3d, i, j, k, plate_feet[f, 0], plate_feet[f, 1], 1, next_id)
                next_id += 1
                out_i[n] = i
                out_j[n] = j
                out_k[n] = k
                out_t[n] = plate_feet[f, 2]
                out_r[n] = plate_feet[f, 3]
                n += 1
    return n, next_id


def feet_table(types: list[tuple[int, int, int]]) -> NDArray[np.int32]:
    """``[(typeId, w, d), ...]`` -> rows ``(size_i, size_j, typeId, rot)`` for rot 0 and 1,
    largest area first, ending with the 1x1 piece."""
    rows: list[tuple[int, int, int, int]] = []
    for tid, w, d in types:
        rows.append((w, d, tid, 0))
        if w != d:
            rows.append((d, w, tid, 1))
    rows.sort(key=lambda r: (-(r[0] * r[1]), -max(r[0], r[1])))
    if rows[-1][0] * rows[-1][1] != 1:
        raise ValueError("a packing table needs a 1x1 piece")
    return np.asarray(rows, np.int32)
