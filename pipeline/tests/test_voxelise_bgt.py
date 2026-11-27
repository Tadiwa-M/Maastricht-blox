"""BGT ground (accuracy A1): classification, paint order, kerbs, water, and the OSM fallback
outside the BGT area."""

import numpy as np
import pytest
from shapely.geometry import LineString, box

from blox_pipeline import geo
from blox_pipeline.geo import CellBox
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import BgtData, BgtFeature, HeightGrid, OsmFeature
from blox_pipeline.voxelise import VoxelConfig, build_layers, prepare_world
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.grid import FULL, TILE
from blox_pipeline.voxelise.layers import NONE
from blox_pipeline.voxelise.prepare_bgt import P_CARRIAGEWAY, P_CYCLE, P_FOOT, P_TERRAIN, classify

AREA = CellBox(256, 256, 448, 448)  # 96 x 96 m, RD 175828..175924 / 316628..316724
X0, Y0 = geo.grid_to_rd(AREA.i0, AREA.j0)
GROUND = 50.0
C = palette.idx


def wd(functie, material=None, surface="open verharding", layer="wegdeel", level=0, geom=None, **props):
    p = {"functie": functie, "fysiek_voorkomen": surface, "relatieve_hoogteligging": level, **props}
    if material:
        p["plus_fysiek_voorkomen"] = material
    return BgtFeature(layer, f"t.{functie}.{material}.{level}", p, geom if geom is not None else box(0, 0, 1, 1))


# ---------------------------------------------------------------------------- classify
@pytest.mark.parametrize("feat, centre, want", [
    (wd("rijbaan lokale weg", "asfalt", "gesloten verharding"), False, (P_CARRIAGEWAY, TILE, "asphalt")),
    (wd("rijbaan lokale weg", "gebakken klinkers"), False, (P_CARRIAGEWAY, TILE, "brick_brown")),
    (wd("rijbaan lokale weg", "sierbestrating"), True, (P_CARRIAGEWAY, TILE, "cobble_dark")),
    (wd("parkeervlak", "betonstraatstenen"), False, (P_CARRIAGEWAY, TILE, "cobble_grey")),
    (wd("OV-baan", None, "gesloten verharding"), False, (P_CARRIAGEWAY, TILE, "asphalt")),
    (wd("fietspad", "asfalt", "gesloten verharding"), False, (P_CYCLE, TILE, "brick_dark_red")),
    (wd("fietspad", "tegels"), False, (P_CYCLE, TILE, "pavement")),
    (wd("voetpad", "tegels"), False, (P_FOOT, TILE, "pavement")),
    (wd("voetgangersgebied", "sierbestrating"), True, (P_FOOT, TILE, "cobble_dark")),
    (wd("voetgangersgebied", "sierbestrating"), False, (P_FOOT, TILE, "cobble_grey")),
    (wd("voetpad op trap", "beton element"), False, (P_FOOT, TILE, "light_grey")),
    (wd("berm", None, "groenvoorziening", layer="ondersteunendwegdeel"), False, (P_TERRAIN, FULL, "grass")),
    (wd("verkeerseiland", "betonstraatstenen", layer="ondersteunendwegdeel"), False, (P_FOOT, TILE, "cobble_grey")),
    (wd(None, "heesters", "groenvoorziening", layer="begroeidterreindeel"), False, (P_TERRAIN, FULL, "grass")),
    (wd(None, None, "struiken", layer="begroeidterreindeel"), False, (P_TERRAIN, FULL, "grass_dark")),
    (wd(None, None, "onverhard", layer="onbegroeidterreindeel"), False, (P_TERRAIN, FULL, "soil")),
    (wd(None, "tegels", "open verharding", layer="onbegroeidterreindeel"), False, (P_TERRAIN, TILE, "pavement")),
])
def test_classify(feat, centre, want):
    c = classify(feat, centre)
    assert (c.priority, c.shape, c.colour) == want


def test_yards_and_water_are_not_ground_paint():
    assert classify(wd(None, None, "erf", layer="onbegroeidterreindeel")) is None
    assert classify(BgtFeature("waterdeel", "w", {"type": "waterloop"}, box(0, 0, 1, 1))) is None


