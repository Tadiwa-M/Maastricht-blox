"""Declarative description of one house front.

A house is an axis-aligned box whose street front faces -j. Seen from the street, the
cells along j are (front to back): ``y0`` = trim layer (pilasters, sills, cornices that
stick out), ``wall_j`` = the wall plane (where window/door pieces sit), ``glass_j`` = the
first interior row (dark "room" backdrops behind the glass), then air up to the back wall.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class RoofKind(Enum):
    STEPPED_GABLE = "stepped_gable"  # ridge runs back from the street, stepped gable in front
    EAVE_DORMERS = "eave_dormers"    # ridge parallel to the street, dormers on the front slope
    FLAT_CORNICE = "flat_cornice"    # flat roof behind a heavy cornice and balustrade


class GroundFloor(Enum):
    HOUSE = "house"    # plinth, front door, windows
    SHOP = "shop"      # shop windows, arched shop door, sign band with lettering, awning
    ARCHED = "arched"  # door and windows each under a round arch with a fanlight


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

    # Vertical rhythm in plates (0.2 m).
    PLINTH = 3
    GROUND_H = 18
    STOREY_H = 15

    def floor_k(self, g: int, storey: int) -> int:
        """Global k of the floor line of ``storey`` (0 = ground floor)."""
        return g if storey == 0 else g + self.GROUND_H + (storey - 1) * self.STOREY_H

    def eave_k(self, g: int) -> int:
        return self.floor_k(g, self.storeys + 1)

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
