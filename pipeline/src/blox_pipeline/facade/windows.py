"""Upper-storey window bays, the west side wall of a corner house and the balcony.

An upper bay, bottom to top (k relative to the storey floor ``f``)::

    f-1        storey band (dressing, at y0)
    f+1..f+3   sloped sill (two slope30_1x2) or a flower box
    f+3..f+12  window_1x2x3 in the wall plane, shutters at y0 either side
    f+12       lintel plate at y0

Look v2 (``FacadeRun.window = "window_1x2x4"``): the tall sash window fills ``f+2..f+14``
over a sill at ``f..f+2``, the next storey band above it is its lintel. With ``surrounds``
the wall-plane cells either side are stone (flush jambs); with ``pediments`` the first-floor
windows are ``window_1x2x3`` under a ``pediment_1x4``; with ``french`` they reach down to
the floor behind a ``railing_1x2``; ``iron_balcony`` puts a ``balcony_2x4`` before a french
window in the middle bay.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .bays import WINDOW_W, bay_starts
from .painter import Painter
from .pieces import backdrop, door, flower_box, piece_h, sloped_sill, window
from .spec import HouseSpec

if TYPE_CHECKING:
    from .run import FacadeRun

SILL_GAP = 3  # plates between the storey floor and the window bottom
TALL = "window_1x2x4"


def _surround(cv: Painter, h: "FacadeRun", x: int, kb: int, top: int) -> None:
    """Stone jambs in the wall plane either side of the opening ``x .. x+2``, on a side
    only where at least 3 studs of wall separate it from the next opening (else the stone
    would swallow the wall; the lintel and sill still frame the window)."""
    if not h.surrounds:
        return
    ends = [h.x0 + 1] + [b + WINDOW_W for b in h.bays() if b < x]
    starts = [b for b in h.bays() if b > x] + [h.x1 - 1]
    if x - max(ends) >= 3:
        cv.fill(x - 1, x, h.wall_j, h.wall_j + 1, kb, top, h.dress, h.fid)
    if min(starts) - (x + WINDOW_W) >= 3:
        cv.fill(x + WINDOW_W, x + WINDOW_W + 1, h.wall_j, h.wall_j + 1, kb, top, h.dress, h.fid)


def window_bay(cv: Painter, h: "FacadeRun", x: int, kb: int, flowers: str | None = None,
               piece: str = "window_1x2x3", lintel: bool = True) -> None:
    """One framed window with sill (or flower box), lintel and optional shutters."""
    top = window(cv, h, x, kb, piece)
    _surround(cv, h, x, kb, top)
    if lintel:
        colour = h.dress if (h.quoins or h.surrounds) else h.wall  # proud of the wall: a shadow
        x0, x1 = (x - 1, x + WINDOW_W + 1) if h.surrounds else (x, x + WINDOW_W)
        cv.fill(x0, x1, h.y0, h.wall_j, top, top + 1, colour, h.fid)
    if h.shutters:
        for i in (x - 1, x + WINDOW_W):
            cv.fill(i, i + 1, h.y0, h.wall_j, kb, top, h.accent, h.fid)
    if flowers:
        flower_box(cv, h, x, kb, flowers)
    else:
        sloped_sill(cv, h, x, kb)


def balcony_bay(h: "FacadeRun") -> int | None:
    """Bay start of the balcony (middle bay of storey 1), or None without a balcony."""
    bays = h.bays()
    if not h.balcony or h.storeys < 1 or not bays:
        return None
    return bays[len(bays) // 2]


def balcony(cv: Painter, h: "FacadeRun", x: int, floor: int) -> None:
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


def iron_balcony(cv: Painter, h: "FacadeRun", x: int, floor: int) -> None:
    """French window to the floor, a stone slab on two corbels one stud out, and a black
    wrought-iron ``balcony_2x4`` standing on it (2 deep: the trim layer and the slab row)."""
    top = window(cv, h, x, floor, TALL)
    _surround(cv, h, x, floor, top)
    cv.fill(x - 1, x + WINDOW_W + 1, h.y0, h.wall_j, top, top + 1, h.dress, h.fid)   # lintel
    cv.fill(x - 1, x + WINDOW_W + 1, h.y0 - 1, h.y0, floor - 1, floor, h.dress, h.fid)  # slab
    for i in (x - 1, x + WINDOW_W):
        cv.fill(i, i + 1, h.y0 - 1, h.y0, floor - 2, floor - 1, h.dress, h.fid)          # corbels
    cv.clear(x - 1, x + WINDOW_W + 1, h.y0 - 1, h.wall_j, floor, floor + piece_h("balcony_2x4"))
    cv.place("balcony_2x4", x - 1, h.y0 - 1, floor, "S", h.iron, h.fid)


def french_window(cv: Painter, h: "FacadeRun", x: int, floor: int) -> None:
    """Tall window from the floor with a simple iron railing in front (trim layer)."""
    top = window(cv, h, x, floor + 1, TALL)
    _surround(cv, h, x, floor + 1, top)
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, top, top + 1, h.dress, h.fid)                # lintel
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, floor, floor + 1, h.dress, h.fid)            # threshold
    cv.clear(x, x + WINDOW_W, h.y0, h.wall_j, floor + 1, floor + 1 + piece_h("railing_1x2"))
    cv.place("railing_1x2", x, h.y0, floor + 1, "S", h.iron, h.fid)


def pedimented_window(cv: Painter, h: "FacadeRun", x: int, f: int) -> None:
    """``window_1x2x3`` with a ``pediment_1x4`` over it (needs ``f+12 .. f+14`` free)."""
    kb = f + SILL_GAP
    window_bay(cv, h, x, kb, lintel=False)
    top = kb + piece_h("window_1x2x3")
    cv.clear(x - 1, x + WINDOW_W + 1, h.y0, h.wall_j, top, top + piece_h("pediment_1x4"))
    cv.place("pediment_1x4", x - 1, h.y0, top, "S", h.dress, h.fid)


def _tall_fits(h: "FacadeRun", s: int) -> bool:
    """A 12-plate window reaches the next band; under the eave cornice it needs a spare plate."""
    return s < h.storeys or h.eave_extra >= 1


def upper_storeys(cv: Painter, h: "FacadeRun", g: int) -> None:
    for s in range(1, h.storeys + 1):
        f = h.floor_k(g, s)
        cv.fill(h.x0, h.x1, h.y0, h.wall_j, f - 1, f, h.dress, h.fid)  # storey band
        tall = h.window == TALL and _tall_fits(h, s)
        free_from = h.x0  # pediments are 4 wide: two may not overlap over a 1-stud pier
        for n, x in enumerate(h.bays()):
            if s == 1 and x == balcony_bay(h):
                if h.iron_balcony and _tall_fits(h, s):
                    iron_balcony(cv, h, x, f)
                else:
                    balcony(cv, h, x, f)
            elif s == 1 and h.pediments and (s < h.storeys or h.eave_extra >= 2) and x - 1 >= free_from:
                pedimented_window(cv, h, x, f)
                free_from = x + WINDOW_W + 1
            elif s == 1 and h.french and tall and n % 2 == 0:
                french_window(cv, h, x, f)
            elif tall:
                window_bay(cv, h, x, f + 2, h.flowers if s == 1 else None, TALL, lintel=False)
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
