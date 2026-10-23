"""The minimal painting surface the facade grammar needs (``testscene.Canvas`` fits).

``fill``/``clear`` paint voxels; ``place`` puts down one catalogue piece turned so its
front faces ``facing`` (``"S"`` = towards -j, the street side of our houses; ``"W"`` = -i,
a west side wall). ``(i, j, k)`` is the min corner of the box the turned piece fills.
"""

from __future__ import annotations

from typing import Protocol

# Voxel shape codes, CONTRACT section 7.
FULL, SLOPE_N, SLOPE_E, SLOPE_S, SLOPE_W, RIDGE_I, RIDGE_J, TILE, WATER = range(9)


class Painter(Protocol):
    def fill(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str | int,
             feature: int = 0, shape: int = 0) -> None: ...

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None: ...

    def place(self, piece: str, i: int, j: int, k: int, facing: str, colour: str | int,
              feature: int = 0, *, no_variation: bool = False) -> tuple[int, int, int, int, int, int]: ...
