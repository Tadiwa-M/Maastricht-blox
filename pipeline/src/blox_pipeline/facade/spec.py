"""Declarative description of one test-scene house.

A house is an axis-aligned box whose street front faces -j; its front is painted as a
facade run (``front_run`` -> ``run.paint_run``), the rest (shell, side windows, roof) here
and in ``walls`` / ``roofs``. Seen from the street, the
cells along j are (front to back): ``y0`` = trim layer (pilasters, sills, cornices that
stick out), ``wall_j`` = the wall plane (where window/door pieces sit), ``glass_j`` = the
first interior row (dark "room" backdrops behind the glass), then air up to the back wall.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .run import FacadeRun


# Vertical rhythm in plates (0.2 m), shared by houses and facade runs.
PLINTH, GROUND_H, STOREY_H = 3, 18, 15


class RoofKind(Enum):
    STEPPED_GABLE = "stepped_gable"  # ridge runs back from the street, stepped gable in front
    EAVE_DORMERS = "eave_dormers"    # ridge parallel to the street, dormers on the front slope
    FLAT_CORNICE = "flat_cornice"    # flat roof behind a heavy cornice and balustrade


class GroundFloor(Enum):
    HOUSE = "house"    # plinth, front door, windows
    SHOP = "shop"      # shop windows, arched shop door, sign band with lettering, awning
    ARCHED = "arched"  # door and windows each under a round arch with a fanlight
    PLAIN = "plain"    # windows only (side and back walls of real buildings)


@dataclass(frozen=True)
class HouseSpec:
    x0: int                 # local i of the west wall
    y0: int                 # local j of the street-side protrusion layer
    width: int              # studs along i (>= 8)
    depth: int              # studs along j
    storeys: int            # upper storeys above the ground floor
    fid: int                # feature id
    wall: str
    trim: str = "white"
    accent: str = "dark_green"   # door, shutters, sign band
    roof: str = "roof_tile_red"
    roof_kind: RoofKind = RoofKind.STEPPED_GABLE
    ground: GroundFloor = GroundFloor.HOUSE
    awning: tuple[str, str] = ("white", "bus_red")
    quoins: bool = False
    shutters: bool = False
    flowers: str | None = None   # flower colour for first-floor window boxes
    plinth: str = "dark_grey"
    corner_west: bool = False   # end of a row: the west side wall gets windows too
    balcony: bool = False       # first-floor balcony with a fence in front of the middle bay

    PLINTH = PLINTH
    GROUND_H = GROUND_H
    STOREY_H = STOREY_H

    def floor_k(self, g: int, storey: int) -> int:
        """Global k of the floor line of ``storey`` (0 = ground floor)."""
        return g if storey == 0 else g + self.GROUND_H + (storey - 1) * self.STOREY_H

    def eave_k(self, g: int) -> int:
        return self.floor_k(g, self.storeys + 1)

    def front_run(self) -> "FacadeRun":
        """The street front as a facade run (the grid is its frame: pieces face S)."""
        from .run import FacadeRun

        return FacadeRun(
            x0=self.x0, x1=self.x1, y0=self.y0, storeys=self.storeys, fid=self.fid, wall=self.wall,
            trim=self.trim, accent=self.accent, plinth=self.plinth, ground=self.ground,
            awning=self.awning, quoins=self.quoins, shutters=self.shutters, flowers=self.flowers,
            balcony=self.balcony,
        )

    @property
    def x1(self) -> int:
        return self.x0 + self.width

    @property
    def wall_j(self) -> int:
        """The main wall plane; ``y0`` in front of it holds protruding trim."""
        return self.y0 + 1

    @property
    def glass_j(self) -> int:
        """First interior row: backdrops behind window pieces so rooms do not look empty."""
        return self.y0 + 2

    @property
    def y1(self) -> int:
        return self.y0 + self.depth
