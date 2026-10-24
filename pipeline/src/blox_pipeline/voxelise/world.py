"""Slice-wide prepared world: every source object turned into a voxelisable item with
palette colours, feature ids and globally consistent heights (so tiles built
independently agree at their borders)."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from shapely import STRtree
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

from ..sources.model import HeightGrid
from .features import FeatureRegistry


@dataclass
class VoxelConfig:
    maas_level_m: float = 44.1  # typical Maas level at Maastricht (m NAP), above the Borgharen weir
    water_depth_m: float = 0.6  # transparent water body below the surface cell
    terrain_depth_plates: int = 3  # crust thickness below the lowest neighbouring surface
    terrain_smooth_m: float = 2.0  # DTM blur radius: removes ±10 cm survey noise before 0.2 m plates
    storey_plates: int = 15  # 3.0 m storeys
    window_band: tuple[int, int] = (4, 11)  # plates within a storey that are glass (0.8 - 2.2 m)
    flat_pitch_deg: float = 15.0  # roofs flatter than this are flat
    steep_pitch_deg: float = 75.0  # roofs steeper than this are treated as walls/flat tops
    bridge_clearance_m: float = 1.5  # deck at least this far above the water it spans
    use_ortho_ground: bool = True
    facade_detail: bool = True  # facade grammar on axis-aligned walls (False: glass cells only)
    islands: bool = True  # rotated buildings on their own grid (CONTRACT 5.1); False: staircases
    heroes: bool = True   # hand-authored landmark models (heroes.py) instead of their 3D BAG shape
    street_props: bool = True  # lamp posts, bollards with chains, benches (street_props.py)
    island_min_yaw_deg: float = 3.0  # buildings turned more than this become islands


@dataclass
class RoofPlane:
    poly: Polygon  # 2D projection (RD)
    normal: tuple[float, float, float]  # unit, nz > 0
    origin: tuple[float, float, float]
    eave_z: float  # lowest vertex

    def z_at(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        nx, ny, nz = self.normal
        x0, y0, z0 = self.origin
        return z0 - (nx * (x - x0) + ny * (y - y0)) / nz

    @property
    def pitch_deg(self) -> float:
        return float(np.degrees(np.arccos(np.clip(self.normal[2], -1.0, 1.0))))


@dataclass
class Accent:
    centre: tuple[float, float]
    radius_m: float
    wall: int
    roof: int


@dataclass
class PreparedBuilding:
    feature_id: int
    bag_id: str
    footprint: BaseGeometry
    roofs: list[RoofPlane]
    wall: int
    roof_pitched: int
    roof_flat: int
    window_period: int  # 0 = no regular windows
    window_offset: int
    accent: Accent | None = None
    year: int | None = None
    facade: bool = False  # gets the facade grammar (not a landmark, not a church)
    shop: bool = False    # an OSM shop/amenity POI lies inside
    centre: bool = False  # old-centre look (colours.old_centre): limestone, plaster, slate
    hero: str | None = None  # hand-authored landmark model replacing the 3D BAG shape (heroes.py)


@dataclass
class SurfacePatch:
    """A ground-surface paint: ``shape`` TILE (roads) or FULL (grass etc.)."""

    geom: BaseGeometry
    colour: int
    shape: int
    priority: float
    feature_id: int = 0
    deck: "Deck | None" = None


@dataclass
class Deck:
    """Bridge deck following ``line`` with surface height linear from ``z0`` to ``z1``."""

    line: LineString
    z0: float
    z1: float
    body: int  # palette idx of the deck structure

    def z_at(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        import shapely

        t = shapely.line_locate_point(self.line, shapely.points(x, y), normalized=True)
        return self.z0 + (self.z1 - self.z0) * t


@dataclass
class WaterBody:
    geom: BaseGeometry
    level_m: float
    colour: int
    feature_id: int = 0


@dataclass
class TreeSpec:
    I: int
    J: int
    height_m: float
    crown_r_m: float
    leaf: int
    leaf_alt: int
    seed: int


@dataclass
class PreparedWorld:
    dtm: HeightGrid
    config: VoxelConfig
    registry: FeatureRegistry
    buildings: list[PreparedBuilding] = field(default_factory=list)
    patches: list[SurfacePatch] = field(default_factory=list)
    water: list[WaterBody] = field(default_factory=list)
    trees: list[TreeSpec] = field(default_factory=list)
    ground_rgb: object | None = None  # RGBGrid (optional ortho)
    streets: object | None = None  # streets.StreetContext
    facades: list = field(default_factory=list)  # facade_runs.RunPlan, sorted
    islands: list = field(default_factory=list)  # islands.IslandGroup: built apart, not in chunks
    heroes: list = field(default_factory=list)   # heroes.HeroPlan: hand-authored landmark models
    props: list = field(default_factory=list)    # street_props.Prop: lamps, bollards, benches
    _btree: STRtree | None = None
    _ptree: STRtree | None = None
    _wtree: STRtree | None = None
    _tree_ij: np.ndarray | None = None
    _facade_bb: np.ndarray | None = None

    def index(self) -> None:
        self._tree_ij = np.array([(t.I, t.J) for t in self.trees], dtype=np.int64).reshape(-1, 2)
        self._btree = STRtree([b.footprint for b in self.buildings])
        self.patches.sort(key=lambda p: p.priority)  # stable: paint order
        self._ptree = STRtree([p.geom for p in self.patches])
        self._wtree = STRtree([w.geom for w in self.water])

    def buildings_in(self, area: BaseGeometry) -> list[PreparedBuilding]:
        if self._btree is None:
            self.index()
        assert self._btree is not None
        return [self.buildings[i] for i in sorted(self._btree.query(area))]

    def patches_in(self, area: BaseGeometry) -> list[SurfacePatch]:
        if self._ptree is None:
            self.index()
        assert self._ptree is not None
        return [self.patches[i] for i in sorted(self._ptree.query(area))]  # priority order

    def water_in(self, area: BaseGeometry) -> list[WaterBody]:
        if self._wtree is None:
            self.index()
        assert self._wtree is not None
        return [self.water[i] for i in sorted(self._wtree.query(area))]

    def facades_near(self, i0: int, j0: int, i1: int, j1: int) -> list:
        """Detailed facade runs whose paint box touches ``[i0, i1) x [j0, j1)``, in paint order."""
        if self._facade_bb is None or len(self._facade_bb) != len(self.facades):
            self._facade_bb = np.array([r.bbox() for r in self.facades], np.int64).reshape(-1, 4)
        bb = self._facade_bb
        hit = (bb[:, 0] < i1) & (bb[:, 1] > i0) & (bb[:, 2] < j1) & (bb[:, 3] > j0)
        return [self.facades[n] for n in np.flatnonzero(hit) if self.facades[n].detail]

    def trees_near(self, i0: int, j0: int, i1: int, j1: int, margin: int) -> list[TreeSpec]:
        """Trees whose trunk lies within ``margin`` cells of the box ``[i0, i1) x [j0, j1)``."""
        if self._tree_ij is None:
            self.index()
        assert self._tree_ij is not None
        ij = self._tree_ij
        hit = (ij[:, 0] >= i0 - margin) & (ij[:, 0] < i1 + margin) & (ij[:, 1] >= j0 - margin) & (ij[:, 1] < j1 + margin)
        return [self.trees[i] for i in np.nonzero(hit)[0]]
