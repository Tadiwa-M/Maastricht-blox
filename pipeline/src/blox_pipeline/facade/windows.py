"""Upper-storey window bays, the west side wall of a corner house and the balcony.

An upper bay, bottom to top (k relative to the storey floor ``f``)::

    f-1        storey band (trim, at y0)
    f+1..f+3   sloped sill (two slope30_1x2) or a flower box
    f+3..f+12  window_1x2x3 in the wall plane, shutters at y0 either side
    f+12       lintel plate at y0
"""

from __future__ import annotations

from .bays import WINDOW_W, bay_starts
from .painter import Painter
from .pieces import backdrop, door, fence_run, flower_box, piece_h, sloped_sill, window
from .spec import HouseSpec

SILL_GAP = 3  # plates between the storey floor and the window bottom


def window_bay(cv: Painter, h: HouseSpec, x: int, kb: int, flowers: str | None = None) -> None:
    """One framed window with sill (or flower box), lintel and optional shutters."""
    top = window(cv, h, x, kb)
    lintel = h.trim if h.quoins else h.wall  # proud of the wall either way: casts a shadow
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, top, top + 1, lintel, h.fid)
    if h.shutters:
        for i in (x - 1, x + WINDOW_W):
            cv.fill(i, i + 1, h.y0, h.wall_j, kb, top, h.accent, h.fid)
    if flowers:
        flower_box(cv, h, x, kb, flowers)
    else:
        sloped_sill(cv, h, x, kb)


def balcony_bay(h: HouseSpec, g: int) -> int | None:
    """Bay start of the balcony (middle bay of storey 1), or None without a balcony."""
    if not h.balcony or h.storeys < 1:
        return None
    bays = bay_starts(h.x0, h.x1)
    return bays[len(bays) // 2]


def balcony(cv: Painter, h: HouseSpec, x: int, floor: int) -> None:
    """Door onto a 2-deep slab with a fence in front, posts at the sides and corbels."""
    i0, i1 = x - 1, x + WINDOW_W + 1
    door(cv, h, x, floor)
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, floor + piece_h("door_1x2x4"),
            floor + piece_h("door_1x2x4") + 1, h.trim, h.fid)
    cv.fill(i0, i1, h.y0 - 2, h.y0, floor - 1, floor, h.trim, h.fid)          # slab
    for i in (i0, i1 - 1):
        cv.fill(i, i + 1, h.y0 - 2, h.y0 - 1, floor - 2, floor - 1, h.trim, h.fid)  # corbels
        cv.fill(i, i + 1, h.y0 - 1, h.y0, floor, floor + 3, h.accent, h.fid)        # side posts
    cv.place("fence_1x4", i0, h.y0 - 2, floor, "S", h.accent, h.fid)


def upper_storeys(cv: Painter, h: HouseSpec, g: int) -> None:
    for s in range(1, h.storeys + 1):
        f = h.floor_k(g, s)
        cv.fill(h.x0, h.x1, h.y0, h.wall_j, f - 1, f, h.trim, h.fid)  # storey band
        for x in bay_starts(h.x0, h.x1):
            if s == 1 and x == balcony_bay(h, g):
                balcony(cv, h, x, f)
            else:
                window_bay(cv, h, x, f + SILL_GAP, h.flowers if s == 1 else None)


def west_windows(cv: Painter, h: HouseSpec, g: int) -> None:
    """Windows on an exposed west side wall (end of a row): front faces W (-i)."""
    i = h.x0
    piece = "window_1x2x3"
    for s in range(1, h.storeys + 1):
        kb = h.floor_k(g, s) + SILL_GAP
        top = kb + piece_h(piece)
        for y in bay_starts(h.wall_j, h.y1):
            cv.clear(i, i + 1, y, y + WINDOW_W, kb, top)
            cv.place(piece, i, y, kb, "W", h.trim, h.fid)
            cv.fill(i + 1, i + 2, y, y + WINDOW_W, kb, top, backdrop(y, kb, h.fid), h.fid)
            cv.fill(i - 1, i, y, y + WINDOW_W, kb - 1, kb, h.trim, h.fid)          # sill
