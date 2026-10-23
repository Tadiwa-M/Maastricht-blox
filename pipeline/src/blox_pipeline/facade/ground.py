"""Ground floors: a plain house front, a shop front, or an arcade of arched openings.

Ground-floor heights (k relative to ground ``g``)::

    g..g+3      plinth course (painted by the shell)
    g..g+12     door_1x2x4 (steps out of the plinth)
    g+3..g+12   window_1x2x3 (shop / arched); g+4..g+13 on a plain house (sill below)
    g+12..g+15  arch_1x4 over the door (shop, arched) and over windows (arched)
    g+15..g+17  shop sign band with grille lettering
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .bays import WINDOW_W
from .painter import SLOPE_S, Painter
from .pieces import arch_over, door, window
from .spec import GroundFloor
from .windows import window_bay

if TYPE_CHECKING:
    from .run import FacadeRun


def ground_floor(cv: Painter, h: "FacadeRun", g: int) -> None:
    if h.ground is GroundFloor.SHOP:
        shop_front(cv, h, g)
    elif h.ground is GroundFloor.ARCHED:
        arched_front(cv, h, g)
    elif h.ground is GroundFloor.PLAIN:
        plain_front(cv, h, g)
    else:
        house_front(cv, h, g)


def _front_door(cv: Painter, h: "FacadeRun", x: int, g: int) -> int:
    """Door with a stone step in front (the plinth is cut away there)."""
    top = door(cv, h, x, g)
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, g, g + 1, "light_grey", h.fid)
    cv.clear(x, x + WINDOW_W, h.y0, h.wall_j, g + 1, g + h.PLINTH)
    return top


def plain_front(cv: Painter, h: "FacadeRun", g: int) -> None:
    """Windows only: a side or back wall."""
    for x in h.bays():
        window_bay(cv, h, x, g + 4)


def house_front(cv: Painter, h: "FacadeRun", g: int) -> None:
    bays = h.bays()
    if not bays:
        return
    entry = bays[len(bays) // 2]
    top = _front_door(cv, h, entry, g)
    cv.fill(entry - 1, entry + WINDOW_W + 1, h.y0, h.wall_j, top, top + 1, h.trim, h.fid)  # door hood
    for x in bays:
        if x != entry:
            window_bay(cv, h, x, g + 4)


def arched_front(cv: Painter, h: "FacadeRun", g: int) -> None:
    """Every opening under its own arch; piers of 2 so neighbouring arches never touch."""
    bays = h.bays(min_pier=2)
    if not bays:
        return
    entry = bays[len(bays) // 2]
    for x in bays:
        top = _front_door(cv, h, x, g) if x == entry else window(cv, h, x, g + h.PLINTH)
        arch_top = arch_over(cv, h, x, top)
        cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, arch_top - 1, arch_top, h.trim, h.fid)  # keystone


def shop_front(cv: Painter, h: "FacadeRun", g: int) -> None:
    """Shop windows in 2-stud units, an arched door in the middle unit, awning, sign."""
    x0, x1 = h.x0 + 1, h.x1 - 1
    units = [x for x in range(x0, x1 - 1, WINDOW_W) if h.free(x, x + WINDOW_W)]  # off chunk borders
    doors = [x for x in units if h.free(x - 1, x + WINDOW_W + 1)]  # room for the arch
    mid = (x0 + x1 - WINDOW_W) / 2
    entry = min(doors, key=lambda x: (abs(x - mid), x)) if doors else None
    if not h.cuts:
        entry = units[len(units) // 2]  # no chunk borders: the middle unit
    transom = g + 12
    cv.fill(x0, x1, h.wall_j, h.wall_j + 1, transom, transom + 3, h.trim, h.fid)
    for x in units:
        if x == entry:
            arch_over(cv, h, x, _front_door(cv, h, x, g))
        else:
            window(cv, h, x, g + h.PLINTH)
    if entry is None:
        entry = x1 + WINDOW_W  # no door: awning runs the whole width
    _awning(cv, h, x0, x1, entry, transom)
    _sign(cv, h, transom + 3)


def _awning(cv: Painter, h: "FacadeRun", x0: int, x1: int, entry: int, k: int) -> None:
    """Striped awning (a slope row in front of a full row), open above the arched door."""
    for i in range(x0, x1):
        if entry - 1 <= i <= entry + WINDOW_W:
            continue
        stripe = h.awning[(i - x0) % 2]
        cv.fill(i, i + 1, h.y0, h.wall_j, k, k + 3, stripe, h.fid)
        cv.fill(i, i + 1, h.y0 - 1, h.y0, k, k + 3, stripe, h.fid, SLOPE_S)


def _sign(cv: Painter, h: "FacadeRun", k: int) -> None:
    """Accent sign band; ``grille_1x2`` tiles set into its front read as lettering. The
    band's wall-plane row stops inside the corner pilasters, so it never wraps a corner."""
    cv.fill(h.x0, h.x1, h.y0, h.wall_j, k, k + 2, h.accent, h.fid)
    cv.fill(h.x0 + 1, h.x1 - 1, h.wall_j, h.wall_j + 1, k, k + 2, h.accent, h.fid)
    for x in range(h.x0 + 2, h.x1 - 3, 3):
        if not h.free(x, x + 2):
            continue
        cv.clear(x, x + 2, h.y0, h.wall_j, k + 1, k + 2)
        cv.place("grille_1x2", x, h.y0, k + 1, "S", "cream", h.fid, no_variation=True)
