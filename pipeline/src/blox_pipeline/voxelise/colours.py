"""Curated colour heuristics (all results are palette names)."""

from __future__ import annotations

from .raster import stable_hash

# (max year exclusive, weighted choices)
_WALL_BY_ERA: tuple[tuple[int, tuple[str, ...]], ...] = (
    (1700, ("mergel", "mergel", "mergel_light", "mergel_dark", "brick_red")),
    (1900, ("brick_red", "brick_dark_red", "mergel_light", "cream", "white", "mergel")),
    (1945, ("brick_red", "brick_dark_red", "brick_brown", "brick_orange")),
    (1980, ("brick_brown", "brick_orange", "brick_dark_red", "light_grey", "tan")),
    (10_000, ("light_grey", "white", "brick_orange", "tan", "sand_blue", "dark_grey", "brick_red")),
)
_WALL_UNKNOWN = ("brick_red", "brick_brown", "brick_dark_red")
_ROOF_PITCHED_OLD = ("slate", "slate", "roof_tile_red", "roof_tile_dark")
_ROOF_PITCHED = ("roof_tile_red", "roof_tile_red", "roof_tile_dark", "slate")
_ROOF_FLAT = ("dark_grey", "dark_grey", "light_grey", "black")

# highway -> (default colour outside the centre, colour inside the cobbled centre)
_ROAD_COLOUR: dict[str, tuple[str, str]] = {
    "motorway": ("asphalt", "asphalt"), "trunk": ("asphalt", "asphalt"),
    "primary": ("asphalt", "asphalt"), "secondary": ("asphalt", "asphalt"),
    "tertiary": ("asphalt", "asphalt"), "unclassified": ("asphalt", "asphalt"),
    "residential": ("asphalt", "cobble_grey"), "living_street": ("pavement", "cobble_grey"),
    "service": ("asphalt", "cobble_grey"), "pedestrian": ("pavement", "cobble_grey"),
    "footway": ("pavement", "cobble_grey"), "path": ("pavement", "pavement"),
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


def wall_colour(bag_id: str, year: int | None) -> str:
    if year is None:
        return _pick(bag_id, _WALL_UNKNOWN)
    for max_year, choices in _WALL_BY_ERA:
        if year < max_year:
            return _pick(bag_id, choices)
    return _pick(bag_id, _WALL_BY_ERA[-1][1])


def roof_colour(bag_id: str, year: int | None, pitched: bool) -> str:
    if not pitched:
        return _pick(bag_id + "/roof", _ROOF_FLAT)
    old = year is not None and year < 1900
    return _pick(bag_id + "/roof", _ROOF_PITCHED_OLD if old else _ROOF_PITCHED)


def road_colour(tags: dict[str, str], in_centre: bool) -> str:
    surface = tags.get("surface")
    if surface in _SURFACE_COLOUR:
        return _SURFACE_COLOUR[surface]
    outside, inside = _ROAD_COLOUR.get(tags.get("highway", ""), ("asphalt", "cobble_grey"))
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
