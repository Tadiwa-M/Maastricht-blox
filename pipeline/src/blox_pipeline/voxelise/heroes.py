"""Hero landmarks: hand-authored brick models that replace a 3D BAG building (look v2).

A landmark with a ``model`` (``landmarks.py``; the Stadhuis on the Markt) is matched to its
3D BAG building as usual, but instead of voxelising the LoD2.2 shape a hand-authored model
(``facade.stadhuis``) is painted on its footprint:

* **Plan** (``plan_heroes``, once per world): the footprint's cells give the model's
  rectangle (``W`` x ``D`` studs along its front and depth), the front is the side facing
  the most street/square (``StreetContext.area`` of a 15 m strip in front of each side),
  the ground line is the highest ground under it. A footprint smaller than the model's
  minimum keeps the ordinary 3D BAG voxelisation.
* **Where**: the model is built wherever its building is. A building turned more than 3
  degrees is an island (CONTRACT 5.1), and the island's local world plans and paints the
  model on its own turned grid; otherwise it is painted into the world chunks.
* **Occupancy**: the hero building is not rasterised from 3D BAG; ``layers`` marks its
  footprint as taken up to the model's top (like an island), so neighbours put no facade on
  a party wall against it and no tree grows inside it.
* **Paint** (``paint_heroes``): every tile that the model's box reaches paints the whole
  model through a ``TileCanvas`` (clipped, pieces recorded only in their own chunk, pieces
  that would straddle a chunk border drawn as voxels by the model itself).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from shapely.geometry import box as shp_box
from shapely.geometry.base import BaseGeometry

from .. import geo
from ..facade import stadhuis
from ..facade.frame import Frame, FramePainter
from ..geo import CellBox
from .layers import NONE, build_layers
from .raster import cover
from .world import PreparedBuilding, PreparedWorld

PROBE_M = 15.0
MODELS = ("stadhuis",)


@dataclass(frozen=True)
class HeroPlan:
    fid: int
    model: str
    footprint: BaseGeometry  # (local) RD, for occupancy
    frame: Frame             # model frame: x along the front, y inward, front faces S
    w: int                   # studs along the front
    d: int                   # studs of depth
    base: int                # ground line k (first cell above the highest ground)
    low: int                 # first cell above the lowest ground under the footprint
    cells: tuple[int, int, int, int]  # footprint rectangle, global half-open (i0, i1, j0, j1)

    @property
    def top_k(self) -> int:
        return self.base + stadhuis.model_height(self.w, self.d)

    def bbox(self) -> tuple[int, int, int, int]:
        """Global half-open ``(i0, i1, j0, j1)`` the model may paint (front reach included)."""
        m = stadhuis.FRONT_REACH + 2
        i0, i1, j0, j1 = self.cells
        return i0 - m, i1 + m, j0 - m, j1 + m


def _frame(normal: str, i0: int, i1: int, j0: int, j1: int) -> tuple[Frame, int, int]:
    """Model frame whose front (frame row 0) is the footprint's ``normal`` side."""
    if normal == "S":
        return Frame("S", i0, j0), i1 - i0, j1 - j0
    if normal == "N":
        return Frame("N", i1 - 1, j1 - 1), i1 - i0, j1 - j0
    if normal == "E":
        return Frame("E", i1 - 1, j0), j1 - j0, i1 - i0
    return Frame("W", i0, j1 - 1), j1 - j0, i1 - i0


def _street_area(world: PreparedWorld, probe: BaseGeometry) -> float:
    ctx = world.streets
    return float(ctx.area(probe)) if ctx is not None and hasattr(ctx, "area") else 0.0


def front_side(world: PreparedWorld, cells: tuple[int, int, int, int]) -> str:
    """The side of the rectangle that faces the most street and square (ties: S, E, N, W)."""
    i0, i1, j0, j1 = cells
    x0, y0 = geo.X0 + i0 * geo.STUD_M, geo.Y0 + j0 * geo.STUD_M
    x1, y1 = geo.X0 + i1 * geo.STUD_M, geo.Y0 + j1 * geo.STUD_M
    probes = {"S": shp_box(x0, y0 - PROBE_M, x1, y0), "E": shp_box(x1, y0, x1 + PROBE_M, y1),
              "N": shp_box(x0, y1, x1, y1 + PROBE_M), "W": shp_box(x0 - PROBE_M, y0, x0, y1)}
    scores = {n: _street_area(world, p) for n, p in probes.items()}
    return max("SENW", key=lambda n: (scores[n], -"SENW".index(n)))


def plan_hero(world: PreparedWorld, b: PreparedBuilding) -> HeroPlan | None:
    if b.hero not in MODELS:
        return None
    xmin, ymin, xmax, ymax = b.footprint.bounds
    a0, b0 = geo.rd_to_grid(xmin, ymin)
    a1, b1 = geo.rd_to_grid(xmax, ymax)
    box = CellBox(a0 - 2, b0 - 2, a1 + 3, b1 + 3)
    L = build_layers(world, box)
    hit = cover(b.footprint, box)
    if hit is None:
        return None
    win, mask = hit
    ii, jj = np.nonzero(mask)
    if not len(ii):
        return None
    i0, i1 = win.i0 + int(ii.min()), win.i0 + int(ii.max()) + 1
    j0, j1 = win.j0 + int(jj.min()), win.j0 + int(jj.max()) + 1
    g = L.ground_k[i0 - box.i0: i1 - box.i0, j0 - box.j0: j1 - box.j0]
    g = g[g != NONE]
    if not g.size:
        return None
    frame, w, d = _frame(front_side(world, (i0, i1, j0, j1)), i0, i1, j0, j1)
    if w < stadhuis.MIN_W or d < stadhuis.MIN_D:
        return None
    return HeroPlan(b.feature_id, b.hero, b.footprint, frame, w, d, int(g.max()) + 1, int(g.min()) + 1,
                    (i0, i1, j0, j1))


def take_heroes(world: PreparedWorld) -> None:
    """Plan the models of ``world``'s hero buildings and take those buildings out of the
    voxelised buildings (a hero that does not fit keeps its 3D BAG shape)."""
    plans = [p for p in (plan_hero(world, b) for b in world.buildings if b.hero) if p is not None]
    if not plans:
        return
    taken = {p.fid for p in plans}
    world.buildings = [b for b in world.buildings if b.feature_id not in taken]
    world.heroes = plans
    world.index()


def heroes_near(world: PreparedWorld, i0: int, j0: int, i1: int, j1: int) -> list[HeroPlan]:
    out = []
    for h in world.heroes:
        a0, a1, b0, b1 = h.bbox()
        if a0 < i1 and a1 > i0 and b0 < j1 and b1 > j0:
            out.append(h)
    return out


def paint_heroes(cv, plans: list[HeroPlan]) -> None:
    """Paint every model in ``plans`` (``cv``: a ``TileCanvas`` in global coordinates)."""
    for h in plans:
        if h.model == "stadhuis":
            stadhuis.paint_stadhuis(FramePainter(cv, h.frame), h.w, h.d, h.base, h.fid, h.low)


__all__ = ["HeroPlan", "heroes_near", "paint_heroes", "plan_hero", "take_heroes"]
