"""OSM -> what drives, rides and sits in the streets (``life/streets.json``).

* ``cycle``: the graph cyclists ride (cycleways, cycle lanes/tracks on roads, quiet streets,
  pedestrian streets with ``bicycle=yes``); same layout as the walk graph, centrelines (the
  viewer keeps riders to the right).
* ``roads``: the directed graph cars drive: ``nodes``, ``edges`` (a, b pairs), ``flags`` per
  edge (bit 0 = one-way a -> b; bits 1-3 = road class index into ``classes``). No pedestrian
  streets, footways, cycleways, paths, steps, tracks, bus-only ways or parking aisles.
* ``pois``: cafes, bars and restaurants (terraces): position + unit vector to the nearest
  street (``f``), so tables go on the pavement in front.
* ``bikes``: spots for parked-bike clusters (stations, squares, busy shopping blocks):
  position + street direction.
* ``market``: the market square polygon (``amenity=marketplace`` or the square named Markt)
  and its schedule (Maastricht: Wednesday and Friday 08:00-13:00).
"""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import nearest_points

from .. import geo
from ..geo import RDBox
from ..sources.model import OsmData
from .polyline import densify
from .walkways import Graph, _lines, _snap_dead_ends, _to_doc, is_walk_area

ROAD_CLASSES = ["primary", "secondary", "tertiary", "residential", "unclassified", "service", "living_street"]
DRIVE = {"motorway": "primary", "trunk": "primary", "primary": "primary", "secondary": "secondary", "tertiary": "tertiary",
         "motorway_link": "primary", "trunk_link": "primary", "primary_link": "primary", "secondary_link": "secondary",
         "tertiary_link": "tertiary", "residential": "residential", "unclassified": "unclassified", "service": "service",
         "living_street": "living_street"}
ROAD_STEP_M = 20.0
CYCLE_WEIGHT = {"cycleway": 3.0, "lane": 2.5, "road": 1.5, "quiet": 1.0, "pedestrian": 0.8}
TERRACE_AMENITIES = {"cafe", "bar", "pub", "restaurant", "fast_food", "ice_cream", "biergarten"}
SHOP_CELL_M = 60.0
MARKET = {"names": ("Markt",), "days": [2, 4], "open": 8 * 3600, "close": 13 * 3600}  # Mon = 0