# ---------------------------------------------------------------------------- whole world
def dtm() -> HeightGrid:
    big = AREA.grow(48)
    return HeightGrid(big.i0, big.j0, np.full((big.ni, big.nj), GROUND, np.float32))


def rd(dx, dy):
    return X0 + dx, Y0 + dy


def street_world(extent=None, extra=()):
    """A north-south OSM street (guessed 5.5 m wide) at x = 40 m; the BGT says the carriageway is
    3 m wide (x 38.5-41.5) with 2 m pavements and grass beyond, in the south half (y < 48 m)."""
    osm = OsmData()
    osm.roads.append(OsmFeature("way/1", {"highway": "residential", "name": "Teststraat"},
                                LineString([rd(40, 2), rd(40, 94)])))
    feats = [
        wd("rijbaan lokale weg", "asfalt", "gesloten verharding", geom=box(*rd(38.5, 0), *rd(41.5, 48))),
        wd("voetpad", "tegels", geom=box(*rd(36.5, 0), *rd(38.5, 48))),
        BgtFeature("wegdeel", "t.voetpad.east", {"functie": "voetpad", "plus_fysiek_voorkomen": "tegels",
                                                 "fysiek_voorkomen": "open verharding"},
                   box(*rd(41.5, 0), *rd(43.5, 48))),
        wd(None, None, "groenvoorziening", layer="begroeidterreindeel", geom=box(*rd(20, 0), *rd(36.5, 48))),
        *extra,
    ]
    ext = extent if extent is not None else box(*rd(0, 0), *rd(96, 48))
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData(feats, ext))
    return prepare_world(src, VoxelConfig(use_ortho_ground=False, street_props=False, ramps=False))


def ij(dx, dy):
    I, J = geo.rd_to_grid(*rd(dx, dy))
    return I - AREA.i0, J - AREA.j0


def test_bgt_polygons_paint_the_street_inside_the_bgt_area():
    world = street_world()
    L = build_layers(world, AREA)
    street = world.registry.get(int(L.ground_feat[ij(40, 20)]))
    assert street.name == "Teststraat"
    assert L.ground_color[ij(40, 20)] == C("asphalt")
    # OSM's guessed 5.5 m reached x = 42.75; the BGT says pavement from 41.5 m (kerb strip first)
    assert L.ground_color[ij(41.8, 20)] == C("limestone_dark")  # kerb just outside the carriageway
    assert L.ground_color[ij(43.0, 20)] == C("pavement")
    assert L.ground_color[ij(37.0, 20)] == C("pavement")
    assert L.ground_color[ij(30.0, 20)] == C("grass") and L.ground_shape[ij(30.0, 20)] == FULL
    assert L.ground_shape[ij(43.0, 20)] == TILE
    # the street's name stays on the BGT-painted cells within the OSM street
    assert L.ground_feat[ij(42.5, 20)] == L.ground_feat[ij(40, 20)]


def test_osm_fallback_outside_the_bgt_area():
    world = street_world()
    L = build_layers(world, AREA)
    north = ij(40, 70)  # y > 48 m: no BGT
    assert L.ground_color[north] == C("asphalt") and L.ground_feat[north] == L.ground_feat[ij(40, 20)]
    assert L.ground_color[ij(42.5, 70)] == C("asphalt")  # OSM's 5.5 m road
    assert L.ground_color[ij(43.0, 70)] == C("limestone_dark")  # OSM's kerb
    assert L.ground_color[ij(60.0, 70)] == C("grass")


def test_cells_the_bgt_leaves_alone_keep_the_default_ground():
    # inside the BGT area, east of the pavement nothing is mapped (a yard): the OSM road must not
    # spill its guessed width there
    world = street_world(extent=box(*rd(0, 0), *rd(96, 48)))
    L = build_layers(world, AREA)
    assert L.ground_color[ij(44.0, 20)] == C("grass")


