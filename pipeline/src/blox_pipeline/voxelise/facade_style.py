"""Facade style per real building: a deterministic hash of the BAG id picks the details.

The wall colour comes from ``colours.wall_colour`` (by era); this module picks what goes
with it, following the same eras: old buildings (before 1900, the mergel and brick centre)
get cream/white trim, coloured doors and shutters, quoins on mergel; 1900-1945 gets
painted trim without shutters; post-war buildings get grey trim and no ornament.
"""

from __future__ import annotations

from dataclasses import dataclass

from .raster import stable_hash

ACCENTS_OLD = ("dark_green", "dark_green", "brick_dark_red", "medium_blue", "black", "dark_blue")
ACCENTS_NEW = ("black", "dark_grey", "dark_blue", "dark_green")
FLOWERS = ("flower_pink", "signal_yellow", "bus_red", "flower_pink")
AWNINGS = ("bus_red", "dark_green", "medium_blue", "signal_yellow", "brick_dark_red")
LIGHT_WALLS = ("white", "cream", "mergel_light", "light_grey")


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


def facade_style(bag_id: str, year: int | None, wall: str) -> FacadeStyle:
    """Style for one building; same inputs always give the same style."""
    h = stable_hash(bag_id + "/facade")
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
