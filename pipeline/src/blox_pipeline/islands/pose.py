"""Island pose: the one transform between an island's local grid and the world (CONTRACT 5.1).

An island is a building (or terrace) built on its own grid, turned so its main wall runs
along a grid axis. Its pose is ``origin`` (Unity metres ``[x, z]``: the world position of
local cell (0, 0)'s min corner) and ``yawDeg`` (clockwise from north, like brick-model
poses). In world (east, north) components the local axes are::

    local +i -> ( cos yaw, -sin yaw)
    local +j -> ( sin yaw,  cos yaw)

so a local point ``(u, v)`` metres lands at ``x = ox + u cos + v sin``,
``z = oz - u sin + v cos``. Heights are untouched: islands use global ``k``.

Why a "fake RD" frame: the voxeliser, the facade run planner and brick layout all work in
RD metres on the world grid. Instead of teaching them about rotation, an island maps its
local metres ``(u, v)`` to the RD point ``(X0 + u, Y0 + v)``. Then local cell ``(i, j)`` is
exactly the "global" cell ``(i, j)`` those modules already compute, and every one of them
runs unchanged on an axis-aligned copy of the building. ``local_affine`` / ``world_affine``
are the shapely matrices for that mapping in each direction.

Every renderer implements ``island_local_to_world`` and passes
``contract/test_vectors/islands.json``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .. import geo


def island_local_to_world(origin: tuple[float, float], yaw_deg: float, u: float, v: float) -> tuple[float, float]:
    """Local metres ``(u, v)`` (u along local +i, v along +j) -> Unity world ``(x, z)``."""
    a = math.radians(yaw_deg)
    c, s = math.cos(a), math.sin(a)
    return origin[0] + u * c + v * s, origin[1] - u * s + v * c


def island_world_to_local(origin: tuple[float, float], yaw_deg: float, x: float, z: float) -> tuple[float, float]:
    """Inverse of :func:`island_local_to_world`."""
    a = math.radians(yaw_deg)
    c, s = math.cos(a), math.sin(a)
    dx, dz = x - origin[0], z - origin[1]
    return c * dx - s * dz, s * dx + c * dz


@dataclass(frozen=True)
class IslandPose:
    origin: tuple[float, float]  # Unity metres [x, z] of local cell (0, 0)
    yaw_deg: float               # clockwise from north, (-45, 45]

    def to_world(self, u: float, v: float) -> tuple[float, float]:
        return island_local_to_world(self.origin, self.yaw_deg, u, v)

    def to_local(self, x: float, z: float) -> tuple[float, float]:
        return island_world_to_local(self.origin, self.yaw_deg, x, z)

    def offset(self, du: float, dv: float) -> "IslandPose":
        """Same yaw, origin moved by local metres ``(du, dv)`` (adjacent 256-stud tiles)."""
        return IslandPose(self.to_world(du, dv), self.yaw_deg)

    def local_affine(self) -> list[float]:
        """Shapely ``affine_transform`` matrix: world RD -> local "fake RD" ``(X0+u, Y0+v)``."""
        a = math.radians(self.yaw_deg)
        c, s = math.cos(a), math.sin(a)
        ox, oz = self.origin[0] + geo.X0, self.origin[1] + geo.Y0  # origin in RD
        # u = c (x - ox) - s (y - oz);  v = s (x - ox) + c (y - oz)
        return [c, -s, s, c, geo.X0 - c * ox + s * oz, geo.Y0 - s * ox - c * oz]

    def world_affine(self) -> list[float]:
        """Shapely ``affine_transform`` matrix: local "fake RD" -> world RD."""
        a = math.radians(self.yaw_deg)
        c, s = math.cos(a), math.sin(a)
        ox, oz = self.origin[0] + geo.X0, self.origin[1] + geo.Y0
        # x = ox + c u + s v;  y = oz - s u + c v   with u = X - X0, v = Y - Y0
        return [c, s, -s, c, ox - c * geo.X0 - s * geo.Y0, oz + s * geo.X0 - c * geo.Y0]


__all__ = ["IslandPose", "island_local_to_world", "island_world_to_local"]
