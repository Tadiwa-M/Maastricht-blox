"""Street context for facades: which walls face a street, a pedestrian street or a square,
and which buildings hold a shop.

A facade run "faces" an area when a probe strip in front of it (``PROBE_M`` deep, over the
middle of the run) touches it. OSM roads are centre lines, so they are buffered by their
width like the road surfaces; squares and pedestrian areas are polygons already.
"""

from __future__ import annotations

from dataclasses import dataclass

import shapely
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from ..sources.model import OsmData
from .prepare_osm import ROAD_WIDTH_M, in_centre, parse_width

PROBE_M = 8.0  # sidewalks are often not mapped: look this far out from the wall
NOT_STREETS = frozenset({"path", "track", "steps", "cycleway", "bridleway", "service"})
PEDESTRIAN = frozenset({"pedestrian", "living_street"})
SHOP_AMENITIES = frozenset({
    "cafe", "restaurant", "bar", "pub", "fast_food", "ice_cream", "pharmacy", "bank",
    "bureau_de_change", "biergarten", "food_court", "marketplace",
})


@dataclass
class StreetContext:
    street: BaseGeometry | None = None      # every street surface
    pedestrian: BaseGeometry | None = None  # pedestrian streets and squares in the centre

    def area(self, probe: BaseGeometry) -> float:
        """Street and square area (m²) inside ``probe``."""
        geoms = [g for g in (self.street, self.pedestrian) if g is not None]
        return float(shapely.union_all(geoms).intersection(probe).area) if geoms else 0.0

    def faces(self, probe: BaseGeometry) -> tuple[bool, bool]:
        """``(street, pedestrian)``: does the probe strip touch either area?"""
        st = self.street is not None and bool(shapely.intersects(self.street, probe))
        ped = self.pedestrian is not None and bool(shapely.intersects(self.pedestrian, probe))
        return st or ped, ped


def street_context(osm: OsmData) -> StreetContext:
    streets, peds = [], []
    for f in osm.roads:
        hw = f.tags.get("highway", "")
        if hw in NOT_STREETS:
            continue
        poly = f.geom.buffer((parse_width(f.tags) or ROAD_WIDTH_M.get(hw, 4.0)) / 2)
        streets.append(poly)
        if hw in PEDESTRIAN and in_centre(f.geom):
            peds.append(poly)
    for f in osm.road_areas:
        if f.tags.get("amenity") == "parking":
            continue
        streets.append(f.geom)
        if in_centre(f.geom):
            peds.append(f.geom)  # squares and pedestrian areas
    ctx = StreetContext(unary_union(streets) if streets else None, unary_union(peds) if peds else None)
    for g in (ctx.street, ctx.pedestrian):
        if g is not None:
            shapely.prepare(g)
    return ctx


def is_shop(tags: dict[str, str]) -> bool:
    return "shop" in tags or tags.get("amenity") in SHOP_AMENITIES

