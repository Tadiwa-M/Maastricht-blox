"""Tag rules deciding which :class:`OsmData` groups an OSM object belongs to."""

from __future__ import annotations

ROAD_HIGHWAYS = frozenset({
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "living_street", "service", "pedestrian", "footway", "cycleway", "path", "steps", "track",
    "busway", "bus_guideway",
})
RAILWAYS = frozenset({"rail", "light_rail", "tram", "narrow_gauge", "subway"})
WATERWAYS = frozenset({"river", "stream", "canal", "ditch", "drain"})
PARK_TAGS = {
    "leisure": {"park", "garden", "pitch", "playground", "nature_reserve", "golf_course", "common"},
    "landuse": {"grass", "forest", "meadow", "cemetery", "recreation_ground", "village_green",
                "allotments", "orchard", "vineyard", "farmland", "flowerbed",
                "retail", "commercial", "industrial", "railway", "construction", "brownfield"},
    "natural": {"wood", "scrub", "grassland", "heath"},
    "amenity": {"grave_yard"},
}
ROAD_AREA_TAGS = {
    "highway": {"pedestrian", "footway", "service", "living_street"},
    "place": {"square"},
    "amenity": {"parking"},
    "area:highway": None,  # any value
}
POI_KEYS = ("amenity", "tourism", "historic", "shop", "leisure", "office", "craft", "man_made")


def is_poi(tags: dict[str, str]) -> bool:
    if "name" not in tags:
        return False
    if tags.get("railway") in ("station", "halt") or tags.get("public_transport") == "station":
        return True
    if tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform":
        return True
    return any(k in tags for k in POI_KEYS)


def classify_node(tags: dict[str, str]) -> list[str]:
    out = []
    if tags.get("natural") == "tree":
        out.append("trees")
    if "addr:housenumber" in tags:
        out.append("addresses")
    if is_poi(tags):
        out.append("pois")
    return out


def classify_way(tags: dict[str, str]) -> list[str]:
    """Linear interpretation of a way (areas are classified separately)."""
    out = []
    if tags.get("area") == "yes":
        return out
    hw = tags.get("highway")
    if hw in ROAD_HIGHWAYS and tags.get("tunnel") not in ("yes", "building_passage", "culvert"):
        out.append("roads")
    if tags.get("railway") in RAILWAYS and tags.get("tunnel") != "yes":
        out.append("railways")
    if tags.get("waterway") in WATERWAYS and tags.get("tunnel") != "culvert":
        out.append("waterways")
    if tags.get("natural") == "tree_row":
        out.append("trees")
    return out


def _matches(tags: dict[str, str], table: dict[str, set[str] | None]) -> bool:
    for key, values in table.items():
        v = tags.get(key)
        if v is not None and (values is None or v in values):
            return True
    return False


def is_water_area(tags: dict[str, str]) -> bool:
    return (
        tags.get("natural") == "water"
        or tags.get("waterway") in ("riverbank", "dock", "canal")
        or tags.get("landuse") in ("reservoir", "basin")
    )


def classify_area(tags: dict[str, str]) -> list[str]:
    out = []
    if "building" in tags:
        out.append("buildings")
        if "addr:housenumber" in tags:
            out.append("addresses")
    elif is_water_area(tags):
        out.append("water")
    elif _matches(tags, PARK_TAGS):
        out.append("landuse")
    if "building" not in tags and _is_road_area(tags):
        out.append("road_areas")
    if is_poi(tags) and "landuse" not in out and "water" not in out:
        out.append("pois")  # named parks/water become park/water features instead
    return out


def _is_road_area(tags: dict[str, str]) -> bool:
    if "area:highway" in tags or tags.get("place") == "square" or tags.get("amenity") == "parking":
        return tags.get("parking") not in ("underground", "multi-storey")
    return tags.get("highway") in ROAD_AREA_TAGS["highway"] and tags.get("area") == "yes"  # type: ignore[operator]
