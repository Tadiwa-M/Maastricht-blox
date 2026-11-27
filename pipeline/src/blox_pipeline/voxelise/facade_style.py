"""Facade style per real building: a deterministic hash of the BAG id picks the details.

The wall colour comes from ``colours.wall_colour`` (by era); this module picks what goes
with it, following the same eras: old buildings (before 1900, the mergel and brick centre)
get cream/white trim, coloured doors and shutters, quoins on mergel; 1900-1945 gets
painted trim without shutters; post-war buildings get grey trim and no ornament.

Look v2 (owner's Markt photos, ``docs/reference/markt.md``): in the **old centre**
(``colours.old_centre``) a building from before 1945 gets the Maastricht townhouse: white
many-paned sash windows (``window_1x2x4``) in blue-grey limestone surrounds, limestone
plinth with cellar vents, cornice and bands, white panelled doors, stone shop fronts with
lettered shop windows, wrought-iron balconies and french-window railings on a share of the
first floors, pediments now and then, and white dormers on the slate roof.
"""

from __future__ import annotations

from dataclasses import dataclass

from .raster import stable_hash

ACCENTS_OLD = ("dark_green", "dark_green", "brick_dark_red", "medium_blue", "black", "dark_blue")
ACCENTS_NEW = ("black", "dark_grey", "dark_blue", "dark_green")
ACCENTS_CENTRE = ("black", "dark_green", "dark_blue", "black", "brick_dark_red", "dark_grey")
FLOWERS = ("flower_pink", "signal_yellow", "bus_red", "flower_pink")
AWNINGS = ("bus_red", "dark_green", "medium_blue", "signal_yellow", "brick_dark_red")
LIGHT_WALLS = ("white", "cream", "mergel_light", "light_grey", "plaster_white", "plaster_cream", "plaster_grey")


@dataclass(frozen=True)
class FacadeStyle:
    trim: str
    accent: str
    plinth: str
    quoins: bool
    shutters: bool
    flowers: str | None
    awning: tuple[str, str]
    arched: bool  # street-facing ground floor as an arcade (old buildings only)
    # look v2 (old centre); the defaults are the v2 grammar
    stone: str | None = None
    door: str | None = None
    window: str = "window_1x2x3"
    shop_window: str = "window_1x2x3"
    surrounds: bool = False
    pediments: bool = False
    iron_balcony: bool = False
    french: bool = False
    vents: bool = False
    dormers: bool = False


def facade_style(bag_id: str, year: int | None, wall: str, centre: bool = False) -> FacadeStyle:
    """Style for one building; same inputs always give the same style."""
    h = stable_hash(bag_id + "/facade")
    if centre and (year is None or year < 1945):
        return _centre_style(h, wall)
    old = year is None or year < 1900
    modern = year is not None and year >= 1945
    light_wall = wall in LIGHT_WALLS
    if modern:
        trim = "dark_grey" if light_wall else ("light_grey", "white")[h % 2]
        accent = ACCENTS_NEW[(h >> 3) % len(ACCENTS_NEW)]
    else:
        trim = ("mergel_dark", "light_grey")[h % 2] if light_wall else ("white", "cream", "white")[h % 3]
        accent = ACCENTS_OLD[(h >> 3) % len(ACCENTS_OLD)]
    mergel = wall.startswith("mergel")
    return FacadeStyle(
        trim=trim,
        accent=accent,
        plinth="mergel_dark" if old and wall != "mergel_dark" else "dark_grey",
        quoins=old and (mergel or (h >> 6) % 3 == 0),
        shutters=old and (h >> 8) % 2 == 0,
        flowers=FLOWERS[(h >> 10) % len(FLOWERS)] if old and (h >> 12) % 3 == 0 else None,
        awning=("white", AWNINGS[(h >> 14) % len(AWNINGS)]),
        arched=year is not None and year < 1800 and (h >> 17) % 4 == 0,
    )


def _centre_style(h: int, wall: str) -> FacadeStyle:
    """The old-centre townhouse (see the module docstring)."""
    stone = "limestone_dark" if wall.startswith("limestone") else "limestone"
    return FacadeStyle(
        trim="white",
        accent=ACCENTS_CENTRE[(h >> 3) % len(ACCENTS_CENTRE)],
        plinth="limestone_dark" if wall == "limestone" else "limestone",
        quoins=wall.startswith("brick") and (h >> 6) % 2 == 0,  # stone quoins on brick
        shutters=False,
        flowers=None,
        awning=("white", AWNINGS[(h >> 14) % len(AWNINGS)]),
        arched=False,
        stone=stone,
        door="white" if (h >> 9) % 4 else ACCENTS_CENTRE[(h >> 11) % 3],
        window="window_1x2x4",
        shop_window="shop_window_1x2x4",
        surrounds=True,
        pediments=(h >> 15) % 5 == 0,
        iron_balcony=(h >> 18) % 5 < 2,      # two in five first floors
        french=(h >> 21) % 3 == 0,
        vents=True,
        dormers=True,
    )
