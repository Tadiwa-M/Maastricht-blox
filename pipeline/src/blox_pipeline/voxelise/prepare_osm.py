"""OSM features -> surface patches, water bodies, trees and POI features."""

from __future__ import annotations

import math
import re

import numpy as np
from shapely.geometry import LineString, Point
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import geo
from ..sources.model import HeightGrid, OsmData, OsmFeature
from . import colours, palette
from .features import FeatureRegistry
from .grid import FULL, TILE
from .landmarks import CENTRE_ZONES, MAAS_NAMES
from .raster import cover, stable_hash
from .world import Deck, SurfacePatch, TreeSpec, VoxelConfig, WaterBody

ROAD_WIDTH_M = {
    "motorway": 14.0, "trunk": 12.0, "primary": 10.0, "secondary": 8.0, "tertiary": 7.0,
    "motorway_link": 6.0, "trunk_link": 6.0, "primary_link": 6.0, "secondary_link": 6.0,
    "tertiary_link": 6.0, "unclassified": 5.0, "residential": 5.5, "living_street": 4.5,
    "service": 3.5, "pedestrian": 5.0, "footway": 2.0, "cycleway": 2.5, "path": 1.5,
    "steps": 2.0, "track": 3.0, "busway": 6.0, "bus_guideway": 6.0,
}
ROAD_RANK = {  # paint order: higher ranks drawn later (on top)
    "path": 0, "track": 0, "footway": 1, "steps": 1, "cycleway": 2, "pedestrian": 3,
    "service": 4, "living_street": 5, "residential": 6, "unclassified": 6, "tertiary": 7,
    "secondary": 8, "primary": 9, "trunk": 9, "motorway": 9,
}
WATERWAY_WIDTH_M = {"river": 12.0, "canal": 10.0, "stream": 2.5, "ditch": 1.5, "drain": 1.5}
BRIDGE_VALUES = frozenset({"yes", "viaduct", "movable", "aqueduct", "cantilever", "covered", "trestle"})
P_LANDUSE, P_ROAD_AREA, P_ROAD, P_RAIL, P_ISLAND = 10, 20, 30, 50, 60
# Kerbs (look v2): a dark stone line just outside every car road, painted above footways,
# pedestrian streets and squares but below the other car roads (so junctions stay open).
KERB_ROADS = frozenset({"residential", "unclassified", "tertiary", "secondary", "primary", "trunk",
                        "tertiary_link", "secondary_link", "primary_link"})
P_KERB, KERB_M, KERB_COLOUR = P_ROAD + 3.5, 0.6, "limestone_dark"
RAIL_BED_M, RAIL_GAUGE_M = 3.0, 1.435


def parse_width(tags: dict[str, str]) -> float | None:
    """``width`` tag in metres ("7", "7 m", "7.5m"); falls back to ``lanes``."""
    m = re.match(r"\s*([0-9]+(?:[.,][0-9]+)?)\s*(m|meter|metre)?\s*$", tags.get("width", ""))
    if m:
        w = float(m.group(1).replace(",", "."))
        if 0.5 <= w <= 60:
            return w
    lanes = tags.get("lanes", "")
    if lanes.isdigit() and 0 < int(lanes) <= 8:
        return int(lanes) * 3.25
    return None


def in_centre(geom: BaseGeometry) -> bool:
    return any(z.intersects(geom) for z in CENTRE_ZONES)


def is_maas(tags: dict[str, str]) -> bool:
    name = tags.get("name", "")
    return any(n in name for n in MAAS_NAMES) and "kanaal" not in name.lower()


def bank_level(geom: BaseGeometry, dtm: HeightGrid) -> float:
    """Water level estimate from terrain just outside a water polygon."""
    ring = geom.buffer(3.0).difference(geom.buffer(1.0))
    for g in (ring, geom):
        hit = cover(g, dtm.box)
        if hit is None:
            continue
        win, mask = hit
        vals = dtm.window(win)[mask]
        vals = vals[~np.isnan(vals)]
        if len(vals):
            return float(np.percentile(vals, 10)) - 0.3
    return float(np.nanmedian(dtm.values)) - 0.5


