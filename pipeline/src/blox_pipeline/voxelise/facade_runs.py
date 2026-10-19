"""Facade runs of real buildings: where the facade grammar can go, planned once per building.

A **run** is a maximal straight line of a building's wall cells that share one outward
normal (N/E/S/W) and whose outward neighbour column holds no building. Runs come from the
rasterised footprint, so they match the voxel walls exactly.

Each run is planned once for the whole world (not per chunk), from layers built around its
building, so every chunk tile that touches it paints the same thing. A run gets the full
grammar (``detail``) only when all of these hold; otherwise it keeps the glass-cell rhythm
of ``tile._fill_windows`` and ``reason`` says why:

* ``short``: fewer than ``MIN_RUN`` studs;
* ``skew``: not on an axis-aligned footprint edge. Walls of rotated buildings rasterise to
  staircases of short runs; those are the fallback. Maastricht's streets are not on the
  grid, so this is the main limitation (see docs/guide/04);
* ``thin``: the two rows behind the wall are not the same building (no room for the wall
  plane and the room backdrop);
* ``low``: less than one ground floor between base and eave;
* ``street``: the ground in front is higher than the building's floor line, or water/deck.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray
from shapely.geometry import Polygon, box as shp_box
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient

from .. import geo
from ..facade.frame import DIRS, Frame
from ..facade.run import FacadeRun
from ..facade.spec import GROUND_H, STOREY_H, GroundFloor
from . import palette
from .facade_style import FacadeStyle, facade_style
from .layers import NONE, Layers, build_layers, shifted
from .grid import SLOPE_STACK
from .streets import PROBE_M, StreetContext
from .world import PreparedBuilding, PreparedWorld

NORMALS = ("N", "E", "S", "W")
MIN_RUN = 4         # studs: shorter runs keep the glass rhythm
FULL_FRONT = 8      # studs: narrower runs get windows only (no door/shop)
EDGE_SLACK_M = 0.25  # an axis-aligned edge may drift this much across its length
EDGE_COVER = 0.75   # share of the run that must lie on axis-aligned footprint edges
MARGIN = 4          # cells around a building for its layers (run depth -1..2 + neighbours)
PAINT_MARGIN = 3    # cells around a run that its painting can touch


@dataclass(frozen=True)
class RunPlan:
    fid: int
    normal: str              # outward direction, N/E/S/W
    ring: int                # global J (normal N/S) or I (E/W) of the wall row
    a0: int                  # global along-range [a0, a1): I for N/S, J for E/W
    a1: int
    reason: str = ""         # "" = detailed; else why the run falls back
    base: int = 0            # global k of the ground floor line
    lows: tuple[int, ...] = ()  # first building k of each cell (plinth reaches down to it)
    tops: tuple[int, ...] = ()  # wall top (exclusive) of each cell: above the eave = gable
    run: FacadeRun | None = None

    @property
    def detail(self) -> bool:
        return self.run is not None

    @property
    def length(self) -> int:
        return self.a1 - self.a0

    @property
    def frame(self) -> Frame:
        """Run frame: x along the wall from ``a0`` (or ``a1 - 1``), y inward from the ring."""
        if self.normal == "S":
            return Frame("S", self.a0, self.ring)
        if self.normal == "N":
            return Frame("N", self.a1 - 1, self.ring)
        if self.normal == "E":
            return Frame("E", self.ring, self.a0)
        return Frame("W", self.ring, self.a1 - 1)

    def cell(self, a: int, d: int) -> tuple[int, int]:
        """Global ``(I, J)`` of along-coordinate ``a`` at depth ``d`` (0 = ring, >0 inward)."""
        di, dj = DIRS[self.normal]
        if self.normal in ("N", "S"):
            return a, self.ring - d * dj
        return self.ring - d * di, a

    def bbox(self, margin: int = PAINT_MARGIN) -> tuple[int, int, int, int]:
        """Global half-open ``(i0, i1, j0, j1)`` its painting may touch."""
        (i0, j0), (i1, j1) = self.cell(self.a0, 0), self.cell(self.a1 - 1, 0)
        return min(i0, i1) - margin, max(i0, i1) + 1 + margin, min(j0, j1) - margin, max(j0, j1) + 1 + margin


@dataclass
class FacadeStats:
    runs: int = 0
    detailed: int = 0
    length: int = 0          # studs of exterior wall in runs
    detailed_length: int = 0
    by_reason: dict[str, int] | None = None  # studs per fallback reason

    @property
    def share(self) -> float:
        return self.detailed_length / self.length if self.length else 0.0


def plan_facades(world: PreparedWorld) -> list[RunPlan]:
    """Runs of every building that may get the grammar, sorted (deterministic paint order)."""
    out: list[RunPlan] = []
    ctx = world.streets if isinstance(world.streets, StreetContext) else StreetContext()
    for b in world.buildings:
        if b.facade and b.window_period > 0:
            out.extend(plan_building(world, b, ctx))
    return sorted(out, key=lambda r: (r.fid, NORMALS.index(r.normal), r.ring, r.a0))


def facade_stats(plans: list[RunPlan]) -> FacadeStats:
    st = FacadeStats(by_reason={})
    for r in plans:
        st.runs += 1
        st.length += r.length
        if r.detail:
            st.detailed += 1
            st.detailed_length += r.length
        else:
            assert st.by_reason is not None
            st.by_reason[r.reason] = st.by_reason.get(r.reason, 0) + r.length
    return st


def building_box(b: PreparedBuilding, margin: int = MARGIN) -> geo.CellBox:
    xmin, ymin, xmax, ymax = b.footprint.bounds
    i0, j0 = geo.rd_to_grid(xmin, ymin)
    i1, j1 = geo.rd_to_grid(xmax, ymax)
    return geo.CellBox(i0 - margin, j0 - margin, i1 + 1 + margin, j1 + 1 + margin)


def plan_building(world: PreparedWorld, b: PreparedBuilding, ctx: StreetContext) -> list[RunPlan]:
    box = building_box(b)
    L = build_layers(world, box)
    own = (L.bld_feat == b.feature_id) & (L.bld_top != NONE)
    if not own.any():
        return []
    edges = axis_edges(b.footprint)
    wall_top = _wall_top(L)
    style = facade_style(b.bag_id, b.year, palette.entries()[b.wall][1])
    plans = []
    for raw in extract_runs(own, L.bld_top == NONE, box, b.feature_id):
        plans.append(_plan(raw, L, own, wall_top, edges, b, style, ctx))
    return plans


def extract_runs(own: NDArray[np.bool_], open_: NDArray[np.bool_], box: geo.CellBox, fid: int) -> list[RunPlan]:
    """Maximal straight runs of ``own`` cells whose outward neighbour is ``open_``."""
    runs = []
    for normal in NORMALS:
        di, dj = DIRS[normal]
        ring = own & shifted(open_, di, dj, False)
        along_i = normal in ("N", "S")
        lines = ring.T if along_i else ring  # rows of cells along the run direction
        for r, line in enumerate(lines):
            idx = np.flatnonzero(line)
            if not len(idx):
                continue
            breaks = np.flatnonzero(np.diff(idx) > 1)
            starts = np.concatenate([[idx[0]], idx[breaks + 1]])
            ends = np.concatenate([idx[breaks], [idx[-1]]]) + 1
            for s, e in zip(starts, ends):
                if along_i:
                    runs.append(RunPlan(fid, normal, box.j0 + r, box.i0 + int(s), box.i0 + int(e)))
                else:
                    runs.append(RunPlan(fid, normal, box.i0 + r, box.j0 + int(s), box.j0 + int(e)))
    return runs


def axis_edges(fp: BaseGeometry) -> list[tuple[str, float, float, float]]:
    """Footprint edges that run along a grid axis: ``(normal, line, lo, hi)`` in RD metres
    (``line`` is y for N/S edges, x for E/W; ``lo..hi`` the extent along the edge)."""
    polys = list(fp.geoms) if hasattr(fp, "geoms") else [fp]
    out = []
    for p in polys:
        if not isinstance(p, Polygon):
            continue
        p = orient(p, 1.0)  # exterior CCW, holes CW: outward normal of (dx, dy) is (dy, -dx)
        for ring in [p.exterior, *p.interiors]:
            c = list(ring.coords)
            for (x0, y0), (x1, y1) in zip(c, c[1:]):
                dx, dy = x1 - x0, y1 - y0
                if abs(dy) <= EDGE_SLACK_M and abs(dx) > abs(dy):
                    out.append(("S" if dx > 0 else "N", (y0 + y1) / 2, min(x0, x1), max(x0, x1)))
                elif abs(dx) <= EDGE_SLACK_M and abs(dy) > abs(dx):
                    out.append(("E" if dy > 0 else "W", (x0 + x1) / 2, min(y0, y1), max(y0, y1)))
    return out


def edge_cover(raw: RunPlan, edges: list[tuple[str, float, float, float]]) -> float:
    """Share of the run's length that lies on matching axis-aligned footprint edges."""
    along_i = raw.normal in ("N", "S")
    origin, other = (geo.X0, geo.Y0) if along_i else (geo.Y0, geo.X0)
    lo, hi = origin + raw.a0 * geo.STUD_M, origin + raw.a1 * geo.STUD_M
    # the wall row is the first row whose cell centre lies inside: the edge sits within
    # half a cell of that centre line, on the outward side
    centre = other + (raw.ring + 0.5) * geo.STUD_M
    sign = DIRS[raw.normal][1] if along_i else DIRS[raw.normal][0]
    covered = 0.0
    for normal, line, e0, e1 in edges:
        if normal != raw.normal:
            continue
        off = (line - centre) * sign  # > 0: edge lies outward of the ring centres
        if -1e-6 <= off <= geo.STUD_M + 1e-6:
            covered += max(0.0, min(hi, e1) - max(lo, e0))
    return covered / (hi - lo)


