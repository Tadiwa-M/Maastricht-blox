"""Fallback buildings from OSM footprints + AHN heights, for areas 3D BAG does not cover.

3D BAG is the primary source (real roof planes). When it is unreachable, or a block was never
fetched, every OSM building footprint that no 3D BAG building covers becomes a synthetic
:class:`Building`: ground from the DTM, roof from the DSM. A footprint whose DSM spread is
large gets a gable along its long axis (ridge at the high DSM percentile, eaves at the low
one); otherwise a flat roof. Coarser than 3D BAG, but the city keeps its houses.
"""

from __future__ import annotations

import logging

import numpy as np
from shapely import STRtree, contains_xy
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from .. import geo
from .bag3d import footprint
from .model import Building, HeightGrid, OsmData, Surface

log = logging.getLogger(__name__)

COVERED_FRAC = 0.3  # a 3D BAG footprint covering this share of the OSM one wins
MIN_AREA_M2 = 12.0  # sheds and kiosks below this are skipped
GABLE_MIN_RISE_M = 1.5  # ridge minus eaves below this: flat roof
MAX_GABLE_WIDTH_M = 18.0  # wider footprints are flat (halls, blocks)


def fallback_buildings(osm: OsmData, existing: list[Building], dtm: HeightGrid,
                       dsm: HeightGrid | None) -> list[Building]:
    """Synthetic buildings for OSM footprints that no ``existing`` building covers."""
    if dsm is None:
        return []
    fps = [fp for fp in (footprint(b) for b in existing) if fp is not None]
    tree = STRtree(fps)
    out: list[Building] = []
    for f in sorted(osm.buildings, key=lambda f: f.osm_id):
        for poly in _polygons(f.geom):
            if poly.area < MIN_AREA_M2:
                continue
            covered = sum(fps[i].intersection(poly).area for i in tree.query(poly))
            if covered >= COVERED_FRAC * poly.area:
                continue
            b = synth_building(f"osm-{f.osm_id}", poly, dtm, dsm, f.tags)
            if b is not None:
                out.append(b)
    if out:
        log.info("OSM fallback: %d buildings from OSM footprints + AHN heights", len(out))
    return out


def _polygons(g: BaseGeometry) -> list[Polygon]:
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return []


def _samples(poly: Polygon, grid: HeightGrid) -> np.ndarray:
    """Grid values at cell centres inside ``poly`` (NaNs dropped)."""
    box = geo.rd_box_to_cells(geo.RDBox(*poly.bounds))
    vals = grid.window(box)
    xs, ys = geo.cell_centres_rd(box.i0, box.j0, box.ni, box.nj)
    inside = contains_xy(poly, xs, ys)
    v = vals[inside]
    return v[~np.isnan(v)]


def synth_building(bid: str, poly: Polygon, dtm: HeightGrid, dsm: HeightGrid,
                   tags: dict[str, str] | None = None) -> Building | None:
    ground_s, top_s = _samples(poly, dtm), _samples(poly, dsm)
    if len(ground_s) == 0 or len(top_s) < 4:
        return None
    ground = float(np.median(ground_s))
    ridge = float(np.percentile(top_s, 90))
    eave = float(np.percentile(top_s, 25))
    levels = (tags or {}).get("building:levels", "")
    if ridge - ground < 2.5:
        ridge = ground + (3.0 * float(levels) if levels.replace(".", "", 1).isdigit() else 6.0)
        eave = ridge
    eave = max(eave, ground + 2.5)
    roofs = _gable(poly, eave, ridge) if ridge - eave >= GABLE_MIN_RISE_M else None
    if roofs is None:
        roofs = [Surface("roof", _ring3(poly.exterior.coords, lambda x, y: ridge))]
    ground_srf = Surface("ground", _ring3(poly.exterior.coords, lambda x, y: ground))
    attrs = {"b3_h_maaiveld": ground, "b3_h_dak_max": ridge, "source": "osm+ahn"}
    return Building(bag_id=bid, attributes=attrs, lod="osm", surfaces=roofs + [ground_srf])


def _gable(poly: Polygon, eave: float, ridge: float) -> list[Surface] | None:
    """Two roof planes meeting on the long axis of the minimum rotated rectangle."""
    rect = poly.minimum_rotated_rectangle
    c = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = c[1] - c[0], c[2] - c[1]
    long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
    width = float(np.linalg.norm(short))
    if width < 3.0 or width > MAX_GABLE_WIDTH_M:
        return None
    centre = c.mean(axis=0)
    n = short / width  # unit vector across the ridge
    half = width / 2.0
    pad = float(np.linalg.norm(long_)) + width
    ridge_line = LineString([centre - long_ / np.linalg.norm(long_) * pad,
                             centre + long_ / np.linalg.norm(long_) * pad])
    out = []
    for side in (1.0, -1.0):
        a = np.asarray(ridge_line.coords)
        b = a + side * n * (half + 1.0)
        halfplane = Polygon([a[0], a[1], b[1], b[0]])
        part = poly.intersection(halfplane)
        for p in _polygons(part):
            if p.area < 1.0:
                continue

            def z(x: float, y: float) -> float:
                d = abs(float(np.dot(np.array([x, y]) - centre, n)))
                return ridge - (ridge - eave) * min(d / half, 1.0)

            out.append(Surface("roof", _ring3(p.exterior.coords, z)))
    return out or None


def _ring3(coords, z) -> np.ndarray:
    pts = [(float(x), float(y)) for x, y, *_ in coords]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return np.array([(x, y, z(x, y)) for x, y in pts], dtype=np.float64)


__all__ = ["fallback_buildings", "synth_building"]
