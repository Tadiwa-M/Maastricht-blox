"""Bridge decks from the BGT (accuracy A2).

``overbruggingsdeel`` polygons (level 1 and up) are bridge decks. Touching parts form one
bridge. Its deck runs along the long axis of the bridge's minimum rotated rectangle, at road
height: the ground just beyond each end (AHN), raised to ``bridge_clearance_m`` above any water
it spans (the same rule as the OSM decks). The road parts on the bridge (``wegdeel`` etc. at
level 1+) paint the deck's surface; the deck itself is stone in the old centre, concrete grey
elsewhere. Over water a pier crosses the deck every ``PIER_SPACING_M``; railings are placed
along the deck edges at voxelise time (``railings.py``).
"""

from __future__ import annotations

import math

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import geo
from ..sources.model import BgtData, BgtFeature, HeightGrid
from . import palette
from .grid import TILE
from .prepare_bgt import GROUND_LAYERS, _touching, classify
from .prepare_osm import in_centre
from .world import Deck, SurfacePatch, VoxelConfig, WaterBody

P_DECK = 45.0  # above every ground class; the road parts on the deck add their class offset
END_PROBE_M = 3.0  # ground height is read this far beyond each end of the deck
PIER_SPACING_M = 30.0
PIER_M = 2.0  # pier thickness along the deck
ISLAND_ZONE_M = 15.0  # land this far around a bridge that water encloses is a mapped pier


def bridge_groups(bgt: BgtData) -> list[BaseGeometry]:
    """One geometry per bridge: touching ``overbruggingsdeel`` parts at level 1 and up."""
    parts = [f for f in bgt.layer("overbruggingsdeel")
             if f.level >= 1 and f.geom.geom_type in ("Polygon", "MultiPolygon") and f.geom.area > 1.0]
    return [unary_union([f.geom for f in g]) for g in _touching(parts)]


def deck_axis(geom: BaseGeometry) -> LineString:
    """Centre line along the long side of the minimum rotated rectangle."""
    rect = geom.minimum_rotated_rectangle
    if not isinstance(rect, Polygon):  # a degenerate (line-like) outline
        c = list(rect.coords)
        return LineString([c[0], c[-1]])
    p = np.asarray(rect.exterior.coords)[:4]
    e0, e1 = np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[1])
    if e0 < e1:  # edges 0-1 and 2-3 are the short ends
        a, b = (p[0] + p[1]) / 2, (p[2] + p[3]) / 2
    else:
        a, b = (p[1] + p[2]) / 2, (p[3] + p[0]) / 2
    if (a[0], a[1]) > (b[0], b[1]):  # deterministic direction
        a, b = b, a
    return LineString([tuple(a), tuple(b)])


def _ground_near(x: float, y: float, dtm: HeightGrid, water: BaseGeometry | None) -> float:
    """Median DTM height within 1.5 m of (x, y); NaN when the spot is water or unknown."""
    if water is not None and water.contains(shapely.points(x, y)):
        return float("nan")
    I, J = geo.rd_to_grid(x, y)
    win = dtm.window(geo.CellBox(I - 3, J - 3, I + 4, J + 4))
    vals = win[~np.isnan(win)]
    return float(np.median(vals)) if len(vals) else float("nan")


def bridge_deck(geom: BaseGeometry, dtm: HeightGrid, water: list[WaterBody], cfg: VoxelConfig,
                body: int) -> Deck:
    axis = deck_axis(geom)
    (x0, y0), (x1, y1) = axis.coords[0], axis.coords[-1]
    L = axis.length or 1.0
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    wet = unary_union([w.geom for w in water]) if water else None
    z0 = _ground_near(x0 - ux * END_PROBE_M, y0 - uy * END_PROBE_M, dtm, wet)
    z1 = _ground_near(x1 + ux * END_PROBE_M, y1 + uy * END_PROBE_M, dtm, wet)
    if math.isnan(z0) and math.isnan(z1):  # both ends over water: a jetty; keep it level
        z0 = z1 = float(np.nanmedian(dtm.window(geo.rd_box_to_cells(geo.RDBox(*geom.bounds)))))
    elif math.isnan(z0) or math.isnan(z1):
        z0 = z1 = z1 if math.isnan(z0) else z0
    under = [w.level_m for w in water if w.geom.intersects(geom)]
    if under:
        floor = max(under) + cfg.bridge_clearance_m
        z0, z1 = max(z0, floor), max(z1, floor)
    piers = _piers(geom, axis, wet) if wet is not None and under else None
    return Deck(axis, z0, z1, body, piers)


