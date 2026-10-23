"""Typed in-memory structures returned by the source loaders."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray
from shapely.geometry.base import BaseGeometry

from ..geo import CellBox


@dataclass
class HeightGrid:
    """Heights (m NAP) on the stud grid. ``values[i, j]`` is the height at the centre of
    global cell ``(I0 + i, J0 + j)``; NaN = no data."""

    I0: int
    J0: int
    values: NDArray[np.float32]

    @property
    def box(self) -> CellBox:
        ni, nj = self.values.shape
        return CellBox(self.I0, self.J0, self.I0 + ni, self.J0 + nj)

    def window(self, box: CellBox) -> NDArray[np.float32]:
        """Values for ``box``; cells outside this grid are NaN."""
        out = np.full((box.ni, box.nj), np.nan, dtype=np.float32)
        src = self.box
        a0, b0 = max(box.i0, src.i0), max(box.j0, src.j0)
        a1, b1 = min(box.i1, src.i1), min(box.j1, src.j1)
        if a0 < a1 and b0 < b1:
            out[a0 - box.i0 : a1 - box.i0, b0 - box.j0 : b1 - box.j0] = self.values[
                a0 - src.i0 : a1 - src.i0, b0 - src.j0 : b1 - src.j0
            ]
        return out

    def sample(self, i: int, j: int) -> float:
        ii, jj = i - self.I0, j - self.J0
        if 0 <= ii < self.values.shape[0] and 0 <= jj < self.values.shape[1]:
            return float(self.values[ii, jj])
        return float("nan")


@dataclass
class RGBGrid:
    """Colour raster on the stud grid: ``rgb[i, j] = (r, g, b)`` uint8."""

    I0: int
    J0: int
    rgb: NDArray[np.uint8]


@dataclass
class Surface:
    """One planar polygon of a building model, RD metres + NAP."""

    kind: str  # "roof" | "wall" | "ground" | "other"
    exterior: NDArray[np.float64]  # (n, 3)
    holes: list[NDArray[np.float64]] = field(default_factory=list)


@dataclass
class Building:
    """A 3D BAG building (all its BuildingParts merged)."""

    bag_id: str
    attributes: dict[str, Any]
    lod: str
    surfaces: list[Surface]

    @property
    def year(self) -> int | None:
        v = self.attributes.get("oorspronkelijkbouwjaar")
        return int(v) if isinstance(v, (int, float)) else None

    @property
    def ground_z(self) -> float | None:
        v = self.attributes.get("b3_h_maaiveld")
        return float(v) if isinstance(v, (int, float)) else None

    @property
    def roof_max_z(self) -> float | None:
        v = self.attributes.get("b3_h_dak_max")
        if isinstance(v, (int, float)):
            return float(v)
        zs = [s.exterior[:, 2].max() for s in self.surfaces if len(s.exterior)]
        return float(max(zs)) if zs else None


@dataclass
class OsmFeature:
    """A tagged OSM object with geometry in RD metres."""

    osm_id: str  # "node/1", "way/2", "relation/3"
    tags: dict[str, str]
    geom: BaseGeometry

    @property
    def name(self) -> str | None:
        return self.tags.get("name")


@dataclass
class OsmData:
    """OSM content of the slice, grouped by what the voxeliser needs."""

    roads: list[OsmFeature] = field(default_factory=list)  # LineString, highway=*
    road_areas: list[OsmFeature] = field(default_factory=list)  # pedestrian areas, squares
    railways: list[OsmFeature] = field(default_factory=list)  # LineString
    water: list[OsmFeature] = field(default_factory=list)  # (Multi)Polygon
    waterways: list[OsmFeature] = field(default_factory=list)  # LineString
    trees: list[OsmFeature] = field(default_factory=list)  # Point
    landuse: list[OsmFeature] = field(default_factory=list)  # (Multi)Polygon parks etc.
    buildings: list[OsmFeature] = field(default_factory=list)  # (Multi)Polygon, for names/addr
    addresses: list[OsmFeature] = field(default_factory=list)  # Point with addr:*
    pois: list[OsmFeature] = field(default_factory=list)  # named Point/Polygon
