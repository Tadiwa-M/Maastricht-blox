"""Curated colour heuristics (all results are palette names).

Look v2 (2026-10-24, the owner's Markt photos, ``docs/reference/markt.md``): the **old
centre** (within ``OLD_CENTRE_M`` of the Markt or the Vrijthof, or any building from before
1900) is blue-grey limestone and grey/white/cream plaster under dark slate, with only a
little dark red brick and no ochre. Elsewhere the colours keep their variety by era.
"""

from __future__ import annotations

import math

from .raster import stable_hash

MARKT_RD = (176430.0, 318007.0)     # CONTRACT 1 reference points
VRIJTHOF_RD = (176185.0, 317717.0)
OLD_CENTRE_M = 700.0


def near_old_centre(x: float, y: float) -> bool:
    """Within ``OLD_CENTRE_M`` of the Markt or the Vrijthof (RD metres)."""
    return any(math.hypot(x - cx, y - cy) <= OLD_CENTRE_M for cx, cy in (MARKT_RD, VRIJTHOF_RD))


def old_centre(x: float, y: float, year: int | None) -> bool:
    """Old-centre look: near the Markt/Vrijthof, or built before 1900 anywhere."""
    return near_old_centre(x, y) or (year is not None and year < 1900)


# (max year exclusive, weighted choices)
_WALL_BY_ERA: tuple[tuple[int, tuple[str, ...]], ...] = (
    (1700, ("mergel", "mergel", "mergel_light", "mergel_dark", "brick_red")),
    (1900, ("brick_red", "brick_dark_red", "mergel_light", "cream", "white", "mergel")),
    (1945, ("brick_red", "brick_dark_red", "brick_brown", "brick_orange")),
    (1980, ("brick_brown", "brick_orange", "brick_dark_red", "light_grey", "tan")),
    (10_000, ("light_grey", "white", "brick_orange", "tan", "sand_blue", "dark_grey", "brick_red")),
)
_WALL_UNKNOWN = ("brick_red", "brick_brown", "brick_dark_red")
# old centre, before 1945 (or unknown): limestone and plaster, one in twelve dark red brick
_WALL_CENTRE = ("limestone", "plaster_white", "plaster_cream", "plaster_grey", "limestone",
                "plaster_white", "brick_dark_red", "mergel_light", "plaster_grey", "limestone",
                "plaster_cream", "plaster_white")
# old centre, post-war infill: still mostly light plaster and stone
_WALL_CENTRE_NEW = ("plaster_white", "plaster_grey", "light_grey", "limestone", "brick_brown", "plaster_cream")
_ROOF_CENTRE = ("slate", "slate", "slate", "slate", "slate", "roof_tile_dark")
_ROOF_PITCHED_OLD = ("slate", "slate", "roof_tile_red", "roof_tile_dark")
_ROOF_PITCHED = ("roof_tile_red", "roof_tile_red", "roof_tile_dark", "slate")
# flat roofs: real ones are dark bitumen, but black reads as a hole in the model from above
_ROOF_FLAT = ("light_grey", "light_grey", "dark_grey", "pavement")

# highway -> (default colour outside the centre, colour inside the cobbled centre)
_ROAD_COLOUR: dict[str, tuple[str, str]] = {
    "motorway": ("asphalt", "asphalt"), "trunk": ("asphalt", "asphalt"),
    "primary": ("asphalt", "asphalt"), "secondary": ("asphalt", "asphalt"),
    "tertiary": ("asphalt", "asphalt"), "unclassified": ("asphalt", "asphalt"),
    "residential": ("asphalt", "cobble_dark"), "living_street": ("pavement", "cobble_dark"),
    "service": ("asphalt", "cobble_dark"), "pedestrian": ("pavement", "cobble_dark"),
    "footway": ("pavement", "cobble_dark"), "path": ("pavement", "pavement"),
    "steps": ("light_grey", "light_grey"), "track": ("dark_tan", "dark_tan"),
    "cycleway": ("brick_dark_red", "brick_dark_red"), "busway": ("asphalt", "asphalt"),
}
_SURFACE_COLOUR = {
    "asphalt": "asphalt", "concrete": "light_grey", "paved": "pavement",
    "paving_stones": "pavement", "sett": "cobble_grey", "cobblestone": "cobble_grey",
    "unhewn_cobblestone": "cobble_grey", "compacted": "dark_tan", "gravel": "dark_tan",
    "fine_gravel": "tan", "ground": "soil", "dirt": "soil", "grass": "grass",
}


def _pick(key: str, choices: tuple[str, ...]) -> str:
    return choices[stable_hash(key) % len(choices)]


def wall_colour(bag_id: str, year: int | None, centre: bool = False) -> str:
    """Wall colour by era; ``centre`` (see ``old_centre``) picks the limestone/plaster look."""
    if centre:
        return _pick(bag_id, _WALL_CENTRE_NEW if year is not None and year >= 1945 else _WALL_CENTRE)
    if year is None:
        return _pick(bag_id, _WALL_UNKNOWN)
    for max_year, choices in _WALL_BY_ERA:
        if year < max_year:
            return _pick(bag_id, choices)
    return _pick(bag_id, _WALL_BY_ERA[-1][1])


def roof_colour(bag_id: str, year: int | None, pitched: bool, centre: bool = False) -> str:
    if not pitched:
        return _pick(bag_id + "/roof", _ROOF_FLAT)
    if centre:
        return _pick(bag_id + "/roof", _ROOF_CENTRE)
    old = year is not None and year < 1900
    return _pick(bag_id + "/roof", _ROOF_PITCHED_OLD if old else _ROOF_PITCHED)


def road_colour(tags: dict[str, str], in_centre: bool) -> str:
    surface = tags.get("surface")
    if surface in _SURFACE_COLOUR:
        colour = _SURFACE_COLOUR[surface]
        return "cobble_dark" if in_centre and colour == "cobble_grey" else colour  # wet dark setts
    outside, inside = _ROAD_COLOUR.get(tags.get("highway", ""), ("asphalt", "cobble_dark"))
    return inside if in_centre else outside


def landuse_colour(tags: dict[str, str]) -> str | None:
    """Ground colour for a landuse/leisure area, None to keep the default."""
    if tags.get("natural") in ("wood", "scrub") or tags.get("landuse") in ("forest", "orchard"):
        return "grass_dark"
    if tags.get("leisure") == "pitch":
        return "grass_dark" if tags.get("surface", "grass") == "grass" else "brick_orange"
    if tags.get("landuse") in ("retail", "commercial", "industrial", "railway", "construction", "brownfield"):
        return "pavement"
    if tags.get("landuse") == "farmland":
        return "dark_tan"
    return "grass"


def window_period(bag_id: str) -> int:
    """Facade rhythm: one 1-stud window every 2 or 3 studs (1-2 stud piers)."""
    return 2 + stable_hash(bag_id + "/win") % 2
