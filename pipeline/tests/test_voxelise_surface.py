"""Terrain, roads, water, bridges, trees and tile-border consistency."""

import numpy as np
import pytest
from shapely.geometry import LineString, Point, box

from blox_pipeline import geo
from blox_pipeline.geo import CellBox
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import HeightGrid, OsmFeature
from blox_pipeline.voxelise import build_features, build_layers, iter_chunk_tiles, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.grid import FULL, TILE, WATER
from blox_pipeline.voxelise.prepare_osm import parse_width

AREA = CellBox(256, 256, 448, 448)  # chunks 4..6 (x and y), RD 175828..175924 / 316628..316724
X0, Y0 = geo.grid_to_rd(AREA.i0, AREA.j0)
GROUND = 50.0
GK = geo.z_to_k(GROUND)


def dtm(values=None) -> HeightGrid:
    big = AREA.grow(48)
    v = np.full((big.ni, big.nj), GROUND, np.float32) if values is None else values
    return HeightGrid(big.i0, big.j0, v)


def world_for(osm: OsmData, grid: HeightGrid | None = None, **cfg):
    from blox_pipeline.voxelise import VoxelConfig

    return prepare_world(SourceData(grid or dtm(), None, [], osm, None), VoxelConfig(**cfg))


def tile_for(world, b: CellBox):
    return voxelise_tile(world, build_layers(world, b.grow(16)), b)


def cell(t, I, J, K):
    return t.at(I, J, K)


def rd(dx, dy):
    return X0 + dx, Y0 + dy


def test_parse_width():
    assert parse_width({"width": "7"}) == 7.0
    assert parse_width({"width": "6,5 m"}) == 6.5
    assert parse_width({"width": "wide", "lanes": "2"}) == 6.5
    assert parse_width({}) is None


def test_road_is_tile_layer_on_terrain():
    road = OsmFeature("way/1", {"highway": "residential", "name": "Teststraat", "width": "6"},
                      LineString([rd(0, 16), rd(31, 16)]))
    world = world_for(OsmData(roads=[road]))
    t = tile_for(world, CellBox(256, 256, 320, 320))
    I, J = geo.rd_to_grid(*rd(15, 16))
    c, f, s = cell(t, I, J, GK)
    assert (c, s) == (palette.idx("asphalt"), TILE) and f >= 1
    assert t.column_top(I, J) == GK  # flush with the ground, not stacked on it
    assert cell(t, I, J, GK - 1)[0] == palette.idx("soil")
    # 6 m wide: 12 cells across, grass beyond
    Jn = geo.rd_to_grid(*rd(15, 19.25))[1]
    assert cell(t, I, Jn, GK)[2] == FULL and cell(t, I, Jn, GK)[0] == palette.idx("grass")
    feats = build_features(world.registry)["features"]
    assert feats == [{"id": f, "kind": "street", "name": "Teststraat", "osmId": "way/1",
                      "centroid": feats[0]["centroid"], "bboxIJ": feats[0]["bboxIJ"]}]


def test_pedestrian_in_centre_is_cobbled():
    vrijthof = (176185.0, 317717.0)
    line = LineString([(vrijthof[0] - 20, vrijthof[1]), (vrijthof[0] + 20, vrijthof[1])])
    osm = OsmData(roads=[OsmFeature("way/2", {"highway": "pedestrian"}, line)])
    I, J = geo.rd_to_grid(*vrijthof)
    b = CellBox(I - 32, J - 32, I + 32, J + 32)
    g = HeightGrid(b.i0 - 40, b.j0 - 40, np.full((b.ni + 80, b.nj + 80), GROUND, np.float32))
    t = tile_for(world_for(osm, g), b)
    assert cell(t, I, J, GK)[:3:2] == (palette.idx("cobble_grey"), TILE)


def test_water_surface_and_bed():
    pond = OsmFeature("relation/9", {"natural": "water", "water": "river", "name": "Maas"},
                      box(*rd(5, 5), *rd(28, 28)))
    world = world_for(OsmData(water=[pond]), maas_level_m=44.1, water_depth_m=0.6)
    t = tile_for(world, CellBox(256, 256, 320, 320))
    I, J = geo.rd_to_grid(*rd(15, 15))
    wk = geo.z_to_k(44.1)
    assert t.column_top(I, J) == wk
    assert cell(t, I, J, wk)[0] == palette.idx("water") and cell(t, I, J, wk)[2] == WATER
    assert cell(t, I, J, wk - 1)[:3:2] == (palette.idx("water"), FULL)
    assert cell(t, I, J, wk - 3)[0] == palette.idx("soil")  # bed below 0.6 m of water
    assert cell(t, I, J, wk + 1)[0] == 0
    # bank: terrain outside is closed down to the bed (no hole in the side wall)
    Ib, _ = geo.rd_to_grid(*rd(4.9, 15))
    col = t.color[Ib - t.I0, J - t.J0]
    assert all(col[k - t.k0] != 0 for k in range(wk - 3, GK + 1))
    [feat] = build_features(world.registry)["features"]
    assert feat["kind"] == "water" and feat["name"] == "Maas"


