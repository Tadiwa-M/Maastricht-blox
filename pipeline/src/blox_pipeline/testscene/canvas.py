"""A small voxel-painting helper for hand-authored scenes (one chunk + 1-cell border)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from ..layout.records import CHUNK
from ..palette import Palette, load_palette


@dataclass
class Canvas:
    """Voxel arrays for chunk ``(cx, cy)``; paint with *local* ``i, j`` (0..63) and global ``K``."""

    cx: int
    cy: int
    k0: int
    nz: int
    palette: Palette = field(default_factory=load_palette)
    color: NDArray[np.uint8] = field(init=False)
    feature: NDArray[np.uint32] = field(init=False)
    shape: NDArray[np.uint8] = field(init=False)

    def __post_init__(self) -> None:
        dims = (CHUNK + 2, CHUNK + 2, self.nz)
        self.color = np.zeros(dims, np.uint8)
        self.feature = np.zeros(dims, np.uint32)
        self.shape = np.zeros(dims, np.uint8)

    @property
    def I0(self) -> int:
        return self.cx * CHUNK - 1

    @property
    def J0(self) -> int:
        return self.cy * CHUNK - 1

    def _box(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int):
        return (slice(i0 + 1, i1 + 1), slice(j0 + 1, j1 + 1), slice(k0 - self.k0, k1 - self.k0))

    def fill(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str | int,
             feature: int = 0, shape: int = 0) -> None:
        """Paint the half-open box ``[i0,i1) x [j0,j1) x [k0,k1)`` (k global)."""
        c = self.palette.idx(colour) if isinstance(colour, str) else colour
        box = self._box(i0, i1, j0, j1, k0, k1)
        self.color[box] = c
        self.feature[box] = feature if c else 0
        self.shape[box] = shape if c else 0

    def cell(self, i: int, j: int, k: int, colour: str | int, feature: int = 0, shape: int = 0) -> None:
        self.fill(i, i + 1, j, j + 1, k, k + 1, colour, feature, shape)

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None:
        self.fill(i0, i1, j0, j1, k0, k1, 0)
