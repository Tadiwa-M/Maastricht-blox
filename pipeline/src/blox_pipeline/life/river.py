"""The Maas centreline the cruise boats follow (``life/river.json``).

From OSM ``waterway=river`` ways named Maas/Meuse (merged, clipped to the slice, the longest
piece kept). Without OSM data a hand-set approximate line is used (``FALLBACK_RD``).
"""

from __future__ import annotations

import shapely
from shapely.geometry import LineString

from .. import geo
from ..geo import RDBox
from ..sources.model import OsmData
from .polyline import densify
from .walkways import _lines

# Approximate Maas centreline through the slice, south -> north (RD metres). Only used when
# the OSM clip has no river way; check it against the map before relying on it.
FALLBACK_RD = [(176420.0, 316500.0), (176560.0, 317000.0), (176690.0, 317450.0), (176760.0, 317790.0),
               (176840.0, 318200.0), (176920.0, 318548.0)]
DEFAULT_WIDTH_M = 100.0


def river_line(osm: OsmData | None, box: RDBox) -> tuple[LineString, str]:
    clip = shapely.box(*box.as_tuple())
    if osm is not None:
        ways = [f.geom for f in osm.waterways
                if f.tags.get("waterway") == "river" and any(n in (f.tags.get("name") or "") for n in ("Maas", "Meuse"))]
        if ways:
            merged = shapely.line_merge(shapely.union_all(ways))
            parts = _lines(merged.intersection(clip))
            if parts:
                return max(parts, key=lambda p: p.length), "osm"
    parts = _lines(LineString(FALLBACK_RD).intersection(clip))
    return (max(parts, key=lambda p: p.length) if parts else LineString(FALLBACK_RD)), "fallback"


def river_width(osm: OsmData | None, line: LineString) -> float:
    """Twice the distance from the line's midpoint to the water polygon's edge."""
    if osm is None:
        return DEFAULT_WIDTH_M
    mid = line.interpolate(0.5, normalized=True)
    for f in osm.water:
        if f.geom.contains(mid):
            return round(2 * f.geom.exterior.distance(mid) if hasattr(f.geom, "exterior")
                         else 2 * f.geom.boundary.distance(mid), 1)
    return DEFAULT_WIDTH_M


def build_river(osm: OsmData | None, box: RDBox) -> dict:
    line, source = river_line(osm, box)
    pts = densify(list(line.coords), 20.0)
    path: list[float] = []
    for x, y in pts[:, :2]:
        path += [round(float(x) - geo.X0, 1), round(float(y) - geo.Y0, 1)]
    return {"version": 1, "kind": "river", "meta": {"source": source, "name": "Maas"},
            "widthM": river_width(osm, line), "path": path}