def _wall_top(L: Layers) -> NDArray[np.int64]:
    """Exclusive top of each column's plain wall (below the roof band, as ``tile`` fills)."""
    t, g = L.bld_top.astype(np.int64), L.ground_k.astype(np.int64)
    band = np.where(L.roof_shape > 0, 2 * SLOPE_STACK, 1)
    band = np.minimum(band, np.maximum(t - g, 0))
    return np.where(t != NONE, t - band + 1, NONE)


def _plan(raw: RunPlan, L: Layers, own: NDArray[np.bool_], wall_top: NDArray[np.int64],
          edges: list, b: PreparedBuilding, style: FacadeStyle, ctx: StreetContext) -> RunPlan:
    def at(arr: NDArray, d: int) -> NDArray:
        cells = [raw.cell(a, d) for a in range(raw.a0, raw.a1)]
        return np.array([arr[I - L.box.i0, J - L.box.j0] for I, J in cells])

    def fallback(reason: str) -> RunPlan:
        return RunPlan(raw.fid, raw.normal, raw.ring, raw.a0, raw.a1, reason)

    if raw.length < MIN_RUN:
        return fallback("short")
    if edge_cover(raw, edges) < EDGE_COVER:
        return fallback("skew")
    if not (at(own, 1).all() and at(own, 2).all()):
        return fallback("thin")
    lows = at(L.ground_k, 0).astype(np.int64) + 1
    base = int(lows.max())
    eave = int(min(at(wall_top, d).min() for d in (0, 1, 2)))
    if eave - base < GROUND_H:
        return fallback("low")
    out_top = np.maximum.reduce([at(L.ground_k, -1), at(L.water_k, -1), at(L.deck_k, -1)])
    if int(out_top.max()) > base + 2 or (at(L.water_k, -1) != NONE).any():
        return fallback("street")
    storeys = (eave - base - GROUND_H) // STOREY_H
    run = FacadeRun(
        x0=0, x1=raw.length, y0=0, storeys=storeys, fid=b.feature_id, wall=b.wall,
        trim=style.trim, accent=style.accent, plinth=style.plinth,
        ground=_ground_kind(raw, b, style, storeys, ctx), awning=style.awning,
        quoins=style.quoins, shutters=style.shutters and raw.length >= FULL_FRONT,
        flowers=style.flowers, eave_extra=eave - base - GROUND_H - storeys * STOREY_H,
        cuts=_cuts(raw),
    )
    return RunPlan(raw.fid, raw.normal, raw.ring, raw.a0, raw.a1, "", base, tuple(int(v) for v in lows),
                   tuple(int(v) for v in at(wall_top, 0)), run)


