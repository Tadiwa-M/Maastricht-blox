"""Roofs: stepped gables, eaves with dormers, flat roofs behind a balustrade.

Slopes follow CONTRACT section 7 as integrated: a slope is a 3-plate stack of slope cells
with a full stack of the same colour directly behind it (the studded back row).
"""

from __future__ import annotations

from .painter import RIDGE_I, RIDGE_J, SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W, TILE, Painter
from .pieces import fence_run, piece_h
from .spec import HouseSpec, RoofKind

BRICK = 3


def paint_roof(cv: Painter, h: HouseSpec, eave: int) -> None:
    if h.roof_kind is RoofKind.STEPPED_GABLE:
        ridge_top = _roof_ridge_along_j(cv, h, eave)
        _stepped_gable(cv, h, eave)
        _chimney(cv, h, h.x0 + 2, h.y1 - 4, ridge_top)
    elif h.roof_kind is RoofKind.EAVE_DORMERS:
        ridge_top = _roof_ridge_along_i(cv, h, eave)
        for x in range(h.x0 + 2, h.x1 - 5, 6):
            _dormer(cv, h, x, eave)
        _chimney(cv, h, h.x1 - 3, h.y0 + h.depth // 2, ridge_top)
    else:
        _flat_roof(cv, h, eave)


def _roof_ridge_along_j(cv: Painter, h: HouseSpec, top: int) -> int:
    """Gables front and back; slopes face -i / +i. Returns the k above the ridge."""
    j0, j1 = h.wall_j, h.y1
    t = 0
    while True:
        a, b, kb = h.x0 + t, h.x1 - 1 - t, top + BRICK * t
        if b - a + 1 <= 2:
            cv.fill(a, b + 1, j0, j1, kb, kb + BRICK, h.roof, h.fid, RIDGE_J)
            return kb + BRICK
        cv.fill(a + 1, b, j0, j0 + 1, kb, kb + BRICK, h.wall, h.fid)    # gable walls
        cv.fill(a + 1, b, j1 - 1, j1, kb, kb + BRICK, h.wall, h.fid)
        cv.fill(a, a + 1, j0, j1, kb, kb + BRICK, h.roof, h.fid, SLOPE_W)
        cv.fill(b, b + 1, j0, j1, kb, kb + BRICK, h.roof, h.fid, SLOPE_E)
        cv.fill(a + 1, a + 2, j0, j1, kb, kb + BRICK, h.roof, h.fid)
        cv.fill(b - 1, b, j0, j1, kb, kb + BRICK, h.roof, h.fid)
        t += 1


def _roof_ridge_along_i(cv: Painter, h: HouseSpec, top: int) -> int:
    """Ridge parallel to the street; slopes face -j / +j. Returns the k above the ridge."""
    t = 0
    while True:
        a, b, kb = h.wall_j + t, h.y1 - 1 - t, top + BRICK * t
        if b - a + 1 <= 2:
            cv.fill(h.x0, h.x1, a, b + 1, kb, kb + BRICK, h.roof, h.fid, RIDGE_I)
            return kb + BRICK
        cv.fill(h.x0, h.x0 + 1, a + 1, b, kb, kb + BRICK, h.wall, h.fid)  # side gables
        cv.fill(h.x1 - 1, h.x1, a + 1, b, kb, kb + BRICK, h.wall, h.fid)
        cv.fill(h.x0, h.x1, a, a + 1, kb, kb + BRICK, h.roof, h.fid, SLOPE_S)
        cv.fill(h.x0, h.x1, b, b + 1, kb, kb + BRICK, h.roof, h.fid, SLOPE_N)
        cv.fill(h.x0, h.x1, a + 1, a + 2, kb, kb + BRICK, h.roof, h.fid)
        cv.fill(h.x0, h.x1, b - 1, b, kb, kb + BRICK, h.roof, h.fid)
        t += 1


def _stepped_gable(cv: Painter, h: HouseSpec, top: int) -> None:
    """Dutch stepped gable (trapgevel), two cells deep, one brick proud of the roof line."""
    j0, j1 = h.y0, h.wall_j + 1
    s = 0
    while True:
        a, b = h.x0 + 2 * s, h.x1 - 2 * s
        kb = top + 2 * BRICK * s
        if b - a <= 4:
            cv.fill(a, b, j0, j1, kb, kb + 2 * BRICK, h.wall, h.fid)
            cv.fill(a, b, j0, j1, kb + 2 * BRICK, kb + 2 * BRICK + 1, h.trim, h.fid)
            mid = (a + b) // 2
            cv.fill(mid - 1, mid + 1, j0, j1, kb + 2 * BRICK + 1, kb + 3 * BRICK, h.trim, h.fid)  # finial
            cv.place("jumper_1x2", mid - 1, j0, kb + 3 * BRICK, "S", h.trim, h.fid)  # centred top stud
            break
        cv.fill(a, b, j0, j1, kb, kb + 3 * BRICK, h.wall, h.fid)
        for x in (a, b - 2):                                               # step caps
            cv.fill(x, x + 2, j0, j1, kb + 3 * BRICK, kb + 3 * BRICK + 1, h.trim, h.fid)
        for x in (a + 2, b - 3):                                           # wall anchors
            cv.fill(x, x + 1, j0, j0 + 1, kb + 4, kb + 5, "black", h.fid)
        s += 1
    mid = (h.x0 + h.x1) // 2
    if h.width >= 10:                                                      # attic window
        k = top + 3
        cv.clear(mid - 1, mid + 1, j0, j0 + 1, k, k + piece_h("window_1x2x2"))
        cv.place("window_1x2x2", mid - 1, j0, k, "S", h.trim, h.fid)       # gable wall behind
        cv.fill(mid - 1, mid + 1, j0, j0 + 1, k - 1, k, h.trim, h.fid)
    cv.clear(mid - 1, mid + 1, j0, j0 + 1, top + 14, top + 17)               # hoist window
    cv.fill(mid - 1, mid + 1, j0 + 1, j1, top + 14, top + 17, "glass", h.fid)


def _dormer(cv: Painter, h: HouseSpec, x: int, eave: int) -> None:
    """A 4-wide dormer on the front slope with its own little gable roof."""
    jf = h.wall_j + 1                       # dormer face sits one row up the slope
    k0 = eave + BRICK
    k1 = k0 + 9
    cv.fill(x, x + 4, jf, jf + 5, k0, k1, h.dormer or h.wall, h.fid)
    cv.fill(x, x + 4, jf, jf + 1, k0, k0 + 1, h.trim, h.fid)
    cv.clear(x + 1, x + 3, jf, jf + 1, k0 + 1, k0 + 1 + piece_h("window_1x2x2"))
    cv.place("window_1x2x2", x + 1, jf, k0 + 1, "S", h.trim, h.fid)
    cv.fill(x, x + 1, jf - 1, jf + 5, k1, k1 + BRICK, h.roof, h.fid, SLOPE_W)
    cv.fill(x + 3, x + 4, jf - 1, jf + 5, k1, k1 + BRICK, h.roof, h.fid, SLOPE_E)
    cv.fill(x + 1, x + 3, jf - 1, jf + 5, k1, k1 + BRICK, h.roof, h.fid)
    cv.fill(x + 1, x + 3, jf - 1, jf + 5, k1 + BRICK, k1 + 2 * BRICK, h.roof, h.fid, RIDGE_J)


def _flat_roof(cv: Painter, h: HouseSpec, eave: int) -> None:
    j0 = h.wall_j
    cv.fill(h.x0, h.x1, j0, h.y1, eave, eave + 1, "dark_grey", h.fid, TILE)
    cv.fill(h.x0, h.x1, j0, j0 + 1, eave, eave + 6, h.wall, h.fid)            # attic band
    cv.fill(h.x0, h.x1, h.y0, j0, eave + 3, eave + 5, h.trim, h.fid)            # cornice
    cv.fill(h.x0, h.x1, h.y0 - 1, h.y0, eave + 4, eave + 5, h.trim, h.fid)
    fence_run(cv, h.x0, h.x1, j0, eave + 6, h.trim, h.fid)                    # balustrade
    cv.fill(h.x0, h.x1, j0, j0 + 1, eave + 9, eave + 10, h.trim, h.fid)          # top rail
    cv.fill(h.x0 + 3, h.x0 + 6, h.y1 - 6, h.y1 - 3, eave + 1, eave + 7, "light_grey", h.fid)  # roof hatch


def _chimney(cv: Painter, h: HouseSpec, x: int, y: int, ridge_top: int) -> None:
    cv.fill(x, x + 2, y, y + 1, ridge_top - 3 * BRICK, ridge_top + BRICK, "brick_dark_red", h.fid)
    cv.fill(x, x + 2, y, y + 1, ridge_top + BRICK, ridge_top + BRICK + 1, "dark_grey", h.fid)