def prepare_water(osm: OsmData, dtm: HeightGrid, cfg: VoxelConfig, reg: FeatureRegistry) -> list[WaterBody]:
    out: list[WaterBody] = []
    water_col = palette.idx("water")
    for f in sorted(osm.water, key=lambda f: f.osm_id):
        level = cfg.maas_level_m if is_maas(f.tags) else bank_level(f.geom, dtm)
        fid = reg.add("water", f.geom, key=f.name, name=f.name, osm_id=f.osm_id) if f.name else 0
        out.append(WaterBody(f.geom, level, water_col, fid))
    areas = unary_union([w.geom for w in out]) if out else None
    shallow = palette.idx("water_shallow")
    for f in sorted(osm.waterways, key=lambda f: f.osm_id):
        width = parse_width(f.tags) or WATERWAY_WIDTH_M.get(f.tags.get("waterway", ""), 2.0)
        poly = f.geom.buffer(width / 2, cap_style="flat")
        if areas is not None:
            if areas.covers(f.geom) or f.geom.intersection(areas).length > 0.8 * f.geom.length:
                continue
            poly = poly.difference(areas)
        if poly.is_empty:
            continue
        level = cfg.maas_level_m if is_maas(f.tags) else bank_level(poly, dtm)
        col = water_col if width >= 5 else shallow
        fid = reg.add("water", poly, key=f.name, name=f.name, osm_id=f.osm_id) if f.name else 0
        out.append(WaterBody(poly, level, col, fid))
    return out


def _street_feature(f: OsmFeature, reg: FeatureRegistry) -> int:
    if not f.name:
        return 0
    return reg.add("street", f.geom, key=f.name, name=f.name, osm_id=f.osm_id)


def _deck(f: OsmFeature, dtm: HeightGrid, water: list[WaterBody], cfg: VoxelConfig) -> Deck | None:
    if f.tags.get("bridge") not in BRIDGE_VALUES or not isinstance(f.geom, LineString):
        return None
    (x0, y0), (x1, y1) = f.geom.coords[0], f.geom.coords[-1]
    z0 = dtm.sample(*geo.rd_to_grid(x0, y0))
    z1 = dtm.sample(*geo.rd_to_grid(x1, y1))
    if math.isnan(z0) or math.isnan(z1):
        z0 = z1 = float(np.nanmax([z0, z1, np.nanmedian(dtm.values)]))
    under = [w.level_m for w in water if w.geom.intersects(f.geom)]
    if under:
        floor = max(under) + cfg.bridge_clearance_m
        z0, z1 = max(z0, floor), max(z1, floor)
    return Deck(f.geom, z0, z1, palette.idx("light_grey"))


def prepare_roads(osm: OsmData, dtm: HeightGrid, water: list[WaterBody], cfg: VoxelConfig,
                  reg: FeatureRegistry) -> list[SurfacePatch]:
    out: list[SurfacePatch] = []
    for f in sorted(osm.roads, key=lambda f: f.osm_id):
        hw = f.tags.get("highway", "")
        width = parse_width(f.tags) or ROAD_WIDTH_M.get(hw, 4.0)
        colour = palette.idx(colours.road_colour(f.tags, in_centre(f.geom)))
        surface = f.geom.buffer(width / 2)
        deck = _deck(f, dtm, water, cfg)
        out.append(SurfacePatch(surface, colour, TILE, P_ROAD + ROAD_RANK.get(hw, 4), _street_feature(f, reg), deck))
        if hw in KERB_ROADS and deck is None:
            kerb = surface.buffer(KERB_M, cap_style="flat").difference(surface)
            out.append(SurfacePatch(kerb, palette.idx(KERB_COLOUR), TILE, P_KERB))
    for f in sorted(osm.road_areas, key=lambda f: f.osm_id):
        tags = f.tags if "highway" in f.tags else {**f.tags, "highway": "pedestrian"}
        name = "asphalt" if f.tags.get("amenity") == "parking" else colours.road_colour(tags, in_centre(f.geom))
        out.append(SurfacePatch(f.geom, palette.idx(name), TILE, P_ROAD_AREA, _street_feature(f, reg)))
    bed, metal = palette.idx("rail_brown"), palette.idx("metal")
    for f in sorted(osm.railways, key=lambda f: f.osm_id):
        deck = _deck(f, dtm, water, cfg)
        out.append(SurfacePatch(f.geom.buffer(RAIL_BED_M / 2), bed, TILE, P_RAIL, 0, deck))
        rails = f.geom.buffer(RAIL_GAUGE_M / 2 + 0.25).difference(f.geom.buffer(RAIL_GAUGE_M / 2 - 0.25))
        out.append(SurfacePatch(rails, metal, TILE, P_RAIL + 1, 0, deck))
    return out


