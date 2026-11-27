"""Stadium stands (stands.py): detection from 3D BAG rings + OSM tags, the seating rake profile,
the roof kept over it, outer facades kept, and the same result on a turned (island) stadium."""

import numpy as np
import pytest
from shapely import affinity
from shapely.geometry import Point, Polygon, box

from blox_pipeline import geo
from blox_pipeline.geo import CellBox
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.model import Building, HeightGrid, OsmFeature, Surface
from blox_pipeline.sources.osm_classify import classify_area
from blox_pipeline.voxelise import VoxelConfig, build_layers, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.layers import NONE
from blox_pipeline.voxelise.stands import (
    AISLE, AISLE_EVERY_M, BODY, FRONT_PLATES, HEADROOM_PLATES, MAX_CLEAR_PLATES, RISE_PLATES, ROOF_PLATES,
    ROOF_UNDER, SEAT_PLATES, SEAT_RED, SEAT_WHITE, pitch_ring, plan_stadiums, rake, seat_colour, stand_column,
)

GROUND = 50.0
GK = geo.z_to_k(GROUND)  # 100
ROOF_Z = GROUND + 12.0
ROOF_K = geo.z_to_k(ROOF_Z)  # 160
X0, Y0 = 176000.0, 317000.0  # grid cell (600, 1000): the outline lies on cell boundaries
OUTER = box(X0, Y0, X0 + 120, Y0 + 100)
PITCH = box(X0 + 20, Y0 + 20, X0 + 100, Y0 + 80)  # 80 x 60 m: the S stand is 20 m deep
FRONT_K = GK + FRONT_PLATES
CFG = dict(use_ortho_ground=False, street_props=False, ramps=False, terrain_smooth_m=0)


def ring_building(bag_id: str = "NL.IMBAG.Pand.stadium", outer=OUTER, pitch=PITCH, z=ROOF_Z) -> Building:
    def ring3(poly, h):
        c = np.asarray(poly.exterior.coords)[:-1]
        return np.column_stack([c, np.full(len(c), h)])

    roof = Surface("roof", ring3(outer, z), [ring3(pitch, z)])
    ground = Surface("ground", ring3(outer, GROUND)[::-1].copy(), [ring3(pitch, GROUND)[::-1].copy()])
    attrs = {"identificatie": bag_id, "oorspronkelijkbouwjaar": 2001, "b3_h_maaiveld": GROUND, "b3_h_dak_max": z}
    return Building(bag_id, attrs, "2.2", [roof, ground])


def flat_dtm(margin_m: float = 60.0) -> HeightGrid:
    i0, j0 = geo.rd_to_grid(X0 - margin_m, Y0 - margin_m)
    n = int((120 + 2 * margin_m) / geo.STUD_M)
    return HeightGrid(i0, j0, np.full((n, n), GROUND, np.float32))


def stadium_osm(geom=OUTER) -> OsmData:
    """A named leisure=stadium area: in ``stadiums`` and, being named, in ``pois`` (classify_area)."""
    f = OsmFeature("way/1", {"leisure": "stadium", "name": "Stadion"}, geom)
    return OsmData(stadiums=[f], pois=[f])


def world_of(buildings, osm, **cfg):
    return prepare_world(SourceData(flat_dtm(), None, buildings, osm, None), VoxelConfig(**{**CFG, **cfg}))


# ---------------------------------------------------------------------------- detection
def test_osm_leisure_stadium_is_kept_named_or_not():
    assert "stadiums" in classify_area({"leisure": "stadium"})
    assert {"pois", "stadiums"} <= set(classify_area({"leisure": "stadium", "name": "De Geusselt"}))
    assert "stadiums" not in classify_area({"leisure": "pitch"})


def test_pitch_ring_is_the_largest_big_hole():
    ring = OUTER.difference(PITCH)
    assert pitch_ring(ring).equals(PITCH)
    assert pitch_ring(OUTER) is None
    courtyard = OUTER.difference(box(X0 + 50, Y0 + 40, X0 + 60, Y0 + 50))  # 100 m2: a courtyard
    assert pitch_ring(courtyard) is None


def test_stadium_needs_a_ring_and_an_osm_stadium():
    world = world_of([ring_building()], stadium_osm())
    (b,) = world.buildings
    assert b.pitch is not None and b.pitch.equals(PITCH) and b.pitch_z == pytest.approx(GROUND)
    assert world.registry.get(b.feature_id).name == "Stadion"  # from the leisure=stadium area
    assert world_of([ring_building()], OsmData()).buildings[0].pitch is None  # untagged ring: an ordinary building
    solid = Building("NL.IMBAG.Pand.solid", {"b3_h_maaiveld": GROUND},
                     "2.2", [Surface("roof", np.array([[*c, ROOF_Z] for c in OUTER.exterior.coords[:-1]]))])
    assert world_of([solid], stadium_osm()).buildings[0].pitch is None  # no pitch hole
    assert world_of([ring_building()], stadium_osm(), stands=False).buildings[0].pitch is None


