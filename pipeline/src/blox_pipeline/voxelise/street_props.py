"""Street furniture for the old centre (look v2, owner's Markt photos): black double-lantern
lamp posts, cast-iron bollards with chains and stone benches, placed deterministically from
the OSM street geometry.

* **Squares** (OSM road areas in the centre zones, not parking, >= ``SQUARE_MIN_M2``): along
  the outline ``SQUARE_INSET_M`` inside it, a lamp every ``LAMP_STEP_M`` and a bench halfway
  between two lamps.
* **Pedestrian streets** (``pedestrian``/``living_street`` in the centre): a lamp every
  ``LAMP_STEP_M``, alternately on either side, 1 m in from the street edge.
* **Car streets** in the centre (residential to tertiary): every ``BOLLARD_STEP_M`` a pair of
  bollards with a chain between them, just outside the road edge (on the kerb side).

A spot is dropped when any cell of it lies within ``CLEAR_M`` of a building, an island, a
hero model, water, a bridge deck, a tree trunk, a car road (for lamps and benches) or an
earlier prop, when its ground is not flat (more than one plate of difference), or when a
piece would straddle a chunk border (CONTRACT 4). Pieces are axis-aligned: they take the
grid axis nearest to the street direction. Planned once for the world (``plan_props``);
every tile the props reach paints them (``paint_props``) like facade runs, so tiles agree.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import geo
from ..catalogue import load_catalogue
from ..sources.model import OsmData
from .prepare_osm import ROAD_WIDTH_M, in_centre, parse_width
from .world import PreparedWorld

SQUARE_MIN_M2 = 300.0
SQUARE_INSET_M = 2.0
LAMP_STEP_M = 22.0
BOLLARD_STEP_M = 18.0
CLEAR_M = 1.2
PROP_GAP_M = 3.0
PEDESTRIAN = frozenset({"pedestrian", "living_street"})
CAR = frozenset({"residential", "unclassified", "tertiary", "secondary", "primary", "service"})
BOLLARD_ROADS = frozenset({"residential", "unclassified", "tertiary"})
BENCH_COLOUR, IRON = "limestone_dark", "black"


@dataclass(frozen=True)
class Prop:
    kind: str     # "lamp", "bollard", "chain", "bench"
    I: int        # min corner of the box, global cells
    J: int
    k: int        # first cell above the ground
    facing: str   # N/E/S/W (benches: "N" = seat along i, "E" = along j)

    @property
    def piece(self) -> str | None:
        return {"lamp": "lamp_double_1x3", "bollard": "bollard_1x1", "chain": "chain_1x4"}.get(self.kind)

    def extent(self) -> tuple[int, int, int]:
        """``(cells along i, along j, plates)``."""
        if self.kind == "bench":
            return (4, 1, 2) if self.facing in ("N", "S") else (1, 4, 2)
        t = load_catalogue()[self.piece]
        along_i = self.facing in ("N", "S")
        return (t.w, t.d, t.h) if along_i else (t.d, t.w, t.h)

    @property
    def top_k(self) -> int:
        return self.k + self.extent()[2]

    def box(self) -> tuple[int, int, int, int]:
        ei, ej, _ = self.extent()
        return self.I, self.I + ei, self.J, self.J + ej


def _axis(dx: float, dy: float) -> str:
    """Facing whose piece width runs along the grid axis nearest to (dx, dy)."""
    return "N" if abs(dx) >= abs(dy) else "E"


class _Site:
    """Checks spots against everything a prop must keep clear of."""

    def __init__(self, world: PreparedWorld, osm: OsmData) -> None:
        self.world = world
        hard: list[BaseGeometry] = [b.footprint for b in world.buildings]
        hard += [b.footprint for g in world.islands for b in g.members]
        hard += [h.footprint.buffer(stadhuis_reach()) for h in world.heroes]
        hard += [w.geom for w in world.water]
        hard += [p.geom for p in world.patches if p.deck is not None]
        hard += [Point(geo.X0 + (t.I + 0.5) * geo.STUD_M, geo.Y0 + (t.J + 0.5) * geo.STUD_M) for t in world.trees]
        self.hard = STRtree(hard) if hard else None
        roads = []
        for f in osm.roads:
            hw = f.tags.get("highway", "")
            if hw in CAR:
                roads.append(f.geom.buffer((parse_width(f.tags) or ROAD_WIDTH_M.get(hw, 4.0)) / 2))
        self.roads = unary_union(roads) if roads else None
        if self.roads is not None:
            shapely.prepare(self.roads)
        self.taken: list[Point] = []

    def free(self, p: Prop, road_ok: bool) -> bool:
        i0, i1, j0, j1 = p.box()
        n = geo.CHUNK_STUDS
        if i0 // n != (i1 - 1) // n or j0 // n != (j1 - 1) // n:
            return False
        area = Polygon.from_bounds(geo.X0 + i0 * geo.STUD_M, geo.Y0 + j0 * geo.STUD_M,
                                   geo.X0 + i1 * geo.STUD_M, geo.Y0 + j1 * geo.STUD_M)
        near = area.buffer(CLEAR_M)
        if self.hard is not None and len(self.hard.query(near, predicate="intersects")):
            return False
        if not road_ok and self.roads is not None and self.roads.intersects(area.buffer(0.3)):
            return False
        c = area.centroid
        return all(c.distance(q) >= PROP_GAP_M for q in self.taken)

    def ground(self, p: Prop) -> int | None:
        """First cell above the ground under the box, None if it is not flat."""
        i0, i1, j0, j1 = p.box()
        z = self.world.dtm.window(geo.CellBox(i0, j0, i1, j1))
        if z.size == 0 or np.isnan(z).any():
            return None
        k = geo.z_to_k_np(z)
        if int(k.max()) - int(k.min()) > 1:
            return None
        return int(k.max()) + 1


def stadhuis_reach() -> float:
    from ..facade.stadhuis import FRONT_REACH

    return (FRONT_REACH + 2) * geo.STUD_M


def _cell(x: float, y: float) -> tuple[int, int]:
    return geo.rd_to_grid(x, y)


def _try(site: _Site, out: list[Prop], props: list[Prop], road_ok: bool = False) -> bool:
    """Add a group of props (all or none) when every one is free and on flat ground."""
    placed = []
    for p in props:
        if not site.free(p, road_ok):
            return False
        k = site.ground(p)
        if k is None:
            return False
        placed.append(Prop(p.kind, p.I, p.J, k, p.facing))
    if len(placed) == 3 and placed[1].kind == "chain":  # the chain hangs from the higher bollard
        k = max(placed[0].k, placed[2].k)
        placed = [placed[0], Prop("chain", placed[1].I, placed[1].J, k + 2, placed[1].facing), placed[2]]
    out.extend(placed)
    for p in placed:
        i0, i1, j0, j1 = p.box()
        site.taken.append(Point(geo.X0 + (i0 + i1) / 2 * geo.STUD_M, geo.Y0 + (j0 + j1) / 2 * geo.STUD_M))
    return True


def _lamp(x: float, y: float, dx: float, dy: float) -> Prop:
    I, J = _cell(x, y)
    f = _axis(dx, dy)
    return Prop("lamp", I - 1, J, 0, f) if f == "N" else Prop("lamp", I, J - 1, 0, f)


def _bench(x: float, y: float, dx: float, dy: float) -> Prop:
    I, J = _cell(x, y)
    f = _axis(dx, dy)
    return Prop("bench", I - 2, J, 0, f) if f == "N" else Prop("bench", I, J - 2, 0, f)


def _bollards(x: float, y: float, dx: float, dy: float) -> list[Prop]:
    I, J = _cell(x, y)
    f = _axis(dx, dy)
    if f == "N":
        return [Prop("bollard", I - 3, J, 0, f), Prop("chain", I - 2, J, 0, f), Prop("bollard", I + 2, J, 0, f)]
    return [Prop("bollard", I, J - 3, 0, f), Prop("chain", I, J - 2, 0, f), Prop("bollard", I, J + 2, 0, f)]


def _along(line: LineString, step: float, start: float):
    """``(x, y, dx, dy)`` every ``step`` metres from ``start`` along ``line``."""
    d = start
    while d < line.length:
        a, b = line.interpolate(max(0.0, d - 0.5)), line.interpolate(min(line.length, d + 0.5))
        p = line.interpolate(d)
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1.0
        yield p.x, p.y, dx / n, dy / n
        d += step


def plan_props(world: PreparedWorld, osm: OsmData) -> list[Prop]:
    site = _Site(world, osm)
    out: list[Prop] = []
    for f in sorted(osm.road_areas, key=lambda f: f.osm_id):
        if f.tags.get("amenity") == "parking" or not in_centre(f.geom) or f.geom.area < SQUARE_MIN_M2:
            continue
        inner = f.geom.buffer(-SQUARE_INSET_M)
        for poly in getattr(inner, "geoms", [inner]):
            if not isinstance(poly, Polygon) or poly.is_empty:
                continue
            ring = LineString(poly.exterior.coords)
            for x, y, dx, dy in _along(ring, LAMP_STEP_M, LAMP_STEP_M / 2):
                _try(site, out, [_lamp(x, y, dx, dy)])
            for x, y, dx, dy in _along(ring, LAMP_STEP_M, LAMP_STEP_M):
                _try(site, out, [_bench(x, y, dx, dy)])
    for f in sorted(osm.roads, key=lambda f: f.osm_id):
        hw = f.tags.get("highway", "")
        if not isinstance(f.geom, LineString) or not in_centre(f.geom):
            continue
        width = parse_width(f.tags) or ROAD_WIDTH_M.get(hw, 4.0)
        if hw in PEDESTRIAN:
            for q, (x, y, dx, dy) in enumerate(_along(f.geom, LAMP_STEP_M, LAMP_STEP_M / 2)):
                side = (1 if q % 2 == 0 else -1) * max(0.0, width / 2 - 1.0)
                _try(site, out, [_lamp(x - dy * side, y + dx * side, dx, dy)])
        elif hw in BOLLARD_ROADS:
            for q, (x, y, dx, dy) in enumerate(_along(f.geom, BOLLARD_STEP_M, BOLLARD_STEP_M / 2)):
                side = (1 if q % 2 == 0 else -1) * (width / 2 + 0.75)
                _try(site, out, _bollards(x - dy * side, y + dx * side, dx, dy), road_ok=True)
    return out


def props_near(world: PreparedWorld, i0: int, j0: int, i1: int, j1: int) -> list[Prop]:
    out = []
    for p in world.props:
        a0, a1, b0, b1 = p.box()
        if a0 < i1 + 1 and a1 > i0 - 1 and b0 < j1 + 1 and b1 > j0 - 1:
            out.append(p)
    return out


def paint_props(cv, props: list[Prop]) -> None:
    """Paint props into a ``TileCanvas`` (pieces are recorded only in their own chunk)."""
    for p in props:
        if p.kind == "bench":
            i0, i1, j0, j1 = p.box()
            if p.facing in ("N", "S"):
                for i in (i0, i1 - 1):
                    cv.fill(i, i + 1, j0, j1, p.k, p.k + 1, BENCH_COLOUR)
            else:
                for j in (j0, j1 - 1):
                    cv.fill(i0, i1, j, j + 1, p.k, p.k + 1, BENCH_COLOUR)
            cv.fill(i0, i1, j0, j1, p.k + 1, p.k + 2, BENCH_COLOUR)
        else:
            cv.place(p.piece, p.I, p.J, p.k, p.facing, IRON)


__all__ = ["Prop", "plan_props", "props_near", "paint_props"]