def _piers(geom: BaseGeometry, axis: LineString, wet: BaseGeometry) -> BaseGeometry | None:
    """Where the deck rests on piers. Mapped piers come first: land under the deck that water
    surrounds (the Servaasbrug's pier islands); they rise to the deck. A bridge without any gets
    slabs across the deck every ``PIER_SPACING_M``, kept where they stand in water."""
    islands = _pier_islands(geom, wet)
    if islands is not None:
        return islands
    (x0, y0), (x1, y1) = axis.coords[0], axis.coords[-1]
    L = axis.length
    if L < PIER_SPACING_M:
        return None
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    span = L / math.ceil(L / PIER_SPACING_M)  # spans of at most PIER_SPACING_M
    reach = max(geom.bounds[2] - geom.bounds[0], geom.bounds[3] - geom.bounds[1])
    slabs = []
    s = span
    while s < L - span / 2:
        cx, cy = x0 + ux * s, y0 + uy * s
        h = PIER_M / 2
        slabs.append(Polygon([
            (cx - ux * h - uy * reach, cy - uy * h + ux * reach), (cx + ux * h - uy * reach, cy + uy * h + ux * reach),
            (cx + ux * h + uy * reach, cy + uy * h - ux * reach), (cx - ux * h + uy * reach, cy - uy * h - ux * reach),
        ]))
        s += span
    if not slabs:
        return None
    piers = unary_union(slabs).intersection(geom).intersection(wet)
    return None if piers.is_empty else piers


def _pier_islands(geom: BaseGeometry, wet: BaseGeometry) -> BaseGeometry | None:
    """Land under the deck that is an island in the water around the bridge (not joined to a
    bank within ``ISLAND_ZONE_M``)."""
    zone = geom.buffer(ISLAND_ZONE_M)
    land = zone.difference(wet)
    edge = zone.boundary
    found = [g for g in getattr(land, "geoms", [land])
             if g.area > 1.0 and g.intersects(geom) and g.distance(edge) > 0.5]
    if not found:
        return None
    piers = unary_union(found).intersection(geom)
    return None if piers.is_empty else piers


def prepare_bgt_bridges(bgt: BgtData, dtm: HeightGrid, water: list[WaterBody], cfg: VoxelConfig,
                        named: list[tuple[BaseGeometry, int]] = ()) -> list[SurfacePatch]:
    """Deck patches for every BGT bridge, plus the BGT road parts on it painted onto the same
    deck. ``named``: (geometry, feature id) of OSM bridge ways; a deck takes the id of the one
    it overlaps most (Sint Servaasbrug), so picking the bridge names it."""
    out: list[SurfacePatch] = []
    on_bridges = [f for f in bgt.layer(*GROUND_LAYERS) if f.level >= 1
                  and f.geom.geom_type in ("Polygon", "MultiPolygon")]
    for geom in bridge_groups(bgt):
        centre = in_centre(geom)
        body = palette.idx("limestone" if centre else "light_grey")
        deck = bridge_deck(geom, dtm, water, cfg, body)
        fid = _feature(geom, named)
        out.append(SurfacePatch(geom, palette.idx("pavement"), TILE, P_DECK, fid, deck))
        for f in on_bridges:
            if not f.geom.intersects(geom) or f.geom.intersection(geom).area < 0.5 * f.geom.area:
                continue
            c = classify(_at_ground(f), centre)
            if c is None:
                continue
            part = f.geom.intersection(geom)
            out.append(SurfacePatch(part, palette.idx(c.colour), TILE, P_DECK + (c.priority - 39.0) / 10, fid, deck))
    return out


def _at_ground(f: BgtFeature) -> BgtFeature:
    return BgtFeature(f.layer, f.lid, {**f.props, "relatieve_hoogteligging": 0}, f.geom)


def _feature(geom: BaseGeometry, named: list[tuple[BaseGeometry, int]]) -> int:
    best, best_len = 0, 0.0
    for g, fid in named:
        if fid and g.intersects(geom):
            a = g.intersection(geom)
            size = a.area if a.area > 0 else a.length
            if size > best_len:
                best, best_len = fid, size
    return best


__all__ = ["bridge_deck", "bridge_groups", "deck_axis", "prepare_bgt_bridges", "P_DECK"]
