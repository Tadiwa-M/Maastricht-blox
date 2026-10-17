"""Turn loaded sources into a :class:`PreparedWorld` (deterministic feature ids)."""

from __future__ import annotations

from ..sources import SourceData
from .features import FeatureRegistry
from .prepare_buildings import prepare_buildings
from .prepare_osm import prepare_landuse, prepare_roads, prepare_trees, prepare_water, register_pois
from .world import PreparedWorld, VoxelConfig


def prepare_world(src: SourceData, cfg: VoxelConfig | None = None) -> PreparedWorld:
    cfg = cfg or VoxelConfig()
    reg = FeatureRegistry()
    # registration order fixes the ids: buildings (by BAG id), then OSM groups (by osm id)
    buildings = prepare_buildings(src.buildings, src.osm, reg)
    water = prepare_water(src.osm, src.dtm, cfg, reg)
    patches = prepare_landuse(src.osm, reg) + prepare_roads(src.osm, src.dtm, water, cfg, reg)
    register_pois(src.osm, reg)
    world = PreparedWorld(
        dtm=src.dtm, config=cfg, registry=reg, buildings=buildings, patches=patches, water=water,
        trees=prepare_trees(src.osm, src.dtm, src.dsm),
        ground_rgb=src.ortho if cfg.use_ortho_ground else None,
    )
    world.index()
    return world
