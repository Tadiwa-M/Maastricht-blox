"""3D BAG buildings -> :class:`PreparedBuilding` (roof planes, colours, feature ids)."""

from __future__ import annotations

import math

from shapely import STRtree
from shapely.geometry import Point, Polygon
from shapely.geometry.base import BaseGeometry

from ..sources.bag3d import footprint
from ..sources.cityjson import newell_normal
from ..sources.model import Building, OsmData, OsmFeature
from . import colours, palette
from .features import FeatureRegistry
from .landmarks import LANDMARKS, Landmark
from .raster import stable_hash
from .world import Accent, PreparedBuilding, RoofPlane


def roof_planes(b: Building) -> list[RoofPlane]:
    planes = []
    for s in b.surfaces:
        if s.kind != "roof" or len(s.exterior) < 3:
            continue
        n = newell_normal(s.exterior)
        if n[2] < 0:
            n = -n  # orientation of the source ring does not matter for a roof
        if n[2] < 0.05:
            continue  # vertical: contributes no top surface
        poly = Polygon(s.exterior[:, :2], [h[:, :2] for h in s.holes if len(h) >= 3])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.area < 1e-4:
            continue
        o = s.exterior.mean(axis=0)
        planes.append(RoofPlane(poly=poly, normal=(float(n[0]), float(n[1]), float(n[2])),
                                origin=(float(o[0]), float(o[1]), float(o[2])),
                                eave_z=float(s.exterior[:, 2].min())))
    return planes


class _OsmIndex:
    """Named OSM objects (buildings/POIs) and address points for footprint matching."""

    def __init__(self, osm: OsmData) -> None:
        self.named = [f for f in osm.buildings + osm.pois if f.name and f.geom.geom_type != "Point"]
        self.named_tree = STRtree([f.geom for f in self.named])
        self.addr = osm.addresses
        self.addr_tree = STRtree([f.geom.representative_point() for f in self.addr])
        self.osm_buildings = osm.buildings
        self.bld_tree = STRtree([f.geom for f in self.osm_buildings])

    def overlapping_named(self, fp: BaseGeometry, min_frac: float = 0.3) -> list[OsmFeature]:
        out = []
        for i in self.named_tree.query(fp):
            f = self.named[i]
            inter = f.geom.intersection(fp).area
            if inter >= min_frac * min(fp.area, f.geom.area):
                out.append(f)
        return out

    def best_osm_building(self, fp: BaseGeometry) -> OsmFeature | None:
        best, best_a = None, 0.0
        for i in self.bld_tree.query(fp):
            a = self.osm_buildings[i].geom.intersection(fp).area
            if a > best_a:
                best, best_a = self.osm_buildings[i], a
        return best if best is not None and best_a >= 0.3 * fp.area else None

    def address(self, fp: BaseGeometry) -> str | None:
        for i in sorted(self.addr_tree.query(fp)):
            f = self.addr[i]
            if fp.contains(f.geom.representative_point()):
                street, num = f.tags.get("addr:street"), f.tags.get("addr:housenumber")
                if street and num:
                    return f"{street} {num}"
        return None


def match_landmark(fp: BaseGeometry, named: list[OsmFeature]) -> Landmark | None:
    names = [f.name or "" for f in named]
    for lm in LANDMARKS:
        if any(n.lower() in name.lower() for n in lm.names for name in names):
            return lm
    for lm in LANDMARKS:
        if lm.point is not None and fp.contains(Point(lm.point)):
            return lm
    return None


def _is_church(osm_bld: OsmFeature | None) -> bool:
    if osm_bld is None:
        return False
    t = osm_bld.tags
    return t.get("building") in ("church", "cathedral", "chapel") or t.get("amenity") == "place_of_worship"


def prepare_buildings(buildings: list[Building], osm: OsmData, registry: FeatureRegistry) -> list[PreparedBuilding]:
    """Register one feature per building (sorted by BAG id for stable ids)."""
    idx = _OsmIndex(osm)
    out: list[PreparedBuilding] = []
    for b in sorted(buildings, key=lambda x: x.bag_id):
        fp = footprint(b)
        planes = roof_planes(b)
        if fp is None or not planes:
            continue
        named = idx.overlapping_named(fp)
        lm = match_landmark(fp, named)
        osm_b = idx.best_osm_building(fp)
        name = lm.display_name if lm else (osm_b.name if osm_b and osm_b.name else None)
        top, ground = b.roof_max_z, b.ground_z
        height = (top - ground) if top is not None and ground is not None else None
        fid = registry.add(
            "landmark" if lm else "building", fp, key=b.bag_id,
            name=name, bag_id=b.bag_id, osm_id=osm_b.osm_id if osm_b else None,
            address=idx.address(fp), year=b.year, height_m=height,
            tags=_wikidata(osm_b),
        )
        out.append(_prepared(b, fp, planes, fid, lm, _is_church(osm_b)))
    return out


def _wikidata(osm_b: OsmFeature | None) -> dict[str, str]:
    if osm_b is not None and "wikidata" in osm_b.tags:
        return {"wikidata": osm_b.tags["wikidata"]}
    return {}


def _prepared(b: Building, fp: BaseGeometry, planes: list[RoofPlane], fid: int,
              lm: Landmark | None, church: bool) -> PreparedBuilding:
    year = b.year
    wall = lm.wall if lm else colours.wall_colour(b.bag_id, year)
    roof_p = lm.roof if lm else colours.roof_colour(b.bag_id, year, pitched=True)
    roof_f = lm.roof if lm else colours.roof_colour(b.bag_id, year, pitched=False)
    no_windows = (lm is not None and not lm.windows) or church
    accent = None
    if lm is not None and lm.accent is not None:
        a = lm.accent
        accent = Accent(a.centre, a.radius_m, palette.idx(a.wall), palette.idx(a.roof))
    return PreparedBuilding(
        feature_id=fid, bag_id=b.bag_id, footprint=fp, roofs=planes,
        wall=palette.idx(wall), roof_pitched=palette.idx(roof_p), roof_flat=palette.idx(roof_f),
        window_period=0 if no_windows else colours.window_period(b.bag_id),
        window_offset=stable_hash(b.bag_id) % 3, accent=accent,
    )


def roof_pitch_ok(plane: RoofPlane, flat_deg: float, steep_deg: float) -> bool:
    return flat_deg <= plane.pitch_deg <= steep_deg and not math.isnan(plane.pitch_deg)


__all__ = ["prepare_buildings", "roof_planes", "match_landmark", "roof_pitch_ok"]
