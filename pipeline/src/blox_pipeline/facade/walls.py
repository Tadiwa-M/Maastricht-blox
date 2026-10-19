"""Walls, windows, doors and shop fronts of a house; the roof is in ``roofs``."""

from __future__ import annotations

from .bays import WINDOW_W, bay_starts
from .painter import SLOPE_S, Painter
from .roofs import paint_roof
from .spec import GroundFloor, HouseSpec

FLOWER_LEAF = "leaf"


def paint_house(cv: Painter, h: HouseSpec, g: int) -> None:
    """Paint a complete house with its street front facing -j; ``g`` = ground level k."""
    _shell(cv, h, g)
    _pilasters(cv, h, g)
    for s in range(1, h.storeys + 1):
        _storey_band(cv, h, h.floor_k(g, s))
        for x in bay_starts(h.x0, h.x1):
            _upper_window(cv, h, x, h.floor_k(g, s) + 3, flowers=h.flowers if s == 1 else None)
    if h.ground is GroundFloor.SHOP:
        _shop_front(cv, h, g)
    else:
        _house_front(cv, h, g)
    if h.corner_west:
        _west_windows(cv, h, g)
    _eave_cornice(cv, h, h.eave_k(g))
    paint_roof(cv, h, h.eave_k(g))


def _shell(cv: Painter, h: HouseSpec, g: int) -> None:
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


def _storey_band(cv: Painter, h: HouseSpec, k: int) -> None:
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, k - 1, k, h.trim, h.fid)


def _opening(cv: Painter, h: HouseSpec, x: int, w: int, k0: int, k1: int, glass: str = "glass") -> None:
    """Cut the wall plane and set glass one cell back."""
    cv.clear(x, x + w, h.wall_j, h.wall_j + 1, k0, k1)
    cv.fill(x, x + w, h.glass_j, h.glass_j + 1, k0, k1, glass, h.fid)


def _upper_window(cv: Painter, h: HouseSpec, x: int, kb: int, flowers: str | None) -> None:
    w, height = WINDOW_W, 8
    _opening(cv, h, x, w, kb, kb + height)
    lintel = h.trim if h.quoins else h.wall  # proud of the wall either way, so it casts a shadow
    cv.fill(x, x + w, h.y0, h.wall_j, kb + height, kb + height + 1, lintel, h.fid)
    if h.shutters:
        for i in (x - 1, x + w):
            cv.fill(i, i + 1, h.y0, h.wall_j, kb, kb + height, h.accent, h.fid)
    if flowers:
        cv.fill(x, x + w, h.y0, h.wall_j, kb - 1, kb + 1, "brick_brown", h.fid)    # window box
        for i in range(x, x + w):
            cv.fill(i, i + 1, h.y0, h.wall_j, kb + 1, kb + 2, flowers if i % 2 else FLOWER_LEAF, h.fid)
    else:
        cv.fill(x, x + w, h.y0, h.wall_j, kb - 1, kb, h.trim, h.fid)              # sill


def _house_front(cv: Painter, h: HouseSpec, g: int) -> None:
    bays = bay_starts(h.x0, h.x1)
    door = bays[len(bays) // 2]
    k_door = g + 12
    cv.clear(door, door + WINDOW_W, h.wall_j, h.wall_j + 1, g, k_door + 2)
    cv.fill(door, door + WINDOW_W, h.glass_j, h.glass_j + 1, g, k_door, h.accent, h.fid)
    cv.fill(door, door + WINDOW_W, h.glass_j, h.glass_j + 1, k_door, k_door + 2, "glass_light", h.fid)
    cv.fill(door - 1, door + WINDOW_W + 1, h.y0, h.wall_j, k_door + 2, k_door + 3, h.trim, h.fid)
    cv.fill(door, door + WINDOW_W, h.y0, h.wall_j, g, g + 1, "light_grey", h.fid)  # door step
    cv.clear(door, door + WINDOW_W, h.y0, h.wall_j, g + 1, g + h.PLINTH)
    for x in bays:
        if x != door:
            _upper_window(cv, h, x, g + 5, flowers=None)


def _shop_front(cv: Painter, h: HouseSpec, g: int) -> None:
    x0, x1 = h.x0 + 1, h.x1 - 1
    top = g + 13
    _opening(cv, h, x0, x1 - x0, g + 1, top)
    for i in range(x0 + 3, x1 - 1, 4):                                   # mullions
        cv.fill(i, i + 1, h.glass_j, h.glass_j + 1, g + 1, top, h.trim, h.fid)
    mid = (x0 + x1) // 2 - 1
    cv.fill(mid, mid + 2, h.glass_j, h.glass_j + 1, g, top - 2, h.accent, h.fid)  # door
    cv.fill(x0, x1, h.glass_j, h.glass_j + 1, g, g + 1, h.plinth, h.fid)          # stall riser
    # Sign band with "lettering" and a striped awning below it.
    band0 = top + 1
    cv.fill(h.x0, h.x1, h.y0, h.wall_j + 1, band0, band0 + 3, h.accent, h.fid)
    for i in range(x0 + 1, x1 - 1):
        if i % 3 != 0:
            cv.fill(i, i + 1, h.y0, h.wall_j, band0 + 1, band0 + 2, "cream", h.fid)
    for i in range(x0, x1):
        stripe = h.awning[(i - x0) % 2]
        cv.fill(i, i + 1, h.y0, h.wall_j, top - 3, top, stripe, h.fid)
        cv.fill(i, i + 1, h.y0 - 1, h.y0, top - 3, top, stripe, h.fid, SLOPE_S)
    cv.fill(h.x0, h.x1, h.wall_j, h.wall_j + 1, top, band0, h.wall, h.fid)


def _eave_cornice(cv: Painter, h: HouseSpec, eave: int) -> None:
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, eave - 2, eave, h.trim, h.fid)
    cv.fill(h.x0, h.x1, h.y0 - 1, h.y0, eave - 1, eave, h.trim, h.fid)
    for i in range(h.x0, h.x1, 2):                                       # corbels
        cv.fill(i, i + 1, h.y0 - 1, h.y0, eave - 2, eave - 1, h.trim, h.fid)


def _west_windows(cv: Painter, h: HouseSpec, g: int) -> None:
    """Windows on an exposed west side wall (end of a row): glass recessed to ``x0 + 1``."""
    i = h.x0
    for s in range(1, h.storeys + 1):
        kb = h.floor_k(g, s) + 3
        for y in bay_starts(h.wall_j, h.y1):
            cv.clear(i, i + 1, y, y + WINDOW_W, kb, kb + 8)
            cv.fill(i + 1, i + 2, y, y + WINDOW_W, kb, kb + 8, "glass", h.fid)
            cv.fill(i - 1, i, y, y + WINDOW_W, kb - 1, kb, h.trim, h.fid)
