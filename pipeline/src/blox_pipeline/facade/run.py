"""A facade run: one straight stretch of wall with one outward normal, and its painter.

The grammar works in a *run frame*: ``x`` runs along the wall, ``y`` runs inward, and the
outward side is ``-y``, so the run's pieces face ``S`` in the frame. Rows along ``y``::

    y0 - 1     overhang row (cornice, awning slopes): outside the building
    y0         trim layer: pilasters, bands, sills, shutters, flower boxes (stick out)
    wall_j     wall plane (y0 + 1): window, door and arch pieces sit here
    glass_j    first interior row (y0 + 2): dark "room" backdrops behind the glass

A test-scene house front (``HouseSpec.front_run``) is a run whose frame is the grid itself
(front faces -j). A real building's wall is a run seen through ``facade.frame.FramePainter``,
which turns the frame so ``S`` becomes the wall's outward normal.

``cuts`` are frame ``x`` positions of chunk borders inside the run (a border at ``c``
separates cell ``c - 1`` from cell ``c``). Pieces must not straddle one (CONTRACT 4), so
``bays`` shifts or skips window bays and ``free`` tells the shop front which units to use.
"""

from __future__ import annotations

from dataclasses import dataclass

from .bays import WINDOW_W, bay_starts
from .ground import ground_floor
from .painter import Painter
from .spec import GROUND_H, PLINTH, STOREY_H, GroundFloor
from .windows import upper_storeys


@dataclass(frozen=True)
class FacadeRun:
    x0: int                   # frame x of the first cell (a corner pilaster)
    x1: int                   # frame x one past the last cell
    y0: int                   # frame y of the trim layer
    storeys: int              # full upper storeys above the ground floor
    fid: int
    wall: str | int
    trim: str = "white"
    accent: str = "dark_green"
    plinth: str = "dark_grey"
    ground: GroundFloor = GroundFloor.HOUSE
    awning: tuple[str, str] = ("white", "bus_red")
    quoins: bool = False
    shutters: bool = False
    flowers: str | None = None
    balcony: bool = False
    eave_extra: int = 0       # plain wall plates between the last storey and the eave
    cuts: tuple[int, ...] = ()
    # look v2 (owner's Markt photos); the defaults keep the v2 grammar unchanged
    stone: str | None = None  # dressings (pilasters, bands, sills, lintels, cornice): None = trim
    door: str | None = None   # front door colour: None = accent
    window: str = "window_1x2x3"       # window piece of upper storeys and house ground floors
    shop_window: str = "window_1x2x3"  # shop front window piece
    surrounds: bool = False   # stone jambs flush with the wall round every window, stone lintel
    pediments: bool = False   # pediments over the first-floor windows
    iron_balcony: bool = False  # the balcony is a wrought-iron balcony_2x4 before a french window
    french: bool = False      # the other first-floor windows are french windows with railings
    vents: bool = False       # cellar vents in the plinth under ground-floor windows
    iron: str = "black"       # balconies, railings
    pier: int = 1             # least wall between window bays (2 on old-centre fronts)

    @property
    def dress(self) -> str | int:
        """Colour of the stone dressings (falls back to the trim, as before look v2)."""
        return self.stone if self.stone is not None else self.trim

    @property
    def door_colour(self) -> str | int:
        return self.door if self.door is not None else self.accent

    PLINTH = PLINTH
    GROUND_H = GROUND_H
    STOREY_H = STOREY_H

    def floor_k(self, g: int, storey: int) -> int:
        """Global k of the floor line of ``storey`` (0 = ground floor)."""
        return g if storey == 0 else g + GROUND_H + (storey - 1) * STOREY_H

    def eave_k(self, g: int) -> int:
        return self.floor_k(g, self.storeys + 1) + self.eave_extra

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def wall_j(self) -> int:
        return self.y0 + 1

    @property
    def glass_j(self) -> int:
        return self.y0 + 2

    def free(self, a: int, b: int) -> bool:
        """True when no chunk border falls strictly inside ``[a, b)``."""
        return not any(a < c < b for c in self.cuts)

    def bays(self, min_pier: int | None = None) -> list[int]:
        """Window bay starts, moved off chunk borders (a bay needs ``x-1 .. x+3`` free,
        room for shutters and an arch); a bay that cannot move is left out."""
        min_pier = max(self.pier, min_pier or 1)
        starts = bay_starts(self.x0, self.x1, min_pier=min_pier)
        if not self.cuts:
            return starts
        out: list[int] = []
        for n, x in enumerate(starts):
            lo = (out[-1] + WINDOW_W + min_pier) if out else self.x0 + 1
            hi = (starts[n + 1] - WINDOW_W - min_pier) if n + 1 < len(starts) else self.x1 - 1 - WINDOW_W
            for dx in (0, -1, 1, -2, 2):
                y = x + dx
                if lo <= y <= hi and self.free(y - 1, y + WINDOW_W + 1):
                    out.append(y)
                    break
        return out


def paint_run(cv: Painter, r: FacadeRun, g: int) -> None:
    """Paint a run's front: corner pilasters, upper storeys, ground floor, eave cornice.

    Expects the wall plane (``wall_j``) to be solid wall from ``g`` to the eave and the
    trim layer (``y0``) to be air above the plinth, as a house shell or a carved real wall
    leaves it. ``g`` is the global k of the ground floor line.
    """
    pilasters(cv, r, g)
    upper_storeys(cv, r, g)
    ground_floor(cv, r, g)
    eave_cornice(cv, r, r.eave_k(g))


def pilasters(cv: Painter, r: FacadeRun, g: int) -> None:
    """Corner pilasters one cell proud of the wall; quoins alternate per brick course."""
    top = r.eave_k(g)
    plain = r.stone if r.stone is not None else r.wall  # stone pilasters on dressed fronts
    for i in (r.x0, r.x1 - 1):
        for k in range(g + PLINTH, top, 3):
            course = (k - g) // 3
            colour = r.dress if r.quoins and course % 2 == 0 else plain
            if r.quoins and r.stone is not None and course % 2:
                colour = r.wall  # quoins on a dressed front: stone and wall courses
            cv.fill(i, i + 1, r.y0, r.wall_j, k, min(k + 3, top), colour, r.fid)


def eave_cornice(cv: Painter, r: FacadeRun, eave: int) -> None:
    cv.fill(r.x0, r.x1, r.y0, r.wall_j, eave - 2, eave, r.dress, r.fid)
    cv.fill(r.x0, r.x1, r.y0 - 1, r.y0, eave - 1, eave, r.dress, r.fid)
    for i in range(r.x0, r.x1, 2):                                       # corbels
        cv.fill(i, i + 1, r.y0 - 1, r.y0, eave - 2, eave - 1, r.dress, r.fid)
