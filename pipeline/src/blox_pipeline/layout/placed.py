"""Placed pieces: catalogue pieces put down explicitly instead of inferred from voxels.

Why: a window frame, an arch or a fence has a shape no voxel grid can describe, so the
facade grammar *places* them (CONTRACT section 7, "Placed pieces"). A placed piece is a
ready-made brick record; layout passes it through unchanged. Its cells must be air in
the voxel grid, which has a nice side effect: hollow culling sees air there, so the wall
behind a window frame keeps its faces and is emitted.

How you place one: say where its box starts and which way its front faces::

    rec = make_placed(cat, "window_1x2x2", I=10, J=40, K=95, facing="S", color=8)

``(I, J, K)`` is the minimum corner of the box the piece fills *after* turning, which
is also the record position (CONTRACT section 2). You never pick ``rot`` yourself.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue
from ..rotation import Facing, facing_to_rot
from .records import RECORD_DTYPE, Records, empty_records

Box = tuple[int, int, int, int, int, int]  # i0, i1, j0, j1, k0, k1 (half-open)


def make_placed(
    cat: Catalogue, piece: str | int, I: int, J: int, K: int, facing: Facing | str = Facing.N,
    color: int = 0, feature: int = 0, flags: int = 0,
) -> Records:
    """One record for ``piece`` whose turned box starts at ``(I, J, K)``, front towards ``facing``."""
    t = cat[piece]
    if color <= 0 or color > 255:
        raise ValueError(f"placed {t.name}: colour index must be 1..255, got {color}")
    r = np.zeros(1, RECORD_DTYPE)
    r["I"], r["J"], r["K"] = I, J, K
    r["type"], r["color"], r["rot"] = t.id, color, facing_to_rot(facing)
    r["flags"], r["featureId"] = flags, feature
    return r


def placed_box(cat: Catalogue, row: np.void) -> Box:
    """Half-open global box ``(i0, i1, j0, j1, k0, k1)`` a record occupies."""
    t = cat[int(row["type"])]
    si, sj = t.extent(int(row["rot"]) & 3)
    i0, j0, k0 = int(row["I"]), int(row["J"]), int(row["K"])
    return i0, i0 + si, j0, j0 + sj, k0, k0 + t.h


def as_records(placed: Records | Sequence[Records] | None) -> Records:
    """Normalise ``None`` / a list of one-row arrays / an array into one record array."""
    if placed is None:
        return empty_records()
    if isinstance(placed, np.ndarray):
        return np.asarray(placed, RECORD_DTYPE)
    parts = [np.asarray(p, RECORD_DTYPE) for p in placed]
    return np.concatenate(parts) if parts else empty_records()


def occupancy(
    placed: Records, dims: tuple[int, int, int], I0: int, J0: int, k0: int, cat: Catalogue,
) -> tuple[NDArray[np.uint16], list[int]]:
    """Per-cell count of placed pieces over a tile window, plus indices of pieces that
    stick out of the window."""
    count = np.zeros(dims, np.uint16)
    outside: list[int] = []
    for n, row in enumerate(placed):
        i0, i1, j0, j1, ka, kb = placed_box(cat, row)
        a, b, c = i0 - I0, j0 - J0, ka - k0
        if a < 0 or b < 0 or c < 0 or i1 - I0 > dims[0] or j1 - J0 > dims[1] or kb - k0 > dims[2]:
            outside.append(n)
            continue
        count[a : i1 - I0, b : j1 - J0, c : kb - k0] += 1
    return count, outside


def placed_problems(
    placed: Records, color: NDArray[np.uint8], emit: NDArray[np.bool_],
    I0: int, J0: int, k0: int, cat: Catalogue,
) -> tuple[list[str], NDArray[np.bool_]]:
    """Check placed pieces against a tile; returns ``(problems, occupied cells)``.

    Rules: inside the tile's emit region (so inside one chunk), only on air cells of the
    voxel grid (so no overlap with voxel bricks), and no two placed pieces overlap.
    """
    errs: list[str] = []
    count, outside = occupancy(placed, color.shape, I0, J0, k0, cat)
    if outside:
        errs.append(f"{len(outside)} placed pieces outside the tile, e.g. #{outside[0]}")
    occ = count > 0
    if (count > 1).any():
        errs.append(f"{int((count > 1).sum())} cells covered by two placed pieces")
    if (occ & (color != 0)).any():
        first = np.argwhere(occ & (color != 0))[0].tolist()
        errs.append(f"{int((occ & (color != 0)).sum())} placed cells are not air in the grid "
                    f"(first array cell {first})")
    if (occ & ~emit).any():
        errs.append(f"{int((occ & ~emit).sum())} placed cells outside the emit region (other chunk/border)")
    for t in np.unique(placed["type"]) if len(placed) else []:
        if int(t) not in cat:
            errs.append(f"placed piece with unknown type id {int(t)}")
    return errs, occ