def test_bgt_water_replaces_osm_water_and_takes_its_name_and_level():
    osm_river = OsmFeature("way/9", {"natural": "water", "name": "Maas"}, box(*rd(60, 0), *rd(90, 96)))
    bgt_river = BgtFeature("waterdeel", "w1", {"type": "waterloop", "relatieve_hoogteligging": 0},
                           box(*rd(64, 0), *rd(90, 96)))
    osm = OsmData(water=[osm_river])
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData([bgt_river], box(*rd(0, 0), *rd(96, 48))))
    cfg = VoxelConfig(use_ortho_ground=False, street_props=False, ramps=False)
    world = prepare_world(src, cfg)
    L = build_layers(world, AREA)
    wk = geo.z_to_k(cfg.maas_level_m)
    assert L.water_k[ij(62, 20)] == NONE  # OSM drew the bank too wide; the BGT says land
    assert L.water_k[ij(70, 20)] == wk
    assert L.water_k[ij(62, 70)] == wk  # outside the BGT area OSM's outline still holds
    fid = int(L.water_feat[ij(70, 20)])
    assert fid and world.registry.get(fid).name == "Maas" and L.water_feat[ij(62, 70)] == fid


def test_bridge_level_objects_are_not_ground():
    deck = wd("rijbaan lokale weg", "asfalt", level=1, geom=box(*rd(20, 0), *rd(36, 48)))
    world = street_world(extra=[deck])
    L = build_layers(world, AREA)
    assert L.ground_color[ij(30, 20)] == C("grass")


def test_street_props_keep_off_bgt_carriageways():
    world = street_world()
    assert world.carriageways is not None
    assert world.carriageways.contains(box(*rd(39, 1), *rd(41, 47)))
    assert not world.carriageways.intersects(box(*rd(42, 1), *rd(43, 47)))


def test_rails_still_draw_inside_the_bgt_area():
    rail = OsmFeature("way/7", {"railway": "rail"}, LineString([rd(10, 2), rd(10, 46)]))
    osm = OsmData(railways=[rail])
    bed = wd(None, None, "onverhard", layer="onbegroeidterreindeel", geom=box(*rd(0, 0), *rd(20, 48)))
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData([bed], box(*rd(0, 0), *rd(96, 48))))
    L = build_layers(prepare_world(src, VoxelConfig(use_ortho_ground=False, street_props=False, ramps=False)), AREA)
    assert L.ground_color[ij(10.4, 20)] == C("rail_brown")
    assert L.ground_color[ij(16, 20)] == C("soil")


def test_touching_water_parts_share_one_level():
    # the BGT splits a river at a bridge; only the southern part overlaps the named OSM river
    osm = OsmData(water=[OsmFeature("way/9", {"natural": "water", "name": "Maas"}, box(*rd(60, 0), *rd(90, 40)))])
    parts = [BgtFeature("waterdeel", f"w{k}", {"type": "waterloop"}, box(*rd(64, y0), *rd(90, y1)))
             for k, (y0, y1) in enumerate([(0, 40), (40, 60), (60, 96)])]
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData(parts, box(*rd(0, 0), *rd(96, 96))))
    cfg = VoxelConfig(use_ortho_ground=False, street_props=False, ramps=False)
    world = prepare_world(src, cfg)
    assert {w.level_m for w in world.water} == {cfg.maas_level_m}
    assert len({w.feature_id for w in world.water}) == 1 and world.water[0].feature_id


def test_shared_sett_streets_get_no_kerb():
    sett = wd("rijbaan lokale weg", "sierbestrating", geom=box(*rd(38.5, 0), *rd(41.5, 48)))
    foot = wd("voetgangersgebied", "sierbestrating", geom=box(*rd(41.5, 0), *rd(50, 48)))
    src = SourceData(dtm(), None, [], OsmData(), None, bgt=BgtData([sett, foot], box(*rd(0, 0), *rd(96, 48))))
    L = build_layers(prepare_world(src, VoxelConfig(use_ortho_ground=False, street_props=False, ramps=False)), AREA)
    assert L.ground_color[ij(41.8, 20)] == L.ground_color[ij(45, 20)]
