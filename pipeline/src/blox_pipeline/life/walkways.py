"""OSM -> the pedestrian graph walkers wander on (``life/walkways.json``).

Edges come from footways (incl. ``footway=sidewalk`` and crossings), pedestrian streets,
paths, living streets and steps; roads tagged ``sidewalk=both|left|right`` get offset
sidewalk lines; pedestrian areas and squares get a grid of nodes (``AREA_STEP_M``) linked
8-ways inside the polygon. Line ends that stop just short of another way are snapped to it.

Every node carries a **spawn weight**: by way kind (squares and pedestrian streets busiest)
times a boost for shops, cafés and restaurants within ``SHOP_RADIUS_M``.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import shapely
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.geometry.base import BaseGeometry

from .. import geo
from ..geo import RDBox
from ..sources.model import OsmData
from .polyline import densify

STEP_M = 12.0  # max edge length along ways
AREA_STEP_M = 6.0  # node spacing on squares
SNAP_M = 5.0  # dead ends this close to another node are joined to it
SHOP_RADIUS_M = 30.0
KIND_WEIGHT = {"square": 4.0, "pedestrian": 3.0, "living_street": 2.0, "footway": 1.5, "sidewalk": 1.5,
               "steps": 0.8, "path": 0.7, "crossing": 1.0}
WALK_HIGHWAYS = {"footway", "pedestrian", "path", "living_street", "steps"}
WALK_AREAS = {"pedestrian", "footway", "living_street", "path", "steps"}
ROAD_WIDTH_M = {"primary": 8.0, "secondary": 7.0, "tertiary": 6.5, "residential": 5.5, "unclassified": 5.0,
                "service": 4.0, "living_street": 5.0}
SHOP_AMENITIES = {"cafe", "restaurant", "bar", "pub", "fast_food", "ice_cream", "marketplace"}


def _width(tags: dict[str, str], highway: str) -> float:
    m = re.match(r"\s*([0-9.]+)", tags.get("width", ""))
    try:
        return float(m.group(1)) if m else ROAD_WIDTH_M.get(highway, 6.0)
    except ValueError:
        return ROAD_WIDTH_M.get(highway, 6.0)


def way_kind(tags: dict[str, str]) -> str | None:
    """Walk kind of a linear way, or None if people don't walk on it."""
    if tags.get("foot") in ("no", "private") or (tags.get("access") in ("private", "no") and "foot" not in tags):
        return None
    hw = tags.get("highway", "")
    if hw == "footway":
        fw = tags.get("footway")
        return "sidewalk" if fw == "sidewalk" else "crossing" if fw == "crossing" else "footway"
    if hw in WALK_HIGHWAYS:
        return hw
    if tags.get("foot") in ("yes", "designated") and hw in ("cycleway", "track", "service"):
        return "path"
    return None


ASSUMED_SIDEWALKS = {"primary", "secondary", "tertiary", "residential", "unclassified"}
ASSUMED_FACTOR = 0.6  # weight of a sidewalk that is assumed, not tagged


def sidewalk_sides(tags: dict[str, str]) -> list[int]:
    """+1 = left, -1 = right of the way's direction, from ``sidewalk*`` tags. Urban roads
    without any sidewalk tag are assumed to have both (most Dutch streets are untagged);
    ``no``/``none``/``separate`` (drawn as its own footway) give none."""
    if not any(k.startswith("sidewalk") for k in tags):
        return [1, -1] if tags.get("highway") in ASSUMED_SIDEWALKS else []
    v = tags.get("sidewalk", "")
    sides = {"both": [1, -1], "yes": [1, -1], "left": [1], "right": [-1]}.get(v, [])
    for key, s in (("sidewalk:left", 1), ("sidewalk:right", -1)):
        if tags.get(key) == "yes" and s not in sides:
            sides.append(s)
    if tags.get("sidewalk:both") == "yes":
        sides = [1, -1]
    return sides


def is_walk_area(tags: dict[str, str]) -> bool:
    if tags.get("amenity") == "parking" or "building" in tags:
        return False
    return (tags.get("place") == "square" or tags.get("area:highway") in WALK_AREAS
            or (tags.get("highway") in WALK_AREAS and tags.get("area") == "yes"))


def _lines(geom: BaseGeometry) -> list[LineString]:
    if isinstance(geom, LineString):
        return [geom] if not geom.is_empty else []
    if isinstance(geom, MultiLineString):
        return [g for g in geom.geoms if not g.is_empty]
    if hasattr(geom, "geoms"):
        return [g for part in geom.geoms for g in _lines(part)]
    return []


