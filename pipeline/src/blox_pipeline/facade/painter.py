"""The minimal painting surface the facade grammar needs (``testscene.Canvas`` fits)."""

from __future__ import annotations

from typing import Protocol

# Voxel shape codes, CONTRACT section 7.
FULL, SLOPE_N, SLOPE_E, SLOPE_S, SLOPE_W, RIDGE_I, RIDGE_J, TILE, WATER = range(9)


class Painter(Protocol):
    def fill(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str | int,
             feature: int = 0, shape: int = 0) -> None: ...

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None: ...