def test_osm_stadium_building_tag_counts_too():
    osm = OsmData(buildings=[OsmFeature("relation/3", {"building": "stadium"}, OUTER.difference(PITCH))])
    b = world_of([ring_building()], osm).buildings[0]
    assert b.pitch is not None


def test_plan_stadiums_skips_heroes_and_far_tags():
    bld = world_of([ring_building()], OsmData()).buildings[0]
    far = stadium_osm(box(X0 + 500, Y0, X0 + 600, Y0 + 100))
    assert plan_stadiums([bld], far, flat_dtm()) == []
    bld.hero = "stadhuis"
    assert plan_stadiums([bld], stadium_osm(), flat_dtm()) == []


# ---------------------------------------------------------------------------- profile
def test_rake_rows_step_up_with_seats_at_the_back_and_aisles():
    d = np.array([0.25, 0.75, 1.25, 1.75, 5.75])
    s = np.array([5.0, 5.0, 5.0, 5.0, 5.0])
    top, cap, colour, tread = rake(d, s, FRONT_K)
    assert tread.tolist() == [FRONT_K, FRONT_K, FRONT_K + RISE_PLATES, FRONT_K + RISE_PLATES, FRONT_K + 5 * RISE_PLATES]
    assert top.tolist() == [FRONT_K, FRONT_K + SEAT_PLATES, FRONT_K + 3, FRONT_K + 3 + SEAT_PLATES,
                            FRONT_K + 15 + SEAT_PLATES]
    assert cap.tolist() == [1, SEAT_PLATES, 1, SEAT_PLATES, SEAT_PLATES]
    assert colour[0] == palette.idx(BODY) and colour[1] == palette.idx(SEAT_RED)  # block 0: red
    aisle = rake(np.array([0.25, 0.75]), np.array([AISLE_EVERY_M + 0.2] * 2), FRONT_K)[2]
    assert (aisle == palette.idx(AISLE)).all()  # same steps, paving colour


def test_seat_patterns_repeat_per_block():
    rows = np.arange(10)
    red, white = palette.idx(SEAT_RED), palette.idx(SEAT_WHITE)
    assert (seat_colour(np.zeros(10, np.int64), rows) == red).all()
    assert seat_colour(np.ones(10, np.int64), rows).tolist() == [white, red] * 5  # stripes
    band = seat_colour(np.full(10, 3, np.int64), rows)
    assert (band[3:7] == white).all() and (band[:3] == red).all() and (band[7:] == red).all()
    assert (seat_colour(np.full(10, 4, np.int64), rows) == red).all()  # the cycle repeats


def test_stand_column_covered_back_block_open_and_mast():
    g = np.full(4, GK)
    slab = np.full(4, ROOF_PLATES)
    tread = np.array([FRONT_K, FRONT_K + 45, FRONT_K, FRONT_K])
    top = tread + SEAT_PLATES
    bld = np.array([ROOF_K, ROOF_K, FRONT_K + 1, FRONT_K + MAX_CLEAR_PLATES + 40])
    stand, top2, roof_k = stand_column(top, tread, bld, g, slab)
    assert stand.tolist() == [True, False, True, False]  # covered, back block, open, mast
    assert roof_k[0] == ROOF_K - ROOF_PLATES + 1 and top2[0] == top[0]
    assert top2[2] == FRONT_K + 1 and roof_k[2] == FRONT_K + 2  # open: the rake is the top, nothing above
    assert ROOF_K - ROOF_PLATES + 1 - top[1] < HEADROOM_PLATES + 1


