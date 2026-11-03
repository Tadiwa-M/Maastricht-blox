"""Canopies (accuracy A3): roof slab at the DSM height, posts off the carriageway, open below."""

import numpy as np
from shapely.geometry import box

from blox_pipeline import geo
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import BgtData, BgtFeature, HeightGrid
from blox_pipeline.voxelise import VoxelConfig, build_layers, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.canopies import SLAB_PLATES, post_points
from blox_pipeline.voxelise.layers import NONE

from test_voxelise_bgt import AREA, GROUND, dtm, ij, rd, wd

CFG = dict(use_ortho_ground=False, street_props=False, ramps=False, facade_detail=False, terrain_smooth_m=0)
ROOF = GROUND + 4.6


def canopy_world(with_dsm=True, **cfg):
    """A 24 x 16 m canopy (x 10-34, y 10-26 m) over a bus lane (x 20-24 m)."""
    roof = BgtFeature("overigbouwwerk", "c", {"type": "overkapping", "relatieve_hoogteligging": 1},
                      box(*rd(10, 10), *rd(34, 26)))
    lane = wd("OV-baan", "asfalt", "gesloten verharding", geom=box(*rd(20, 0), *rd(24, 48)))
    dsm = None
    if with_dsm:
        d = dtm()
        dsm = HeightGrid(d.I0, d.J0, np.full_like(d.values, np.nan))
        i0, j0 = geo.rd_to_grid(*rd(10, 10))
        i1, j1 = geo.rd_to_grid(*rd(34, 26))
        dsm.values[i0 - d.I0:i1 - d.I0, j0 - d.J0:j1 - d.J0] = ROOF
    src = SourceData(dtm(), dsm, [], OsmData(), None, bgt=BgtData([roof, lane], box(*rd(0, 0), *rd(96, 96))))
    return prepare_world(src, VoxelConfig(**{**CFG, **cfg}))


def test_roof_at_the_surface_height_and_posts_off_the_bus_lane():
    world = canopy_world()
    (c,) = world.canopies
    assert abs(c.top_z - ROOF) < 1e-4
    xs = [p.x - rd(0, 0)[0] for p in c.posts.geoms]
    assert xs and not any(19.5 <= x <= 24.5 for x in xs)
    L = build_layers(world, AREA)
    assert L.canopy_k[ij(15, 15)] == geo.z_to_k(c.top_z)
    assert L.canopy_k[ij(15, 30)] == NONE


def test_open_underneath_slab_on_top_posts_reach_the_ground():
    world = canopy_world()
    box_c = geo.CellBox(AREA.i0, AREA.j0, AREA.i0 + 64, AREA.j0 + 64)
    t = voxelise_tile(world, build_layers(world, box_c.grow(16)), box_c)
    (c,) = world.canopies
    top, gk = geo.z_to_k(c.top_z), geo.z_to_k(GROUND)
    i, j = ij(22, 18)  # over the bus lane: no post
    k = lambda K: K - t.k0
    assert t.color[i, j, k(top)] == palette.idx("light_grey")
    assert t.color[i, j, k(top - SLAB_PLATES + 1)] != 0
    assert (t.color[i, j, k(gk + 1):k(top - SLAB_PLATES + 1)] == 0).all()  # a bus fits under it
    p = c.posts.geoms[0]
    I, J = geo.rd_to_grid(p.x, p.y)
    assert (t.color[I - t.I0, J - t.J0, k(gk + 1):k(top - SLAB_PLATES + 1)] == palette.idx("metal")).all()


def test_without_dsm_the_default_height_and_switch_off():
    (c,) = canopy_world(with_dsm=False).canopies
    assert abs(c.top_z - (GROUND + 4.5)) < 1e-6
    assert canopy_world(canopies=False).canopies == []


def test_small_outline_gets_one_central_post():
    pts = post_points(box(0, 0, 4, 3), None)
    assert len(pts.geoms) == 1 and abs(pts.geoms[0].x - 2) < 1e-9
