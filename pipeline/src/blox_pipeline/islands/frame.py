"""An island group's local frame and its axis-aligned "local world".

``island_frame`` picks the pose: the group's yaw and an origin such that

* every local cell the island can touch is >= 0 (a ``PAD``-cell margin around the grown
  footprints leaves room for sills, awnings and the facade's street props);
* the longest wall along each local axis lies on a **cell centre line**. After growing the
  footprint by half a stud (CONTRACT 5.1) its outline then sits exactly on cell boundaries,
  halfway between cell centres, so rasterising it is not at the mercy of rounding.

``local_world`` then copies the group into that frame as a :class:`PreparedWorld` whose RD
coordinates are the island's local metres shifted by the slice origin (see ``pose``):
footprints, roof planes (polygon, normal and origin turned by -yaw) and landmark accents are
transformed; ground heights come from the world DTM sampled at each local cell centre's
world position; there are no roads, water or trees (the world chunks draw those).

Buildings *next to* the group that are not in it (on-grid neighbours, other islands) are not
built here, but the local world must still know their space is taken, exactly as the world
grid knows an island is there: they are copied (turned, not grown) into ``islands`` of the
local world, which the layers turn into occupancy only. Without that, an island's party wall
against an axis-aligned neighbour looks like a street front and gets windows and a door. Street
context for shop fronts is *not* copied: :class:`WorldStreets` turns each facade probe back
into world RD and asks the world's street context, so a shop front is decided exactly where
the street is.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .. import geo
from ..sources.model import HeightGrid
from ..voxelise.streets import StreetContext
from ..voxelise.world import Accent, PreparedBuilding, PreparedWorld, RoofPlane
from .group import IslandGroup
from .pose import IslandPose

NEIGHBOUR_M = 2.0  # non-member buildings this close to the group are occupancy in its local world
GROW_M = 0.25   # half a stud: rotated edges overlap their neighbours instead of leaving slits
PAD = 6         # cells of margin around the grown footprints (facade paint reaches 3 out)
DTM_PAD = 24    # cells of local DTM beyond the island (layers are built with a margin)


@dataclass(frozen=True)
class IslandFrame:
    pose: IslandPose
    ni: int  # local cells along i (may exceed 256: split into tiles later)
    nj: int


def _polygonal(g: BaseGeometry) -> BaseGeometry:
    if isinstance(g, (Polygon, MultiPolygon)):
        return g
    polys = [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon)) and not p.is_empty]
    return unary_union(polys) if polys else Polygon()


def _grow(g: BaseGeometry) -> BaseGeometry:
    return g.buffer(GROW_M, join_style="mitre", mitre_limit=3.0)


def _snap(line: float, lo: float) -> float:
    """Largest origin ``o <= lo`` with ``(line - o) mod 0.5 == 0.25`` (line on a cell centre)."""
    s = geo.STUD_M
    return line - s / 2 - s * math.ceil((line - s / 2 - lo) / s - 1e-9)


def island_frame(group: IslandGroup) -> IslandFrame:
    probe = IslandPose((0.0, 0.0), group.yaw_deg)
    m = probe.local_affine()
    local = [affinity.affine_transform(b.footprint, m) for b in group.members]
    grown = unary_union([_grow(g) for g in local])
    umin, vmin, umax, vmax = grown.bounds
    umin, umax, vmin, vmax = umin - geo.X0, umax - geo.X0, vmin - geo.Y0, vmax - geo.Y0
    s = geo.STUD_M
    u_line, v_line = umin, vmin  # fall back to the bounds if no clear wall
    best_u = best_v = 0.0
    for g in local:
        for p in (g.geoms if hasattr(g, "geoms") else [g]):
            c = np.asarray(p.exterior.coords)
            for (x0, y0), (x1, y1) in zip(c[:-1, :2], c[1:, :2]):
                du, dv = x1 - x0, y1 - y0
                ln = math.hypot(du, dv)
                if abs(dv) < abs(du) and ln > best_v:      # along local i: fixes v
                    best_v, v_line = ln, (y0 + y1) / 2 - geo.Y0
                elif abs(du) <= abs(dv) and ln > best_u:   # along local j: fixes u
                    best_u, u_line = ln, (x0 + x1) / 2 - geo.X0
    u0 = _snap(u_line, umin - PAD * s)
    v0 = _snap(v_line, vmin - PAD * s)
    ni = math.ceil((umax - u0) / s) + PAD
    nj = math.ceil((vmax - v0) / s) + PAD
    return IslandFrame(IslandPose(probe.to_world(u0, v0), group.yaw_deg), ni, nj)


class WorldStreets(StreetContext):
    """Street context of the world, queried with probes drawn in the island's local frame."""

    def __init__(self, world_ctx: StreetContext | None, pose: IslandPose) -> None:
        super().__init__(None, None)
        self.world_ctx = world_ctx or StreetContext()
        self.matrix = pose.world_affine()

    def faces(self, probe: BaseGeometry) -> tuple[bool, bool]:
        return self.world_ctx.faces(affinity.affine_transform(probe, self.matrix))


