"""A small voxel-painting helper for hand-authored scenes (``ncx`` chunks in a row along i,
plus a 1-cell border).

Two ways to put things in the world:

* ``fill`` / ``cell`` / ``clear`` paint voxels; the layout later turns them into bricks.
* ``place`` puts down one catalogue piece as-is (a window frame, an arch, a fence...),
  turned so its front faces ``facing``. Its cells must be air and stay air.

All coordinates are *local* ``i, j`` (``0 .. 64 * ncx`` along i, 0..63 along j) and
*global* ``k``. A placed piece must lie inside one chunk (CONTRACT 4). ``chunk_view``
cuts out one chunk (+ rim) for the layout.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue, load_catalogue
from ..layout.placed import as_records, make_placed, placed_box
from ..layout.records import CHUNK, FLAG_NO_VARIATION, Records
from ..palette import Palette, load_palette
from ..rotation import Facing


@dataclass
class Canvas:
    """Voxel arrays for chunks ``(cx .. cx + ncx - 1, cy)``; paint with *local* ``i, j`` and global ``K``."""

    cx: int
    cy: int
    k0: int
    nz: int
    ncx: int = 1
    palette: Palette = field(default_factory=load_palette)
    catalogue: Catalogue = field(default_factory=load_catalogue)
    placed: list[Records] = field(init=False, default_factory=list)
    color: NDArray[np.uint8] = field(init=False)
    feature: NDArray[np.uint32] = field(init=False)
    shape: NDArray[np.uint8] = field(init=False)

    def __post_init__(self) -> None:
        dims = (CHUNK * self.ncx + 2, CHUNK + 2, self.nz)
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
        if c and any(_overlap((i0, i1, j0, j1, k0, k1), self._local_box(p)) for p in self.placed):
            raise ValueError(f"fill ({i0}..{i1}, {j0}..{j1}, {k0}..{k1}) paints over a placed piece")
        box = self._box(i0, i1, j0, j1, k0, k1)
        self.color[box] = c
        self.feature[box] = feature if c else 0
        self.shape[box] = shape if c else 0

    def cell(self, i: int, j: int, k: int, colour: str | int, feature: int = 0, shape: int = 0) -> None:
        self.fill(i, i + 1, j, j + 1, k, k + 1, colour, feature, shape)

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None:
        self.fill(i0, i1, j0, j1, k0, k1, 0)

    def place(self, piece: str, i: int, j: int, k: int, facing: Facing | str, colour: str | int,
              feature: int = 0, *, no_variation: bool = False) -> tuple[int, int, int, int, int, int]:
        """Put down ``piece`` with its turned box starting at local ``(i, j)``, global ``k``.

        ``facing`` is where the decorated front looks (``"S"`` = towards -j, the street).
        Returns the occupied local box ``(i0, i1, j0, j1, k0, k1)``. Raises if any of
        those cells is already painted or taken by another placed piece.
        """
        c = self.palette.idx(colour) if isinstance(colour, str) else colour
        rec = make_placed(self.catalogue, piece, self.I0 + 1 + i, self.J0 + 1 + j, k, facing, c, feature,
                          flags=FLAG_NO_VARIATION if no_variation else 0)
        box = self._local_box(rec)
        i0, i1, j0, j1, k0, k1 = box
        if i0 < 0 or j0 < 0 or i1 > CHUNK * self.ncx or j1 > CHUNK or k0 < self.k0 or k1 > self.k0 + self.nz:
            raise ValueError(f"{piece} at ({i}, {j}, {k}) sticks out of the chunk")
        if i0 // CHUNK != (i1 - 1) // CHUNK:
            raise ValueError(f"{piece} at ({i}, {j}, {k}) straddles a chunk border")
        cells = self._box(*box)
        if self.color[cells].any():
            raise ValueError(f"{piece} at ({i}, {j}, {k}) facing {facing}: cells are not air")
        for other in self.placed:
            if _overlap(box, self._local_box(other)):
                raise ValueError(f"{piece} at ({i}, {j}, {k}) overlaps another placed piece")
        self.placed.append(rec)
        return box

    def _local_box(self, rec: Records) -> tuple[int, int, int, int, int, int]:
        i0, i1, j0, j1, k0, k1 = placed_box(self.catalogue, rec[0])
        ox, oy = self.cx * CHUNK, self.cy * CHUNK
        return i0 - ox, i1 - ox, j0 - oy, j1 - oy, k0, k1

    def placed_records(self) -> Records:
        """All placed pieces as one record array (global coordinates)."""
        return as_records(self.placed)

    def chunk_view(self, n: int) -> tuple[NDArray[np.uint8], NDArray[np.uint32], NDArray[np.uint8], int, int, Records]:
        """``(color, feature, shape, I0, J0, placed)`` of chunk ``cx + n`` with its 1-cell rim."""
        sl = slice(n * CHUNK, n * CHUNK + CHUNK + 2)
        lo, hi = (self.cx + n) * CHUNK, (self.cx + n + 1) * CHUNK
        own = [r for r in self.placed if lo <= int(r[0]["I"]) < hi]
        return (self.color[sl], self.feature[sl], self.shape[sl], self.I0 + n * CHUNK, self.J0, as_records(own))


def _overlap(a: tuple[int, ...], b: tuple[int, ...]) -> bool:
    return all(a[n] < b[n + 1] and b[n] < a[n + 1] for n in (0, 2, 4))