@dataclass
class Graph:
    """Nodes in RD metres while building; ``to_doc`` writes Unity metres."""

    xy: list[tuple[float, float]] = field(default_factory=list)
    weight: list[float] = field(default_factory=list)
    edges: set[tuple[int, int]] = field(default_factory=set)
    index: dict[tuple[int, int], int] = field(default_factory=dict)

    def node(self, x: float, y: float, w: float) -> int:
        key = (round(x * 10), round(y * 10))
        n = self.index.get(key)
        if n is None:
            n = self.index[key] = len(self.xy)
            self.xy.append((x, y))
            self.weight.append(w)
        else:
            self.weight[n] = max(self.weight[n], w)
        return n

    def edge(self, a: int, b: int) -> None:
        if a != b:
            self.edges.add((min(a, b), max(a, b)))

    def add_line(self, coords: np.ndarray, w: float) -> None:
        pts = densify(coords, STEP_M)
        ids = [self.node(float(x), float(y), w) for x, y in pts]
        for a, b in zip(ids, ids[1:]):
            self.edge(a, b)

    def degree(self) -> np.ndarray:
        deg = np.zeros(len(self.xy), int)
        for a, b in self.edges:
            deg[a] += 1
            deg[b] += 1
        return deg


class _Hash:
    """Uniform grid over points for radius queries."""

    def __init__(self, pts: np.ndarray, cell: float) -> None:
        self.pts, self.cell = pts, cell
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for n, (x, y) in enumerate(pts):
            self.cells[(math.floor(x / cell), math.floor(y / cell))].append(n)

    def near(self, x: float, y: float, r: float) -> list[int]:
        c = self.cell
        out = []
        for i in range(math.floor((x - r) / c), math.floor((x + r) / c) + 1):
            for j in range(math.floor((y - r) / c), math.floor((y + r) / c) + 1):
                for n in self.cells.get((i, j), ()):
                    if (self.pts[n][0] - x) ** 2 + (self.pts[n][1] - y) ** 2 <= r * r:
                        out.append(n)
        return out


def _add_area(g: Graph, poly: Polygon, w: float) -> list[int]:
    """Grid nodes inside ``poly`` (aligned to a global AREA_STEP_M lattice), linked 8-ways."""
    s = AREA_STEP_M
    x0, y0, x1, y1 = poly.bounds
    xs = np.arange(math.ceil(x0 / s), math.floor(x1 / s) + 1) * s
    ys = np.arange(math.ceil(y0 / s), math.floor(y1 / s) + 1) * s
    if len(xs) == 0 or len(ys) == 0:
        c = poly.representative_point()
        return [g.node(c.x, c.y, w)]
    gx, gy = np.meshgrid(xs, ys, indexing="ij")
    inside = shapely.contains_xy(poly, gx, gy)
    ids = np.full(gx.shape, -1, int)
    for i, j in zip(*np.nonzero(inside)):
        ids[i, j] = g.node(float(gx[i, j]), float(gy[i, j]), w)
    shrunk = poly.buffer(0.01)
    for i, j in zip(*np.nonzero(inside)):
        for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
            a, b = i + di, j + dj
            if 0 <= a < ids.shape[0] and 0 <= b < ids.shape[1] and ids[a, b] >= 0:
                if di and dj and not shrunk.contains(LineString([(gx[i, j], gy[i, j]), (gx[a, b], gy[a, b])])):
                    continue
                g.edge(int(ids[i, j]), int(ids[a, b]))
    return [int(n) for n in ids[ids >= 0]]


def _snap_dead_ends(g: Graph, radius: float = SNAP_M) -> int:
    """Join each dead end to the nearest point of another edge within ``radius`` (splitting
    that edge with a new node), unless it is already connected to that edge."""
    pts = np.asarray(g.xy)
    h = _Hash(pts, radius + STEP_M * 1.5)
    nbr: dict[int, set[int]] = defaultdict(set)
    for a, b in g.edges:
        nbr[a].add(b)
        nbr[b].add(a)
    joined = 0
    for n in np.nonzero(g.degree() == 1)[0].tolist():
        p = pts[n]
        best: tuple[float, int, int, float] | None = None
        for a in h.near(p[0], p[1], radius + STEP_M * 1.5):
            for b in nbr[a]:
                if n in (a, b) or a in nbr[n] or b in nbr[n]:
                    continue
                ab = pts[b] - pts[a]
                t = float(np.clip(np.dot(p - pts[a], ab) / max(float(np.dot(ab, ab)), 1e-9), 0, 1))
                d = float(np.hypot(*(pts[a] + ab * t - p)))
                if d <= radius and (best is None or d < best[0]):
                    best = (d, a, b, t)
        if best is None:
            continue
        _, a, b, t = best
        if t < 0.05 or t > 0.95:
            m = a if t < 0.5 else b
        else:
            x, y = pts[a] + (pts[b] - pts[a]) * t
            m = g.node(float(x), float(y), min(g.weight[a], g.weight[b]))
            g.edges.discard((min(a, b), max(a, b)))
            g.edge(a, m)
            g.edge(m, b)
            nbr[a].discard(b); nbr[b].discard(a)
            nbr[a].add(m); nbr[b].add(m); nbr[m] |= {a, b}
        g.edge(n, m)
        nbr[n].add(m)
        nbr[m].add(n)
        joined += 1
    return joined


