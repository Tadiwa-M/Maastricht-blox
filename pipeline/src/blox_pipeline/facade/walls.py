"""``paint_house``: the order a house is built in, plus its plain wall parts.

Order matters because placed pieces need air and nothing may be painted over them later:
shell (walls + plinth) -> corner pilasters -> upper storeys -> ground floor -> west side
windows -> eave cornice -> roof. Windows, doors and details live in ``windows``,
``ground`` and ``pieces``; the roof in ``roofs``.
"""

from __future__ import annotations

from .ground import ground_floor
from .painter import Painter
from .roofs import paint_roof
from .spec import HouseSpec
from .windows import upper_storeys, west_windows


def paint_house(cv: Painter, h: HouseSpec, g: int) -> None:
    """Paint a complete house with its street front facing -j; ``g`` = ground level k."""
    _shell(cv, h, g)
    _pilasters(cv, h, g)
    upper_storeys(cv, h, g)
    ground_floor(cv, h, g)
    if h.corner_west:
        west_windows(cv, h, g)
    _eave_cornice(cv, h, h.eave_k(g))
    paint_roof(cv, h, h.eave_k(g))


def _shell(cv: Painter, h: HouseSpec, g: int) -> None:
    """Four 1-stud walls up to the eave and a plinth course that also covers ``y0``."""
    top = h.eave_k(g)
    cv.fill(h.x0, h.x1, h.wall_j, h.y1, g, top, h.wall, h.fid)
    cv.clear(h.x0 + 1, h.x1 - 1, h.wall_j + 1, h.y1 - 1, g, top)
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, g, g + h.PLINTH, h.plinth, h.fid)  # plinth course
    cv.fill(h.x0, h.x1, h.wall_j, h.y1, g, g + h.PLINTH, h.plinth, h.fid)
    cv.clear(h.x0 + 1, h.x1 - 1, h.wall_j + 1, h.y1 - 1, g, g + h.PLINTH)


def _pilasters(cv: Painter, h: HouseSpec, g: int) -> None:
    """Corner pilasters one cell proud of the wall; quoins alternate per brick course."""
    top = h.eave_k(g)
    for i in (h.x0, h.x1 - 1):
        for k in range(g + h.PLINTH, top, 3):
            course = (k - g) // 3
            colour = h.trim if h.quoins and course % 2 == 0 else h.wall
            cv.fill(i, i + 1, h.y0, h.wall_j, k, min(k + 3, top), colour, h.fid)


def _eave_cornice(cv: Painter, h: HouseSpec, eave: int) -> None:
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, eave - 2, eave, h.trim, h.fid)
    cv.fill(h.x0, h.x1, h.y0 - 1, h.y0, eave - 1, eave, h.trim, h.fid)
    for i in range(h.x0, h.x1, 2):                                       # corbels
        cv.fill(i, i + 1, h.y0 - 1, h.y0, eave - 2, eave - 1, h.trim, h.fid)