def prepare_landuse(osm: OsmData, reg: FeatureRegistry) -> list[SurfacePatch]:
    out = []
    # big areas first so small parks inside them win (paint order within one priority)
    for rank, f in enumerate(sorted(osm.landuse, key=lambda f: (-f.geom.area, f.osm_id))):
        name = colours.landuse_colour(f.tags)
        if name is None:
            continue
        is_park = f.tags.get("leisure") in ("park", "garden") or f.tags.get("landuse") == "cemetery"
        fid = reg.add("park", f.geom, key=f.osm_id, name=f.name, osm_id=f.osm_id) if (f.name and is_park) else 0
        out.append(SurfacePatch(f.geom, palette.idx(name), FULL, P_LANDUSE + rank * 1e-6, fid))
    return out


def island_paving(groups: list) -> list[SurfacePatch]:
    """Pave the (unrotated) footprint of every island building at ground level. The island
    covers it, but its grown, turned outline never matches the world cells exactly: paving
    keeps grass and roads from showing through the gaps (CONTRACT 5.1)."""
    pave = palette.idx("pavement")
    return [SurfacePatch(b.footprint, pave, TILE, P_ISLAND) for g in groups for b in g.members]


def prepare_trees(osm: OsmData, dtm: HeightGrid, dsm: HeightGrid | None) -> list[TreeSpec]:
    points: list[tuple[str, Point]] = []
    for f in osm.trees:
        if isinstance(f.geom, Point):
            points.append((f.osm_id, f.geom))
        elif isinstance(f.geom, LineString):  # tree_row: one tree every 8 m
            n = max(1, int(f.geom.length // 8.0))
            for k in range(n + 1):
                points.append((f"{f.osm_id}#{k}", f.geom.interpolate(k / n, normalized=True)))
    leaf, leaf_light = palette.idx("leaf"), palette.idx("leaf_light")
    out = []
    for key, p in sorted(points, key=lambda t: t[0]):
        h = stable_hash(key)
        I, J = geo.rd_to_grid(p.x, p.y)
        height = _dsm_height(I, J, dtm, dsm) or (8.0 + (h % 700) / 100.0)  # plane/chestnut: 8-15 m
        crown = float(np.clip(0.36 * height, 2.5, 5.5))
        main, alt = (leaf, leaf_light) if h & 1 else (leaf_light, leaf)
        out.append(TreeSpec(I, J, height, crown, main, alt, h))
    return out


def _dsm_height(I: int, J: int, dtm: HeightGrid, dsm: HeightGrid | None) -> float | None:
    if dsm is None:
        return None
    box = geo.CellBox(I - 2, J - 2, I + 3, J + 3)
    top = dsm.window(box)
    ground = dtm.sample(I, J)
    if np.isnan(top).all() or math.isnan(ground):
        return None
    h = float(np.nanmax(top)) - ground
    return float(np.clip(h, 4.0, 25.0)) if h > 2.0 else None


def register_pois(osm: OsmData, reg: FeatureRegistry) -> None:
    for f in sorted(osm.pois, key=lambda f: f.osm_id):
        t = f.tags
        if "building" in t and f.geom.geom_type != "Point":
            continue  # represented by its 3D BAG building feature
        if t.get("railway") in ("station", "halt") or t.get("public_transport") == "station":
            kind = "station"
        elif t.get("highway") == "bus_stop" or t.get("public_transport") == "platform":
            kind = "stop"
        else:
            kind = "poi"
        keep = {k: v for k, v in t.items() if k in ("amenity", "tourism", "historic", "shop", "wikidata",
                                                       "website", "ref", "ref:IFOPT", "operator")}
        addr = f"{t['addr:street']} {t['addr:housenumber']}" if "addr:street" in t and "addr:housenumber" in t else None
        reg.add(kind, f.geom, name=f.name, osm_id=f.osm_id, address=addr, tags=keep)


__all__ = ["island_paving", "prepare_water", "prepare_roads", "prepare_landuse", "prepare_trees", "register_pois",
           "parse_width"]