def test_bank_level_for_small_water():
    pond = OsmFeature("way/5", {"natural": "water"}, box(*rd(10, 10), *rd(20, 20)))
    world = world_for(OsmData(water=[pond]))
    assert world.water[0].level_m == pytest.approx(GROUND - 0.3)


def test_bridge_deck_spans_water():
    river = OsmFeature("way/7", {"natural": "water", "name": "Maas"}, box(*rd(0, 10), *rd(32, 24)))
    bridge = OsmFeature("way/8", {"highway": "secondary", "bridge": "yes", "layer": "1", "name": "Brug"},
                        LineString([rd(16, 2), rd(16, 30)]))
    world = world_for(OsmData(water=[river], roads=[bridge]), maas_level_m=48.0)
    assert world.patches[-1].deck is not None
    low = world_for(OsmData(water=[river], roads=[bridge]), maas_level_m=49.5)
    assert low.patches[-1].deck.z0 == pytest.approx(51.0)  # lifted to water + clearance
    t = tile_for(world, CellBox(256, 256, 320, 320))
    I, J = geo.rd_to_grid(*rd(16, 17))
    deck_k = GK  # endpoints rest on the 50 m banks, well above water + 1.5 m clearance
    assert t.column_top(I, J) == deck_k
    assert cell(t, I, J, deck_k)[:3:2] == (palette.idx("asphalt"), TILE)
    assert cell(t, I, J, deck_k - 1)[0] == palette.idx("light_grey")
    assert cell(t, I, J, deck_k - 3)[0] == 0  # clearance above the water
    assert cell(t, I, J, geo.z_to_k(48.0))[2] == WATER


def test_trees_are_deterministic_and_avoid_buildings():
    osm = OsmData(trees=[OsmFeature("node/3", {"natural": "tree"}, Point(rd(16, 16)))])
    t1 = tile_for(world_for(osm), CellBox(256, 256, 320, 320))
    t2 = tile_for(world_for(osm), CellBox(256, 256, 320, 320))
    assert np.array_equal(t1.color, t2.color)
    I, J = geo.rd_to_grid(*rd(16, 16))
    assert cell(t1, I, J, GK + 1)[0] == palette.idx("trunk")
    leaves = np.isin(t1.color, [palette.idx("leaf"), palette.idx("leaf_light")])
    assert leaves.sum() > 50
    assert t1.column_top(I, J) > GK + 25  # >= 6 m tall


def test_steep_terrain_has_no_gaps():
    v = dtm().values.copy()
    v[: v.shape[0] // 2] = 60.0  # 10 m cliff running north-south
    world = world_for(OsmData(), dtm(v))
    t = tile_for(world, CellBox(256, 256, 320, 320))
    for i in range(t.dims[0]):
        col = t.color[i, 5]
        nz = np.nonzero(col)[0]
        assert len(nz) == nz[-1] - nz[0] + 1  # contiguous column
    lo_bottom = np.nonzero(t.color[t.dims[0] // 2 + 10, 5])[0][0]
    hi_cells = np.nonzero(t.color[t.dims[0] // 2 - 1, 5])[0]
    assert hi_cells[0] <= lo_bottom + 3  # cliff face closed down to the low side


def test_tile_borders_agree_with_neighbours():
    road = OsmFeature("way/1", {"highway": "primary"}, LineString([rd(0, 30), rd(90, 34)]))
    tree = OsmFeature("node/3", {"natural": "tree"}, Point(rd(31.8, 20)))
    world = world_for(OsmData(roads=[road], trees=[tree]))
    tiles = {(cx, cy): t for cx, cy, t in iter_chunk_tiles(world, CellBox(256, 256, 384, 320))}
    assert set(tiles) == {(4, 4), (5, 4)}
    a, b = tiles[(4, 4)], tiles[(5, 4)]
    assert a.dims[:2] == (66, 66) and (a.I0, a.J0) == (255, 255)
    # a's east border column (I = 320) must equal b's first interior column
    for I in (319, 320):
        for J in range(256, 320, 7):
            for K in range(min(a.k0, b.k0), max(a.k0 + a.dims[2], b.k0 + b.dims[2])):
                assert a.at(I, J, K) == b.at(I, J, K)
