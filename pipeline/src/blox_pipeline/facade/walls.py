"""``paint_house``: the order a test-scene house is built in, plus its shell.

Order matters because placed pieces need air and nothing may be painted over them later:
shell (walls + plinth) -> street front as a facade run (corner pilasters, upper storeys,
ground floor, eave cornice: ``run.paint_run``) -> west side windows -> roof.
"""

from __future__ import annotations

from .painter import Painter
from .roofs import paint_roof
from .run import paint_run
from .spec import HouseSpec
from .windows import west_windows


def paint_house(cv: Painter, h: HouseSpec, g: int) -> None:
    """Paint a complete house with its street front facing -j; ``g`` = ground level k."""
    _shell(cv, h, g)
    paint_run(cv, h.front_run(), g)
    if h.corner_west:
        west_windows(cv, h, g)
    paint_roof(cv, h, h.eave_k(g))


def _shell(cv: Painter, h: HouseSpec, g: int) -> None:
    """Four 1-stud walls up to the eave and a plinth course that also covers ``y0``."""
    top = h.eave_k(g)
    cv.fill(h.x0, h.x1, h.wall_j, h.y1, g, top, h.wall, h.fid)
    cv.clear(h.x0 + 1, h.x1 - 1, h.wall_j + 1, h.y1 - 1, g, top)
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, g, g + h.PLINTH, h.plinth, h.fid)  # plinth course
    cv.fill(h.x0, h.x1, h.wall_j, h.y1, g, g + h.PLINTH, h.plinth, h.fid)
    cv.clear(h.x0 + 1, h.x1 - 1, h.wall_j + 1, h.y1 - 1, g, g + h.PLINTH)