def _components(n: int, edges: set[tuple[int, int]]) -> np.ndarray:
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in edges:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([find(a) for a in range(n)])


def build_walkways(osm: OsmData, box: RDBox, min_component: int = 3) -> dict:
    """The ``walkways.json`` document: nodes, edges and spawn weights inside RD ``box``."""
    g = Graph()
    clip = shapely.box(*box.as_tuple())
    for f in osm.roads:
        kind = way_kind(f.tags)
        geom = f.geom.intersection(clip)
        if kind:
            for line in _lines(geom):
                g.add_line(np.asarray(line.coords)[:, :2], KIND_WEIGHT[kind])
        sides = sidewalk_sides(f.tags) if not kind else []
        if sides:
            off = _width(f.tags, f.tags.get("highway", "")) / 2 + 1.0
            tagged = any(k.startswith("sidewalk") for k in f.tags)
            w = KIND_WEIGHT["sidewalk"] * (1.0 if tagged else ASSUMED_FACTOR)
            for line in _lines(f.geom):
                for side in sides:
                    sw = shapely.offset_curve(line, side * off, join_style="round")
                    for part in _lines(sw.intersection(clip)):
                        g.add_line(np.asarray(part.coords)[:, :2], w)
    areas = 0
    for f in osm.road_areas:
        if not is_walk_area(f.tags):
            continue
        geom = f.geom.intersection(clip)
        polys = [geom] if isinstance(geom, Polygon) else [p for p in getattr(geom, "geoms", []) if isinstance(p, Polygon)]
        for poly in polys:
            if poly.area < 4:
                continue
            areas += 1
            xy = np.asarray(g.xy).reshape(-1, 2)
            line_nodes = np.nonzero(shapely.contains_xy(poly.buffer(1.0), xy[:, 0], xy[:, 1]))[0].tolist() if len(xy) else []
            grid = _add_area(g, poly, KIND_WEIGHT["square"])
            if grid:
                gp = np.asarray([g.xy[n] for n in grid])
                for n in line_nodes:  # tie the ways crossing the square into its grid
                    d = np.hypot(gp[:, 0] - g.xy[n][0], gp[:, 1] - g.xy[n][1])
                    k = int(np.argmin(d))
                    if d[k] <= AREA_STEP_M * 1.5:
                        g.edge(n, grid[k])
    snapped = _snap_dead_ends(g) if g.xy else 0
    weights = np.asarray(g.weight, float)
    shops = [f.geom.centroid for f in osm.pois
             if "shop" in f.tags or f.tags.get("amenity") in SHOP_AMENITIES]
    if shops and g.xy:
        h = _Hash(np.asarray(g.xy), SHOP_RADIUS_M)
        count = np.zeros(len(g.xy))
        for p in shops:
            for n in h.near(p.x, p.y, SHOP_RADIUS_M):
                count[n] += 1
        weights *= 1 + 0.4 * np.minimum(count, 8)
    return _to_doc(g, weights, min_component, {"areas": areas, "snapped": snapped, "shops": len(shops)})


def _to_doc(g: Graph, weights: np.ndarray, min_component: int, stats: dict) -> dict:
    n = len(g.xy)
    keep = np.ones(n, bool)
    if n:
        comp = _components(n, g.edges)
        sizes = np.bincount(np.unique(comp, return_inverse=True)[1])
        keep = sizes[np.unique(comp, return_inverse=True)[1]] >= min_component
    remap = np.full(n, -1, int)
    remap[keep] = np.arange(int(keep.sum()))
    nodes: list[float] = []
    for (x, y) in np.asarray(g.xy).reshape(-1, 2)[keep]:
        nodes += [round(float(x) - geo.X0, 1), round(float(y) - geo.Y0, 1)]
    edges: list[int] = []
    for a, b in sorted(g.edges):
        if keep[a] and keep[b]:
            edges += [int(remap[a]), int(remap[b])]
    w = [max(1, int(round(v * 2))) for v in weights[keep]]
    return {"version": 1, "kind": "walkways", "meta": {"units": "m", **stats},
            "nodes": nodes, "weights": w, "edges": edges}
