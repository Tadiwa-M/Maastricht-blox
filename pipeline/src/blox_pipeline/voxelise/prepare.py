"""Turn loaded sources into a :class:`PreparedWorld` (deterministic feature ids)."""

from __future__ import annotations

from dataclasses import replace

from ..sources import SourceData
from .features import FeatureRegistry
from .prepare_buildings import prepare_buildings
from .facade_runs import plan_facades
from .prepare_osm import island_paving, prepare_landuse, prepare_roads, prepare_trees, prepare_water, register_pois
from .streets import street_context
from .terrain_smooth import smooth_heights
from .world import PreparedWorld, VoxelConfig


def prepare_world(src: SourceData, cfg: VoxelConfig | None = None) -> PreparedWorld:
    cfg = cfg or VoxelConfig()
    if cfg.terrain_smooth_m > 0:
        src = replace(src, dtm=smooth_heights(src.dtm, cfg.terrain_smooth_m))
    reg = FeatureRegistry()
    # registration order fixes the ids: buildings (by BAG id), then OSM groups (by osm id)
    buildings = prepare_buildings(src.buildings, src.osm, reg)
    islands: list = []
    if cfg.islands:  # turned buildings leave the world grid; their footprint is paved instead
        from ..islands.group import plan_islands

        islands, buildings = plan_islands(buildings, cfg.island_min_yaw_deg)
    water = prepare_water(src.osm, src.dtm, cfg, reg)
    patches = prepare_landuse(src.osm, reg) + prepare_roads(src.osm, src.dtm, water, cfg, reg)
    patches += island_paving(islands)
    register_pois(src.osm, reg)
    world = PreparedWorld(
        dtm=src.dtm, config=cfg, registry=reg, buildings=buildings, patches=patches, water=water,
        trees=prepare_trees(src.osm, src.dtm, src.dsm),
        ground_rgb=src.ortho if cfg.use_ortho_ground else None,
        streets=street_context(src.osm), islands=islands,
    )
    world.index()
    if cfg.facade_detail:
        world.facades = plan_facades(world)
    return world
