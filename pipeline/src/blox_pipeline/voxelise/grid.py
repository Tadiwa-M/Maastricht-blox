"""The pipeline-internal voxel tile (CONTRACT.md section 7)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

# shape codes
FULL = 0
SLOPE_N = 1  # low edge faces +j
SLOPE_E = 2  # low edge faces +i
SLOPE_S = 3  # low edge faces -j
SLOPE_W = 4  # low edge faces -i
RIDGE_I = 5  # ridge runs along i, slopes down to +j and -j
RIDGE_J = 6  # ridge runs along j, slopes down to +i and -i
TILE = 7
WATER = 8
SLOPES = (SLOPE_N, SLOPE_E, SLOPE_S, SLOPE_W)
RIDGES = (RIDGE_I, RIDGE_J)

# slope/ridge surfaces are written as vertical stacks of this many cells (one brick
# height), so each stack maps onto exactly one slope brick.
SLOPE_STACK = 3


@dataclass
class VoxelTile:
    """Dense ``[i, j, k]`` arrays; index ``[0, 0, 0]`` is global cell ``(I0, J0, k0)``."""

    I0: int
    J0: int
    k0: int
    color: NDArray[np.uint8]
    feature: NDArray[np.uint32]
    shape: NDArray[np.uint8]

    @classmethod
    def empty(cls, I0: int, J0: int, k0: int, ni: int, nj: int, nk: int) -> "VoxelTile":
        return cls(
            I0, J0, k0,
            np.zeros((ni, nj, nk), np.uint8),
            np.zeros((ni, nj, nk), np.uint32),
            np.zeros((ni, nj, nk), np.uint8),
        )

    @property
    def dims(self) -> tuple[int, int, int]:
        ni, nj, nk = self.color.shape
        return int(ni), int(nj), int(nk)

    def at(self, I: int, J: int, K: int) -> tuple[int, int, int]:
        """``(color, feature, shape)`` of a global cell (air outside the tile)."""
        i, j, k = I - self.I0, J - self.J0, K - self.k0
        ni, nj, nk = self.dims
        if 0 <= i < ni and 0 <= j < nj and 0 <= k < nk:
            return int(self.color[i, j, k]), int(self.feature[i, j, k]), int(self.shape[i, j, k])
        return 0, 0, 0

    def column_top(self, I: int, J: int) -> int | None:
        """Global K of the highest non-air cell in a column, or None."""
        col = self.color[I - self.I0, J - self.J0]
        nz = np.nonzero(col)[0]
        return int(nz[-1]) + self.k0 if len(nz) else None
