"""Ground floors: a plain house front, a shop front, or an arcade of arched openings.

Ground-floor heights (k relative to ground ``g``)::

    g..g+3      plinth course (painted by the shell)
    g..g+12     door_1x2x4 (steps out of the plinth)
    g+3..g+12   window_1x2x3 (shop / arched); g+4..g+13 on a plain house (sill below)
    g+12..g+15  arch_1x4 over the door (shop, arched) and over windows (arched)
    g+15..g+17  shop sign band with grille lettering
"""

from __future__ import annotations

from .bays import WINDOW_W, bay_starts
from .painter import SLOPE_S, Painter
from .pieces import arch_over, door, window
from .spec import GroundFloor, HouseSpec
from .windows import window_bay


def ground_floor(cv: Painter, h: HouseSpec, g: int) -> None:
    if h.ground is GroundFloor.SHOP:
        shop_front(cv, h, g)
    elif h.ground is GroundFloor.ARCHED:
        arched_front(cv, h, g)
    else:
        house_front(cv, h, g)


def _front_door(cv: Painter, h: HouseSpec, x: int, g: int) -> int:
    """Door with a stone step in front (the plinth is cut away there)."""
    top = door(cv, h, x, g)
    cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, g, g + 1, "light_grey", h.fid)
    cv.clear(x, x + WINDOW_W, h.y0, h.wall_j, g + 1, g + h.PLINTH)
    return top


def house_front(cv: Painter, h: HouseSpec, g: int) -> None:
    bays = bay_starts(h.x0, h.x1)
    entry = bays[len(bays) // 2]
    top = _front_door(cv, h, entry, g)
    cv.fill(entry - 1, entry + WINDOW_W + 1, h.y0, h.wall_j, top, top + 1, h.trim, h.fid)  # door hood
    for x in bays:
        if x != entry:
            window_bay(cv, h, x, g + 4)


def arched_front(cv: Painter, h: HouseSpec, g: int) -> None:
    """Every opening under its own arch; piers of 2 so neighbouring arches never touch."""
    bays = bay_starts(h.x0, h.x1, min_pier=2)
    entry = bays[len(bays) // 2]
    for x in bays:
        top = _front_door(cv, h, x, g) if x == entry else window(cv, h, x, g + h.PLINTH)
        arch_top = arch_over(cv, h, x, top)
        cv.fill(x, x + WINDOW_W, h.y0, h.wall_j, arch_top - 1, arch_top, h.trim, h.fid)  # keystone


def shop_front(cv: Painter, h: HouseSpec, g: int) -> None:
    """Shop windows in 2-stud units, an arched door in the middle unit, awning, sign."""
    x0, x1 = h.x0 + 1, h.x1 - 1
    units = list(range(x0, x1 - 1, WINDOW_W))
    entry = units[len(units) // 2]
    transom = g + 12
    cv.fill(x0, x1, h.wall_j, h.wall_j + 1, transom, transom + 3, h.trim, h.fid)
    for x in units:
        if x == entry:
            arch_over(cv, h, x, _front_door(cv, h, x, g))
        else:
            window(cv, h, x, g + h.PLINTH)
    _awning(cv, h, x0, x1, entry, transom)
    _sign(cv, h, transom + 3)


def _awning(cv: Painter, h: HouseSpec, x0: int, x1: int, entry: int, k: int) -> None:
    """Striped awning (a slope row in front of a full row), open above the arched door."""
    for i in range(x0, x1):
        if entry - 1 <= i <= entry + WINDOW_W:
            continue
        stripe = h.awning[(i - x0) % 2]
        cv.fill(i, i + 1, h.y0, h.wall_j, k, k + 3, stripe, h.fid)
        cv.fill(i, i + 1, h.y0 - 1, h.y0, k, k + 3, stripe, h.fid, SLOPE_S)


def _sign(cv: Painter, h: HouseSpec, k: int) -> None:
    """Accent sign band; ``grille_1x2`` tiles set into its front read as lettering."""
    cv.fill(h.x0, h.x1, h.y0, h.wall_j + 1, k, k + 2, h.accent, h.fid)
    for x in range(h.x0 + 2, h.x1 - 3, 3):
        cv.clear(x, x + 2, h.y0, h.wall_j, k + 1, k + 2)
        cv.place("grille_1x2", x, h.y0, k + 1, "S", "cream", h.fid, no_variation=True)
