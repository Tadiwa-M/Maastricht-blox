"""Turn loaded sources into a :class:`PreparedWorld` (deterministic feature ids)."""

from __future__ import annotations

from dataclasses import replace

from ..sources import SourceData
from .features import FeatureRegistry
from .prepare_buildings import prepare_buildings
from .facade_runs import plan_facades
from .heroes import take_heroes
from .street_props import plan_props
from .bridges import prepare_bgt_bridges
from .canopies import plan_canopies
from .prepare_bgt import carriageways, prepare_bgt_ground, prepare_bgt_water
from .prepare_osm import P_RAIL, island_paving, outside_bgt, prepare_landuse, prepare_roads, prepare_trees, prepare_water, register_pois
from .streets import street_context
from .terrain_smooth import smooth_heights
from .world import PreparedWorld, VoxelConfig


def bgt_decks(patches: list, bgt, dtm, water, cfg: VoxelConfig) -> list:
    """BGT bridges replace the OSM bridge decks they overlap (accuracy A2); rail decks
    (``P_RAIL`` and up) stay, the rails are drawn on their own deck."""
    from shapely import STRtree

    decks = prepare_bgt_bridges(bgt, dtm, water, cfg, named=[(p.geom, p.feature_id) for p in patches
                                                             if p.deck is not None and p.priority < P_RAIL])
    if not decks:
        return patches
    tree = STRtree([d.geom for d in decks])
    out = []
    for p in patches:
        if p.deck is not None and p.priority < P_RAIL and len(tree.query(p.geom, predicate="intersects")):
            p = replace(p, deck=None)
        out.append(p)
    return out + decks


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
    bgt = src.bgt
    extent = bgt.extent if bgt is not None and bgt.extent is not None and not bgt.extent.is_empty else None
    water = prepare_water(src.osm, src.dtm, cfg, reg, outside=extent)
    if bgt is not None:  # inside the BGT area its polygons are the ground (prepare_bgt.py)
        water += prepare_bgt_water(bgt, src.osm, src.dtm, cfg, reg)
    patches = prepare_landuse(src.osm, reg) + prepare_roads(src.osm, src.dtm, water, cfg, reg)
    if extent is not None:
        patches = outside_bgt(patches, extent)
    if bgt is not None:
        patches += prepare_bgt_ground(bgt)
        patches = bgt_decks(patches, bgt, src.dtm, water, cfg)
    patches += island_paving(islands)
    register_pois(src.osm, reg)
    world = PreparedWorld(
        dtm=src.dtm, config=cfg, registry=reg, buildings=buildings, patches=patches, water=water,
        trees=prepare_trees(src.osm, src.dtm, src.dsm),
        ground_rgb=src.ortho if cfg.use_ortho_ground else None,
        streets=street_context(src.osm), islands=islands,
        carriageways=carriageways(bgt) if bgt is not None else None, bgt_extent=extent,
    )
    if cfg.canopies and bgt is not None:  # free-standing roofs: the station's bus and platform canopies
        world.canopies = plan_canopies(bgt, src.dtm, src.dsm, world.carriageways)
    world.index()
    if cfg.heroes:  # hand-authored landmark models replace their 3D BAG shape
        take_heroes(world)
    if cfg.street_props:
        world.props = plan_props(world, src.osm)
    if cfg.facade_detail:
        world.facades = plan_facades(world)
    return world
