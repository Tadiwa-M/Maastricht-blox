"""Where nobody walks: water that is not under a bridge (accuracy A2).

Water comes from OSM (areas and waterways buffered by their width) and, where cached, the BGT
(``waterdeel``); bridges from OSM ``bridge=*`` ways (buffered by half their width + 1 m) and
the BGT's ``overbruggingsdeel``. The result is used to drop walkway nodes and edges that would
put walkers on the river.
"""

from __future__ import annotations

from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from ..sources.model import BgtData, OsmData
from ..voxelise.prepare_osm import BRIDGE_VALUES, ROAD_WIDTH_M, WATERWAY_WIDTH_M, parse_width


def wet_area(osm: OsmData, bgt: BgtData | None = None) -> BaseGeometry | None:
    water = [f.geom for f in osm.water]
    for f in osm.waterways:
        w = parse_width(f.tags) or WATERWAY_WIDTH_M.get(f.tags.get("waterway", ""), 2.0)
        water.append(f.geom.buffer(w / 2, cap_style="flat"))
    bridges = [f.geom.buffer((parse_width(f.tags) or ROAD_WIDTH_M.get(f.tags.get("highway", ""), 4.0)) / 2 + 1.0)
               for f in osm.roads if f.tags.get("bridge") in BRIDGE_VALUES]
    if bgt is not None:
        water += [f.geom for f in bgt.layer("waterdeel") if f.level == 0]
        bridges += [f.geom.buffer(1.0) for f in bgt.layer("overbruggingsdeel") if f.level >= 1]
    if not water:
        return None
    wet = unary_union(water)
    if bridges:
        wet = wet.difference(unary_union(bridges))
    return None if wet.is_empty else wet