# ---------------------------------------------------------------------------- end to end
@pytest.fixture(scope="module")
def stadium():
    """The world, layers around the stadium, a section box across the south stand (x 55-65 m,
    y -2-25 m) and the chunk tile holding the pitch edge there."""
    world = world_of([ring_building()], stadium_osm())
    layers = build_layers(world, CellBox(*geo.rd_to_grid(X0 - 40, Y0 - 40), *geo.rd_to_grid(X0 + 160, Y0 + 140)))
    section = voxelise_tile(world, layers, CellBox(*geo.rd_to_grid(X0 + 55, Y0 - 2), *geo.rd_to_grid(X0 + 65, Y0 + 25)))
    I, J = geo.rd_to_grid(X0 + 60, Y0 + 19)
    chunk = voxelise_tile(world, layers, geo.chunk_cells(I // geo.CHUNK_STUDS, J // geo.CHUNK_STUDS).grow(1))
    return world, layers, section, chunk


def col(tile, I, J):
    return tile.color[I - tile.I0, J - tile.J0], lambda K: K - tile.k0


def test_south_stand_rake_air_and_roof(stadium):
    world, layers, tile, _ = stadium
    I = geo.rd_to_grid(X0 + 60.25, Y0)[0]
    front = geo.rd_to_grid(X0, Y0 + 19.75)[1]  # first row below the pitch edge
    c, k = col(tile, I, front)
    assert (c[k(GK + 1):k(FRONT_K)] == palette.idx(BODY)).all()  # 1 m front wall
    assert c[k(FRONT_K)] in (palette.idx(BODY), palette.idx(AISLE))  # the tread (or an aisle step)
    under = ROOF_K - ROOF_PLATES + 1
    assert (c[k(FRONT_K) + 1:k(under)] == 0).all()  # open toward the pitch, under the roof
    assert (c[k(under):k(ROOF_K)] == palette.idx(ROOF_UNDER)).all() and c[k(ROOF_K)] != 0
    seat, k = col(tile, I, front - 1)  # back half of row 0: a seat block
    assert seat[k(FRONT_K + SEAT_PLATES)] in (palette.idx(SEAT_RED), palette.idx(SEAT_WHITE), palette.idx(AISLE))
    assert seat[k(FRONT_K + SEAT_PLATES) + 1] == 0
    row5, k = col(tile, I, front - 10)  # row 5, tread
    assert row5[k(FRONT_K + 5 * RISE_PLATES)] in (palette.idx(BODY), palette.idx(AISLE))
    assert row5[k(FRONT_K + 5 * RISE_PLATES) + 1] == 0


def test_rake_ends_below_the_roof_and_the_outside_wall_stays(stadium):
    world, layers, tile, _ = stadium
    I = geo.rd_to_grid(X0 + 60.25, Y0)[0]
    back, k = col(tile, I, geo.rd_to_grid(X0, Y0 + 5.25)[1])  # 14.5 m from the pitch: no headroom left
    assert (back[k(GK + 1):k(ROOF_K) + 1] != 0).all()  # the solid back block
    i, j = I - layers.box.i0, geo.rd_to_grid(X0, Y0 + 0.25)[1] - layers.box.j0
    assert layers.stand_k[i, j] == NONE  # outer wall zone
    last = max(J for J in range(tile.J0, tile.J0 + tile.dims[1]) if layers.stand_k[i, J - layers.box.j0] != NONE)
    top = int(layers.stand_k[i, last - layers.box.j0])
    assert top + HEADROOM_PLATES < ROOF_K - ROOF_PLATES + 1  # the last row keeps its headroom


def test_no_facade_faces_the_pitch_but_the_outside_has_one(stadium):
    world = stadium[0]
    (b,) = world.buildings
    runs = [r for r in world.facades if r.fid == b.feature_id]
    assert runs
    for r in runs:
        I, J = r.cell((r.a0 + r.a1) // 2, -1)  # the open cell in front of the wall
        x, y = geo.grid_to_rd(I, J, centre=True)
        assert not PITCH.contains(Point(x, y))
    assert any(r.normal == "S" for r in runs)  # the south front is a facade
    plain = world_of([ring_building()], stadium_osm(), stands=False)
    inner = [r for r in plain.facades if PITCH.contains(Point(*geo.grid_to_rd(*r.cell(r.a0, -1), centre=True)))]
    assert inner  # without stands the pitch side would be walls with windows


def test_stand_tile_lays_out_exactly(stadium):
    tile = stadium[3]
    rec = layout_tile(tile.color, tile.feature, tile.shape, tile.k0, tile.I0, tile.J0, border=1, placed=tile.placed)
    assert verify_layout(tile.color, tile.feature, tile.shape, rec, tile.k0, tile.I0, tile.J0, border=1,
                         placed=tile.placed) == []
    seats = int(np.isin(rec["color"], [palette.idx(SEAT_RED), palette.idx(SEAT_WHITE)]).sum())
    assert seats > 0 and len(rec) < 6000  # rows pack into long plates


def test_turned_stadium_is_an_island_with_stands():
    from blox_pipeline.islands.build import build_group
    from blox_pipeline.islands.frame import island_frame, local_world

    c = OUTER.centroid
    outer, pitch = (affinity.rotate(g, 20, origin=c) for g in (OUTER, PITCH))
    world = world_of([ring_building(outer=outer, pitch=pitch)], stadium_osm(outer), facade_detail=False)
    assert not world.buildings and len(world.islands) == 1
    g = world.islands[0]
    lw = local_world(world, g, island_frame(g))
    (lb,) = lw.buildings
    assert lb.pitch is not None and lb.pitch.area == pytest.approx(PITCH.area) and lb.pitch_z == pytest.approx(GROUND)
    assert lb.pitch.within(Polygon(lb.footprint.exterior)) if lb.footprint.geom_type == "Polygon" else True
    res = build_group(world, g, keep_tiles=True)
    red = palette.idx(SEAT_RED)
    assert any((t.color == red).any() for t, _ in res.tiles)
    for t, rec in res.tiles:
        assert verify_layout(t.color, t.feature, t.shape, rec, t.k0, t.I0, t.J0, border=1, placed=t.placed) == []
