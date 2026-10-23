"""Hollow culling: keep only cells with a face exposed to air or see-through material."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from ..palette import Palette

FULL, TILE = 0, 7


def occluders(color: NDArray[np.uint8], shape: NDArray[np.uint8], pal: Palette) -> NDArray[np.bool_]:
    """Cells that hide the face of a neighbour: opaque colour and a box-filling shape.

    Slope/ridge cells are only partly filled and water is transparent, so they occlude
    nothing (conservative: the cell next to them stays).
    """
    opaque = ~pal.see_through_mask()
    return opaque[color] & ((shape == FULL) | (shape == TILE))


def exposed_mask(
    color: NDArray[np.uint8], shape: NDArray[np.uint8], pal: Palette
) -> NDArray[np.bool_]:
    """Non-air cells with at least one of 6 faces not covered by an occluder.

    Outside the array: sideways and above count as air (exposed), below counts as solid
    ground (the underside of the world is never seen).
    """
    occ = occluders(color, shape, pal)
    p = np.pad(occ, ((1, 1), (1, 1), (1, 1)), constant_values=False)
    p[:, :, 0] = True  # below the tile: ground
    hidden = (
        p[:-2, 1:-1, 1:-1] & p[2:, 1:-1, 1:-1]
        & p[1:-1, :-2, 1:-1] & p[1:-1, 2:, 1:-1]
        & p[1:-1, 1:-1, :-2] & p[1:-1, 1:-1, 2:]
    )
    return (color != 0) & ~hidden