def _cuts(raw: RunPlan) -> tuple[int, ...]:
    """Chunk borders inside the run, as frame x positions."""
    n = geo.CHUNK_STUDS
    borders = range((raw.a0 // n + 1) * n, raw.a1, n)
    forward = raw.normal in ("S", "E")  # frame x grows with the global coordinate
    return tuple(sorted(c - raw.a0 if forward else raw.a1 - c for c in borders))


def probe(raw: RunPlan) -> BaseGeometry:
    """Strip in front of the middle 80 % of the run, ``PROBE_M`` deep (RD metres)."""
    s = geo.STUD_M
    n = raw.length * 0.1
    lo, hi = raw.a0 + n, raw.a1 - n
    di, dj = DIRS[raw.normal]
    if raw.normal in ("N", "S"):
        y = geo.Y0 + (raw.ring + (1 if dj > 0 else 0)) * s
        y1 = y + dj * PROBE_M
        return shp_box(geo.X0 + lo * s, min(y, y1), geo.X0 + hi * s, max(y, y1))
    x = geo.X0 + (raw.ring + (1 if di > 0 else 0)) * s
    x1 = x + di * PROBE_M
    return shp_box(min(x, x1), geo.Y0 + lo * s, max(x, x1), geo.Y0 + hi * s)


def _ground_kind(raw: RunPlan, b: PreparedBuilding, style: FacadeStyle, storeys: int,
                 ctx: StreetContext) -> GroundFloor:
    if raw.length < FULL_FRONT:
        return GroundFloor.PLAIN
    street, pedestrian = ctx.faces(probe(raw))
    if not street:
        return GroundFloor.PLAIN
    if (b.shop or pedestrian) and storeys >= 1:
        return GroundFloor.SHOP
    return GroundFloor.ARCHED if style.arched else GroundFloor.HOUSE


__all__ = ["RunPlan", "FacadeStats", "plan_facades", "facade_stats", "extract_runs", "axis_edges",
           "edge_cover", "MIN_RUN"]