def _turn(pose: IslandPose, x: float, y: float) -> tuple[float, float]:
    a, b, d, e, xo, yo = pose.local_affine()
    return a * x + b * y + xo, d * x + e * y + yo


def local_building(b: PreparedBuilding, pose: IslandPose) -> PreparedBuilding:
    """``b`` in the island's local frame, footprint grown by ``GROW_M``."""
    m = pose.local_affine()
    fp = affinity.affine_transform(b.footprint, m)
    grown = _grow(fp)
    rim = grown.difference(fp)
    c, s = m[0], m[2]  # cos, sin of -yaw as applied to vectors: (c x - s y, s x + c y)
    roofs = []
    for p in b.roofs:
        poly = affinity.affine_transform(p.poly, m)
        poly = _polygonal(_grow(poly).intersection(poly.union(rim)))
        if poly.is_empty:
            continue
        nx, ny, nz = p.normal
        roofs.append(RoofPlane(poly=poly, normal=(c * nx - s * ny, s * nx + c * ny, nz),
                               origin=(*_turn(pose, p.origin[0], p.origin[1]), p.origin[2]), eave_z=p.eave_z))
    accent = None
    if b.accent is not None:
        accent = Accent(_turn(pose, *b.accent.centre), b.accent.radius_m, b.accent.wall, b.accent.roof)
    return replace(b, footprint=grown, roofs=roofs, accent=accent)


def local_dtm(world: PreparedWorld, frame: IslandFrame) -> HeightGrid:
    """World DTM sampled at the world position of every local cell centre (nearest cell)."""
    n0 = -DTM_PAD
    ii = np.arange(n0, frame.ni + DTM_PAD)
    jj = np.arange(n0, frame.nj + DTM_PAD)
    u, v = np.meshgrid((ii + 0.5) * geo.STUD_M, (jj + 0.5) * geo.STUD_M, indexing="ij")
    a = math.radians(frame.pose.yaw_deg)
    x = frame.pose.origin[0] + u * math.cos(a) + v * math.sin(a)
    z = frame.pose.origin[1] - u * math.sin(a) + v * math.cos(a)
    I = np.floor(x / geo.STUD_M).astype(np.int64) - world.dtm.I0
    J = np.floor(z / geo.STUD_M).astype(np.int64) - world.dtm.J0
    ni, nj = world.dtm.values.shape
    ok = (I >= 0) & (I < ni) & (J >= 0) & (J < nj)
    out = np.full(u.shape, np.nan, np.float32)
    out[ok] = world.dtm.values[I[ok], J[ok]]
    return HeightGrid(n0, n0, out)


def local_neighbours(world: PreparedWorld, group: IslandGroup, pose: IslandPose) -> list[IslandGroup]:
    """Buildings near ``group`` but not in it, in the local frame, as one occupancy-only group."""
    area = unary_union([b.footprint for b in group.members]).buffer(NEIGHBOUR_M)
    own = set(group.fids)
    near = [b for b in world.buildings_in(area) if b.footprint.intersects(area)]
    near += [b for g in world.islands if g is not group for b in g.members if b.footprint.intersects(area)]
    m = pose.local_affine()
    out = [replace(local_building(b, pose), footprint=affinity.affine_transform(b.footprint, m))
           for b in near if b.feature_id not in own]
    return [IslandGroup(out, group.yaw_deg)] if out else []


def local_world(world: PreparedWorld, group: IslandGroup, frame: IslandFrame) -> PreparedWorld:
    streets = world.streets if isinstance(world.streets, StreetContext) else None
    lw = PreparedWorld(
        dtm=local_dtm(world, frame), config=world.config, registry=world.registry,
        buildings=[local_building(b, frame.pose) for b in group.members],
        streets=WorldStreets(streets, frame.pose),
        islands=local_neighbours(world, group, frame.pose),
    )
    lw.index()
    return lw


__all__ = ["GROW_M", "NEIGHBOUR_M", "local_neighbours", "IslandFrame", "WorldStreets", "island_frame", "local_building", "local_dtm", "local_world"]
