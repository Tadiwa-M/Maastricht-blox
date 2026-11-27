"""BGT bridges (accuracy A2): deck height, piers, railings, OSM decks replaced."""

import numpy as np
from shapely.geometry import LineString, box

from blox_pipeline import geo
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import BgtData, BgtFeature, OsmFeature
from blox_pipeline.voxelise import VoxelConfig, build_layers, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.bridges import deck_axis
from blox_pipeline.voxelise.layers import NONE
from blox_pipeline.catalogue import load_catalogue

from test_voxelise_bgt import AREA, GROUND, dtm, ij, rd, wd

CFG = dict(use_ortho_ground=False, street_props=False, ramps=False, facade_detail=False)


def river_world(osm_bridge=False, **cfg):
    """A 40 m river (x 30-70 m) crossed east-west by a 6 m BGT bridge at y 40-46 m, a footway
    on it (level 1); the Maas level sits 6 m below the 50 m ground."""
    river = BgtFeature("waterdeel", "w", {"type": "waterloop"}, box(*rd(30, 0), *rd(70, 96)))
    deck = BgtFeature("overbruggingsdeel", "b", {"relatieve_hoogteligging": 1, "hoort_bij_typeoverbrugging": "brug"},
                      box(*rd(28, 40), *rd(72, 46)))
    walk = wd("voetpad", "tegels", level=1, geom=box(*rd(28, 40), *rd(72, 46)))
    osm = OsmData(water=[OsmFeature("way/9", {"natural": "water", "name": "Maas"}, box(*rd(30, 0), *rd(70, 96)))])
    if osm_bridge:
        osm.roads.append(OsmFeature("way/5", {"highway": "footway", "bridge": "yes", "name": "Testbrug"},
                                    LineString([rd(25, 43), rd(75, 43)])))
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData([river, deck, walk], box(*rd(0, 0), *rd(96, 96))))
    return prepare_world(src, VoxelConfig(maas_level_m=GROUND - 6.0, **{**CFG, **cfg}))


def test_axis_runs_along_the_long_side():
    a = deck_axis(box(0, 0, 40, 6))
    assert a.length == 40 and {a.coords[0][1], a.coords[1][1]} == {3.0}


def test_deck_sits_at_road_height_and_spans_the_river():
    world = river_world()
    L = build_layers(world, AREA)
    gk = geo.z_to_k(GROUND)
    assert L.deck_k[ij(50, 43)] in (gk, gk + 1)  # level with the streets at both ends
    assert L.deck_top[ij(50, 43)] == palette.idx("pavement")
    assert L.water_k[ij(50, 43)] != NONE  # the river runs on under it
    assert L.deck_k[ij(50, 30)] == NONE


def test_piers_stand_in_the_water_only():
    L = build_layers(river_world(), AREA)
    piers = np.argwhere(L.deck_pier == 1)
    assert len(piers)
    x = AREA.i0 + piers[:, 0]
    xs = geo.X0 + (x + 0.5) * geo.STUD_M - (geo.X0 + AREA.i0 * geo.STUD_M)
    assert xs.min() > 30 and xs.max() < 70  # never on the banks


def test_railings_line_both_sides_but_not_the_ends():
    world = river_world()
    box_c = geo.CellBox(AREA.i0 + 64, AREA.i0 + 64, AREA.i0 + 128, AREA.i0 + 128)  # chunk with the mid-span
    layers = build_layers(world, box_c.grow(16))
    tile = voxelise_tile(world, layers, box_c)
    cat = load_catalogue()
    rails = [r for r in (tile.placed if tile.placed is not None else []) if r["type"] == cat["railing_1x2"].id]
    assert len(rails) > 20
    js = {int(r["J"]) for r in rails}
    j_lo, j_hi = geo.rd_to_grid(*rd(0, 40))[1], geo.rd_to_grid(*rd(0, 46))[1] - 1
    assert js <= {j_lo, j_hi} and len(js) == 2  # the two long edges only
    gk = int(layers.deck_k[ij(50, 43)[0] + AREA.i0 - box_c.grow(16).i0, ij(50, 43)[1] + AREA.j0 - box_c.grow(16).j0])
    assert {int(r["K"]) for r in rails} == {gk + 1}


def test_bgt_bridge_replaces_the_osm_deck_and_takes_its_name():
    world = river_world(osm_bridge=True)
    osm_decks = [p for p in world.patches if p.deck is not None and p.priority < 45]
    assert not osm_decks
    L = build_layers(world, AREA)
    fid = int(L.deck_feat[ij(50, 43)])
    assert fid and world.registry.get(fid).name == "Testbrug"


def test_no_railings_when_switched_off():
    world = river_world(railings=False)
    box_c = geo.CellBox(AREA.i0 + 64, AREA.i0 + 64, AREA.i0 + 128, AREA.i0 + 128)
    tile = voxelise_tile(world, build_layers(world, box_c.grow(16)), box_c)
    assert tile.placed is None or len(tile.placed) == 0


def test_mapped_pier_islands_carry_the_deck_instead_of_regular_slabs():
    # a 4 x 12 m pier island in the river under the bridge (x 48-52 m, y 37-49 m)
    river = BgtFeature("waterdeel", "w", {"type": "waterloop"},
                       box(*rd(30, 0), *rd(70, 96)).difference(box(*rd(48, 37), *rd(52, 49))))
    deck = BgtFeature("overbruggingsdeel", "b", {"relatieve_hoogteligging": 1}, box(*rd(28, 40), *rd(72, 46)))
    osm = OsmData(water=[OsmFeature("way/9", {"natural": "water", "name": "Maas"}, river.geom)])
    grid = dtm()
    i0, j0 = geo.rd_to_grid(*rd(48, 37))
    i1, j1 = geo.rd_to_grid(*rd(52, 49))
    grid.values[i0 - grid.I0:i1 - grid.I0, j0 - grid.J0:j1 - grid.J0] = GROUND - 4.5  # the island: 1.5 m above the river
    src = SourceData(grid, None, [], osm, None, bgt=BgtData([river, deck], box(*rd(0, 0), *rd(96, 96))))
    L = build_layers(prepare_world(src, VoxelConfig(maas_level_m=GROUND - 6.0, **{**CFG, "terrain_smooth_m": 0})), AREA)
    piers = np.argwhere(L.deck_pier == 1)
    xs = AREA.i0 + piers[:, 0]
    lo, hi = geo.rd_to_grid(*rd(48, 0))[0], geo.rd_to_grid(*rd(52, 0))[0]
    assert len(piers) and xs.min() >= lo and xs.max() <= hi  # only on the island