def cycle_kind(tags: dict[str, str]) -> str | None:
    """How cyclists use a way, or None."""
    hw = tags.get("highway", "")
    if tags.get("bicycle") in ("no", "dismount") or tags.get("access") in ("private", "no"):
        return None
    if hw == "cycleway" or (hw == "path" and tags.get("bicycle") in ("yes", "designated")):
        return "cycleway"
    if hw in ("pedestrian", "footway") and tags.get("bicycle") in ("yes", "designated"):
        return "pedestrian"
    if hw in ("primary", "secondary", "tertiary", "residential", "unclassified"):
        if any(tags.get(k, "") in ("lane", "track", "shared_lane") for k in ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right")):
            return "lane"
        return "road" if hw != "residential" else "quiet"
    if hw in ("living_street", "service") and tags.get("service") not in ("parking_aisle", "driveway"):
        return "quiet"
    return None


def drive_class(tags: dict[str, str]) -> str | None:
    """Road class cars use, or None (no cars: pedestrian streets, paths, private, parking aisles)."""
    cls = DRIVE.get(tags.get("highway", ""))
    if cls is None or tags.get("motor_vehicle") in ("no", "private") or tags.get("access") in ("private", "no"):
        return None
    if cls == "service" and tags.get("service") in ("parking_aisle", "driveway", "drive-through", "alley"):
        return None
    if tags.get("area") == "yes":
        return None
    return cls


def oneway(tags: dict[str, str]) -> int:
    """+1 = one-way along the way, -1 = against it, 0 = both directions."""
    v = tags.get("oneway", "")
    if v in ("yes", "1", "true") or tags.get("junction") == "roundabout":
        return 1
    return -1 if v == "-1" else 0


def build_cycle(osm: OsmData, box: RDBox) -> dict:
    g = Graph()
    clip = shapely.box(*box.as_tuple())
    for f in osm.roads:
        kind = cycle_kind(f.tags)
        if kind:
            for line in _lines(f.geom.intersection(clip)):
                g.add_line(np.asarray(line.coords)[:, :2], CYCLE_WEIGHT[kind])
    snapped = _snap_dead_ends(g) if g.xy else 0
    doc = _to_doc(g, np.asarray(g.weight, float), 3, {"snapped": snapped})
    doc["kind"] = "cycle"
    return doc


def build_roads(osm: OsmData, box: RDBox) -> dict:
    clip = shapely.box(*box.as_tuple())
    xy: list[tuple[float, float]] = []
    index: dict[tuple[int, int], int] = {}
    edges: dict[tuple[int, int], int] = {}

    def node(x: float, y: float) -> int:
        k = (round(x * 10), round(y * 10))
        if k not in index:
            index[k] = len(xy)
            xy.append((x, y))
        return index[k]

    for f in osm.roads:
        cls = drive_class(f.tags)
        if cls is None:
            continue
        ow = oneway(f.tags)
        for line in _lines(f.geom.intersection(clip)):
            pts = densify(np.asarray(line.coords)[:, :2], ROAD_STEP_M)
            if ow < 0:
                pts = pts[::-1]
            ids = [node(float(x), float(y)) for x, y in pts]
            for a, b in zip(ids, ids[1:]):
                if a == b:
                    continue
                flag = (1 if ow else 0) | (ROAD_CLASSES.index(cls) << 1)
                if (b, a) in edges:  # same street drawn twice / both directions: keep two-way
                    edges[(b, a)] &= ~1
                    continue
                edges[(a, b)] = flag
    nodes: list[float] = []
    for x, y in xy:
        nodes += [round(x - geo.X0, 1), round(y - geo.Y0, 1)]
    flat: list[int] = []
    flags: list[int] = []
    for (a, b), fl in edges.items():
        flat += [a, b]
        flags.append(fl)
    return {"nodes": nodes, "edges": flat, "flags": flags, "classes": ROAD_CLASSES}


def _street_lines(osm: OsmData, clip: Polygon) -> list[LineString]:
    out = []
    for f in osm.roads:
        if f.tags.get("highway") in DRIVE or f.tags.get("highway") in ("pedestrian", "living_street", "footway"):
            out += _lines(f.geom.intersection(clip))
    return out


def _nearest(lines: list[LineString], tree: shapely.STRtree | None, p: Point, maxd: float) -> tuple[float, float, float, float] | None:
    """(qx, qy, dirx, diry) of the nearest street point within maxd and the street direction there."""
    if tree is None:
        return None
    k = tree.query_nearest(p, max_distance=maxd)
    if len(k) == 0:
        return None
    line = lines[int(k[0])]
    q = nearest_points(line, p)[0]
    s = line.project(q)
    a, b = line.interpolate(max(0.0, s - 1.0)), line.interpolate(min(line.length, s + 1.0))
    L = math.hypot(b.x - a.x, b.y - a.y) or 1.0
    return q.x, q.y, (b.x - a.x) / L, (b.y - a.y) / L


def build_pois(osm: OsmData, box: RDBox) -> tuple[list[dict], list[list[float]]]:
    clip = shapely.box(*box.as_tuple())
    lines = _street_lines(osm, clip)
    tree = shapely.STRtree(lines) if lines else None
    pois: list[dict] = []
    shops: list[tuple[float, float]] = []
    spots: list[list[float]] = []
    for f in osm.pois:
        c = f.geom.centroid if f.geom.geom_type != "Point" else f.geom
        if not clip.contains(c):
            continue
        am = f.tags.get("amenity", "")
        if am in TERRACE_AMENITIES:
            near = _nearest(lines, tree, c, 40.0)
            if near is None:
                continue
            qx, qy = near[0], near[1]
            d = math.hypot(qx - c.x, qy - c.y) or 1.0
            pois.append({"kind": am, "name": f.tags.get("name", ""), "x": round(c.x - geo.X0, 1), "z": round(c.y - geo.Y0, 1),
                         "f": [round((qx - c.x) / d, 3), round((qy - c.y) / d, 3)], "d": round(d, 1)})
        if "shop" in f.tags:
            shops.append((c.x, c.y))
        if f.tags.get("railway") in ("station", "halt") or f.tags.get("amenity") == "bicycle_parking":
            spots.append([c.x, c.y])
    cells: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for x, y in shops:
        cells[(math.floor(x / SHOP_CELL_M), math.floor(y / SHOP_CELL_M))].append((x, y))
    for pts in cells.values():
        if len(pts) >= 3:
            spots.append([sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)])
    for f in osm.road_areas:
        if f.tags.get("place") == "square" or f.tags.get("amenity") == "marketplace":
            g = f.geom.intersection(clip)
            if not g.is_empty:
                spots.append([g.representative_point().x, g.representative_point().y])
    bikes: list[list[float]] = []
    for x, y in spots:  # move each spot to the kerb of the nearest street, along it
        near = _nearest(lines, tree, Point(x, y), 60.0)
        if near is None:
            continue
        qx, qy, dx, dy = near
        side = 1.0 if (x - qx) * dy - (y - qy) * dx >= 0 else -1.0  # same side of the street as the spot
        bx, by = qx + dy * side * 4.0, qy - dx * side * 4.0
        bikes.append([round(bx - geo.X0, 1), round(by - geo.Y0, 1), round(dx, 3), round(dy, 3)])
    return pois, bikes


def build_market(osm: OsmData, box: RDBox) -> dict | None:
    clip = shapely.box(*box.as_tuple())
    best = None
    for f in list(osm.road_areas) + list(osm.pois):
        t = f.tags
        if not (t.get("amenity") == "marketplace" or ((t.get("place") == "square" or is_walk_area(t)) and t.get("name") in MARKET["names"])):
            continue
        g = f.geom.intersection(clip)
        polys = [g] if isinstance(g, Polygon) else [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]
        for p in polys:
            if p.area > 100 and (best is None or p.area > best[1].area):
                best = (t.get("name", "market"), p)
    if best is None:
        return None
    name, poly = best
    poly = poly.simplify(0.5)
    pts: list[float] = []
    for x, y in list(poly.exterior.coords)[:-1]:
        pts += [round(x - geo.X0, 1), round(y - geo.Y0, 1)]
    return {"name": name, "poly": pts, "days": MARKET["days"], "open": MARKET["open"], "close": MARKET["close"]}


def build_streets(osm: OsmData, box: RDBox) -> dict:
    """The ``streets.json`` document."""
    pois, bikes = build_pois(osm, box)
    return {"version": 1, "kind": "streets", "meta": {"units": "m"},
            "cycle": build_cycle(osm, box), "roads": build_roads(osm, box),
            "pois": pois, "bikes": bikes, "market": build_market(osm, box)}
