"""Bus shelters (accuracy A3): every OSM stop tagged ``shelter=yes``.

A shelter is a small canopy (``canopies.Canopy``): a ``LENGTH_M`` x ``DEPTH_M`` roof at
``HEIGHT_M`` above the ground, a glass back wall away from the road and two metal posts at the
front corners. It stands on the pavement beside the nearest carriageway (BGT when cached, else
OSM road buffers), long side along the road (snapped to the grid axes), its front edge
``KERB_GAP_M`` off the carriageway. A stop mapped twice (bus_stop + platform node) gets one
shelter; a spot that would touch a building, water or another roof is skipped.
"""

from __future__ import annotations

import logging
import math

import numpy as np
from shapely import STRtree
from shapely.geometry import MultiPoint, Point, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points, unary_union

from ..sources.model import HeightGrid, OsmData
from . import palette
from .canopies import Canopy
from .raster import cover

log = logging.getLogger(__name__)

LENGTH_M, DEPTH_M, HEIGHT_M = 4.0, 1.5, 2.6
KERB_GAP_M = 0.75
ROAD_SEARCH_M = 15.0
SAME_STOP_M = 6.0
ROOF, WALL, POST = "dark_grey", "glass_light", "metal"


def wants_shelter(tags: dict[str, str]) -> bool:
    stop = tags.get("highway") == "bus_stop" or tags.get("public_transport") == "platform"
    return stop and tags.get("shelter") == "yes"


def shelter_outline(p: Point, roads: BaseGeometry | None) -> tuple[BaseGeometry, BaseGeometry, BaseGeometry]:
    """(roof, back wall, front post points) for a stop at ``p``; ``roads``: carriageways near it."""
    nx, ny = 0.0, 1.0  # outward from the road (snapped to an axis); default: road to the south
    if roads is not None and not roads.is_empty and roads.distance(p) <= ROAD_SEARCH_M:
        inside = roads.contains(p)
        q = nearest_points(roads.boundary if inside else roads, p)[0]
        dx, dy = (q.x - p.x, q.y - p.y) if inside else (p.x - q.x, p.y - q.y)  # away from the road
        if math.hypot(dx, dy) > 1e-6:
            nx, ny = (math.copysign(1.0, dx), 0.0) if abs(dx) >= abs(dy) else (0.0, math.copysign(1.0, dy))
        if inside:  # the stop node sits on the carriageway: step out of it at its nearest edge
            shift = _exit(p, roads, nx, ny) + KERB_GAP_M
        else:
            shift = max(0.0, KERB_GAP_M - abs(dx * nx + dy * ny))
        p = Point(p.x + nx * shift, p.y + ny * shift)
    h = LENGTH_M / 2
    if nx:  # road to the west or east: the shelter runs north-south
        x0, x1 = sorted((p.x, p.x + nx * DEPTH_M))
        roof = box(x0, p.y - h, x1, p.y + h)
        wall = box(x1 - 0.5, p.y - h, x1, p.y + h) if nx > 0 else box(x0, p.y - h, x0 + 0.5, p.y + h)
        fx = p.x + nx * 0.25
        posts = MultiPoint([(fx, p.y - h + 0.25), (fx, p.y + h - 0.25)])
    else:
        y0, y1 = sorted((p.y, p.y + ny * DEPTH_M))
        roof = box(p.x - h, y0, p.x + h, y1)
        wall = box(p.x - h, y1 - 0.5, p.x + h, y1) if ny > 0 else box(p.x - h, y0, p.x + h, y0 + 0.5)
        fy = p.y + ny * 0.25
        posts = MultiPoint([(p.x - h + 0.25, fy), (p.x + h - 0.25, fy)])
    return roof, wall, posts


def _exit(p: Point, roads: BaseGeometry, nx: float, ny: float) -> float:
    for s in np.arange(0.5, ROAD_SEARCH_M, 0.5):
        if not roads.contains(Point(p.x + nx * s, p.y + ny * s)):
            return float(s)
    return 0.0


def plan_shelters(osm: OsmData, dtm: HeightGrid, road_parts: list[BaseGeometry],
                  blocked: list[BaseGeometry]) -> list[Canopy]:
    """``road_parts``: carriageway polygons; ``blocked``: footprints a shelter must not touch."""
    roof_c, wall_c, post_c = palette.idx(ROOF), palette.idx(WALL), palette.idx(POST)
    tree = STRtree(blocked) if blocked else None
    parts = [g for r in road_parts for g in getattr(r, "geoms", [r])]
    rtree = STRtree(parts) if parts else None
    out: list[Canopy] = []
    done: list[Point] = []
    skipped = 0
    for f in sorted(osm.pois, key=lambda f: f.osm_id):
        if not isinstance(f.geom, Point) or not wants_shelter(f.tags):
            continue
        if any(f.geom.distance(d) < SAME_STOP_M for d in done):
            continue
        near = [parts[int(k)] for k in rtree.query(f.geom.buffer(ROAD_SEARCH_M))] if rtree is not None else []
        roads = unary_union(near) if near else None
        roof, wall, posts = shelter_outline(f.geom, roads)
        if (tree is not None and len(tree.query(roof, predicate="intersects"))) or \
                (roads is not None and roads.intersects(roof.buffer(-0.05))):
            skipped += 1
            continue
        hit = cover(roof, dtm.box)
        if hit is None:
            continue
        win, mask = hit
        g = dtm.window(win)[mask]
        g = g[~np.isnan(g)]
        if not len(g):
            continue
        done.append(f.geom)
        out.append(Canopy(roof, float(np.median(g)) + HEIGHT_M, roof_c, post_c, posts, wall, wall_c))
    if out or skipped:
        log.info("shelters: %d placed, %d skipped (no room)", len(out), skipped)
    return out


__all__ = ["plan_shelters", "shelter_blocked", "shelter_outline", "shelter_roads", "wants_shelter"]


def shelter_roads(world, osm: OsmData) -> list[BaseGeometry]:
    """Carriageway polygons: the BGT's inside its area, OSM road buffers outside it."""
    from .prepare_osm import CARRIAGEWAY, ROAD_WIDTH_M, parse_width

    out = [world.carriageways] if world.carriageways is not None else []
    ext = world.bgt_extent
    for f in osm.roads:
        hw = f.tags.get("highway", "")
        if hw in CARRIAGEWAY and (ext is None or not ext.contains(f.geom)):
            out.append(f.geom.buffer((parse_width(f.tags) or ROAD_WIDTH_M.get(hw, 4.0)) / 2))
    return out


def shelter_blocked(world) -> list[BaseGeometry]:
    """Buildings (also turned ones), water and roofs already planned."""
    out = [b.footprint for b in world.buildings]
    out += [b.footprint for g in world.islands for b in g.members]
    out += [w.geom for w in world.water]
    out += [c.geom for c in world.canopies]
    return out
