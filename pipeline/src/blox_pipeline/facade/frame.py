"""``FramePainter``: paint a facade run whose outward side is any compass direction.

The grammar paints in a run frame (x along the wall, y inward, front faces ``S``; see
``run``). A frame is a proper rotation of the grid (never a mirror), anchored so that frame
``(0, 0)`` is a chosen global cell:

| normal (outward) | frame x axis | frame y axis (inward) |
|---|---|---|
| ``S`` (-j) | +i | +j |
| ``E`` (+i) | +j | -i |
| ``N`` (+j) | -i | -j |
| ``W`` (-i) | -j | +i |

Boxes map to boxes, facings turn with the frame (frame ``S`` becomes ``normal``) and so do
slope/ridge shape codes, so a run painted through a ``FramePainter`` is the same facade
turned to face its street. Coordinates handed to the inner painter are global ``(I, J)``.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..catalogue import load_catalogue
from ..rotation import Facing, rotated_extent
from .painter import RIDGE_I, RIDGE_J, SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W, Painter

# Unit vectors (di, dj) of each compass direction.
DIRS: dict[str, tuple[int, int]] = {"N": (0, 1), "E": (1, 0), "S": (0, -1), "W": (-1, 0)}
_BY_DIR = {v: k for k, v in DIRS.items()}
_SLOPE_DIR = {SLOPE_N: "N", SLOPE_E: "E", SLOPE_S: "S", SLOPE_W: "W"}
_DIR_SLOPE = {v: k for k, v in _SLOPE_DIR.items()}
# frame x axis for each outward normal; the inward y axis is minus the normal.
X_AXIS: dict[str, tuple[int, int]] = {"S": (1, 0), "E": (0, 1), "N": (-1, 0), "W": (0, -1)}


@dataclass(frozen=True)
class Frame:
    normal: str          # outward direction of the wall: N, E, S or W
    ai: int              # global I of frame (0, 0)
    aj: int              # global J of frame (0, 0)

    @property
    def x_axis(self) -> tuple[int, int]:
        return X_AXIS[self.normal]

    @property
    def y_axis(self) -> tuple[int, int]:
        ni, nj = DIRS[self.normal]
        return -ni, -nj

    def to_global(self, x: int, y: int) -> tuple[int, int]:
        (xi, xj), (yi, yj) = self.x_axis, self.y_axis
        return self.ai + x * xi + y * yi, self.aj + x * xj + y * yj

    def box(self, x0: int, x1: int, y0: int, y1: int) -> tuple[int, int, int, int]:
        """Global half-open ``(i0, i1, j0, j1)`` of the frame box ``[x0,x1) x [y0,y1)``."""
        a = self.to_global(x0, y0)
        b = self.to_global(x1 - 1, y1 - 1)
        return min(a[0], b[0]), max(a[0], b[0]) + 1, min(a[1], b[1]), max(a[1], b[1]) + 1

    def direction(self, local: str) -> str:
        """Global compass direction of a frame direction (frame ``S`` is the normal)."""
        lx, ly = {"N": (0, 1), "E": (1, 0), "S": (0, -1), "W": (-1, 0)}[local]
        (xi, xj), (yi, yj) = self.x_axis, self.y_axis
        return _BY_DIR[(lx * xi + ly * yi, lx * xj + ly * yj)]

    def shape(self, code: int) -> int:
        """Turn a voxel shape code (slopes and ridges change with the frame)."""
        if code in _SLOPE_DIR:
            return _DIR_SLOPE[self.direction(_SLOPE_DIR[code])]
        if code in (RIDGE_I, RIDGE_J) and self.normal in ("E", "W"):
            return RIDGE_J if code == RIDGE_I else RIDGE_I
        return code


@dataclass
class FramePainter:
    """A :class:`Painter` in run-frame coordinates that forwards to ``inner`` in global ones."""

    inner: Painter
    frame: Frame

    def fill(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str | int,
             feature: int = 0, shape: int = 0) -> None:
        if i0 >= i1 or j0 >= j1 or k0 >= k1:
            return
        a, b, c, d = self.frame.box(i0, i1, j0, j1)
        self.inner.fill(a, b, c, d, k0, k1, colour, feature, self.frame.shape(shape))

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None:
        if i0 >= i1 or j0 >= j1 or k0 >= k1:
            return
        a, b, c, d = self.frame.box(i0, i1, j0, j1)
        self.inner.clear(a, b, c, d, k0, k1)

    def place(self, piece: str, i: int, j: int, k: int, facing: str, colour: str | int,
              feature: int = 0, *, no_variation: bool = False) -> tuple[int, int, int, int, int, int]:
        t = load_catalogue()[piece]
        ex, ey = rotated_extent(t.w, t.d, Facing.parse(facing).value)
        a, b, c, d = self.frame.box(i, i + ex, j, j + ey)
        g = Facing.parse(self.frame.direction(Facing.parse(facing).name))
        return self.inner.place(piece, a, c, k, g.name, colour, feature, no_variation=no_variation)
