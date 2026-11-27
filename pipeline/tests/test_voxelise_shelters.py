"""Bus shelters (accuracy A3) at OSM stops tagged shelter=yes."""

from shapely.geometry import Point, box

from blox_pipeline import geo
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import BgtData, OsmFeature
from blox_pipeline.voxelise import VoxelConfig, build_layers, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.canopies import SLAB_PLATES
from blox_pipeline.voxelise.shelters import LENGTH_M, KERB_GAP_M, shelter_outline, wants_shelter

from test_voxelise_bgt import AREA, GROUND, dtm, ij, rd, wd

CFG = dict(use_ortho_ground=False, street_props=False, ramps=False, facade_detail=False, terrain_smooth_m=0)


def stop(osm_id, x, y, **tags):
    return OsmFeature(osm_id, {"highway": "bus_stop", "shelter": "yes", **tags}, Point(*rd(x, y)))


def lane_world(stops, **cfg):
    """A north-south bus lane at x 20-26 m; stops beside it."""
    lane = wd("rijbaan lokale weg", "asfalt", "gesloten verharding", geom=box(*rd(20, 0), *rd(26, 96)))
    osm = OsmData(pois=list(stops))
    src = SourceData(dtm(), None, [], osm, None, bgt=BgtData([lane], box(*rd(0, 0), *rd(96, 96))))
    return prepare_world(src, VoxelConfig(**{**CFG, **cfg}))


def test_tags():
    assert wants_shelter({"highway": "bus_stop", "shelter": "yes"})
    assert wants_shelter({"public_transport": "platform", "shelter": "yes"})
    assert not wants_shelter({"highway": "bus_stop", "shelter": "no"})
    assert not wants_shelter({"amenity": "shelter"})


def test_shelter_stands_beside_the_lane_with_its_back_away_from_it():
    lane = box(*rd(20, 0), *rd(26, 96))
    roof, wall, posts = shelter_outline(Point(*rd(27, 40)), lane)
    x0, y0, x1, y1 = roof.bounds
    assert abs((x0 - rd(0, 0)[0]) - 27) < 1e-6  # already more than KERB_GAP_M off: stays
    roof2, _, _ = shelter_outline(Point(*rd(26.25, 40)), lane)
    assert abs((roof2.bounds[0] - rd(0, 0)[0]) - (26 + KERB_GAP_M)) < 1e-6  # too close: moved out
    assert abs((y1 - y0) - LENGTH_M) < 1e-6  # long side along the road
    assert wall.bounds[0] > x0 and abs(wall.bounds[2] - x1) < 1e-6  # glass at the back (east)
    assert all(p.x < wall.bounds[0] for p in posts.geoms)


def test_a_stop_node_on_the_carriageway_steps_out_of_it():
    lane = box(*rd(20, 0), *rd(26, 96))
    roof, _, _ = shelter_outline(Point(*rd(24.5, 40)), lane)
    assert not roof.intersects(lane)


def test_built_into_the_world_once_per_stop():
    world = lane_world([stop("node/1", 27, 20), stop("node/2", 28, 22, public_transport="platform"),
                        stop("node/3", 18, 70), OsmFeature("node/4", {"highway": "bus_stop"}, Point(*rd(27, 80)))])
    assert len(world.canopies) == 2  # node/2 is the same stop as node/1; node/4 has no shelter
    box_c = geo.CellBox(AREA.i0, AREA.j0, AREA.i0 + 64, AREA.j0 + 64)
    t = voxelise_tile(world, build_layers(world, box_c.grow(16)), box_c)
    top = geo.z_to_k(world.canopies[0].top_z)
    gk = geo.z_to_k(GROUND)
    k = lambda K: K - t.k0
    i, j = ij(27.4, 20.2)  # under the roof, front: open
    assert t.color[i, j, k(top)] == palette.idx("dark_grey")
    assert (t.color[i, j, k(gk + 1):k(top - SLAB_PLATES + 1)] == 0).all()
    i, j = ij(28.4, 20.2)  # the back row: glass
    assert (t.color[i, j, k(gk + 1):k(top - SLAB_PLATES + 1)] == palette.idx("glass_light")).all()


def test_switch_off():
    world = lane_world([stop("node/1", 27, 40)], shelters=False)
    assert world.canopies == []


def test_no_room_no_shelter():
    from blox_pipeline.sources.model import BgtFeature

    lane = wd("rijbaan lokale weg", "asfalt", "gesloten verharding", geom=box(*rd(20, 0), *rd(26, 96)))
    river = BgtFeature("waterdeel", "w", {"type": "waterloop"}, box(*rd(27.5, 0), *rd(60, 96)))
    src = SourceData(dtm(), None, [], OsmData(pois=[stop("node/1", 27, 20)]), None,
                     bgt=BgtData([lane, river], box(*rd(0, 0), *rd(96, 96))))
    assert prepare_world(src, VoxelConfig(**CFG)).canopies == []
