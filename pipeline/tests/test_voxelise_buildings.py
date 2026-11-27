"""Buildings: gabled roofs -> slope/ridge stacks, windows, colours, landmarks, features."""

from pathlib import Path

import numpy as np
import pytest

from blox_pipeline import geo
from blox_pipeline.geo import CellBox
from blox_pipeline.sources import OsmData, SourceData
from blox_pipeline.sources.cityjson import read_path
from blox_pipeline.sources.model import Building, HeightGrid, Surface
from blox_pipeline.voxelise import VoxelConfig, build_features, build_layers, prepare_world, voxelise_tile
from blox_pipeline.voxelise import palette
from blox_pipeline.voxelise.grid import FULL, RIDGE_I, RIDGE_J, SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W

FIXTURE = Path(__file__).parent / "fixtures" / "sources" / "gabled_building.city.json"
GROUND = 50.0
GROUND_K = geo.z_to_k(GROUND)  # 100


def flat_dtm(box: CellBox, margin: int = 40) -> HeightGrid:
    return HeightGrid(box.i0 - margin, box.j0 - margin,
                      np.full((box.ni + 2 * margin, box.nj + 2 * margin), GROUND, np.float32))


def voxelise(buildings, box: CellBox, osm: OsmData | None = None, facades: bool = False):
    """Base voxeliser (glass-cell windows); ``facades=True`` adds the facade grammar."""
    cfg = VoxelConfig(facade_detail=facades)
    world = prepare_world(SourceData(flat_dtm(box), None, buildings, osm or OsmData(), None), cfg)
    layers = build_layers(world, box.grow(16))
    return world, voxelise_tile(world, layers, box)


def box_building(bag_id, x0, y0, x1, y1, z_roof, year=1990, ground=GROUND) -> Building:
    """Flat-roofed block (walls omitted: only roof/ground matter to the voxeliser)."""
    roof = np.array([[x0, y0, z_roof], [x1, y0, z_roof], [x1, y1, z_roof], [x0, y1, z_roof]])
    floor = roof[::-1].copy()
    floor[:, 2] = ground
    attrs = {"identificatie": bag_id, "oorspronkelijkbouwjaar": year, "b3_h_maaiveld": ground, "b3_h_dak_max": z_roof}
    return Building(bag_id, attrs, "2.2", [Surface("roof", roof), Surface("ground", floor)])


def gable_along_j(bag_id: str) -> Building:
    """10 m (E-W) x 8 m (N-S) footprint at (176100, 317000), ridge running north-south."""
    x0, y0 = 176100.0, 317000.0
    e = 56.0
    west = np.array([[x0, y0, e], [x0 + 5, y0, 61.0], [x0 + 5, y0 + 8, 61.0], [x0, y0 + 8, e]])
    east = np.array([[x0 + 10, y0 + 8, e], [x0 + 5, y0 + 8, 61.0], [x0 + 5, y0, 61.0], [x0 + 10, y0, e]])
    attrs = {"identificatie": bag_id, "oorspronkelijkbouwjaar": 1930, "b3_h_maaiveld": GROUND}
    return Building(bag_id, attrs, "2.2", [Surface("roof", west), Surface("roof", east)])


@pytest.fixture(scope="module")
def gabled():
    blds = read_path(FIXTURE)
    return voxelise(blds, CellBox(590, 990, 630, 1030))


def top_and_shape(tile, I, J):
    k = tile.column_top(I, J)
    return k, int(tile.shape[I - tile.I0, J - tile.J0, k - tile.k0])


def test_gabled_roof_becomes_slope_stacks(gabled):
    _, t = gabled
    I = 610
    tops, shapes = zip(*(top_and_shape(t, I, J) for J in range(1000, 1016)))
    assert tops[0] == geo.z_to_k(56.0) and tops[-1] == geo.z_to_k(56.0)  # eaves
    assert max(tops) == 148  # ridge cell centres at 59.75 m
    assert list(tops[:8]) == sorted(tops[:8]) and list(tops[8:]) == sorted(tops[8:], reverse=True)
    assert all((k - 130) % 3 == 0 for k in tops)  # one brick per step
    assert shapes[:7] == (SLOPE_S,) * 7 and shapes[9:] == (SLOPE_N,) * 7
    assert shapes[7:9] == (RIDGE_I, RIDGE_I)
    # every slope/ridge surface is a 3-cell stack on top of full wall cells
    for J in range(1000, 1016):
        k, s = top_and_shape(t, I, J)
        col = t.shape[I - t.I0, J - t.J0]
        assert list(col[k - t.k0 - 2 : k - t.k0 + 1]) == [s, s, s]
        assert col[k - t.k0 - 3] == FULL
    # nothing outside the footprint rises above the ground
    assert t.column_top(599, 1005) == GROUND_K and t.column_top(610, 1016) == GROUND_K


def test_gabled_colours_and_features(gabled):
    world, t = gabled
    I, J = 610, 1003
    k_top = t.column_top(I, J)
    roof_c = int(t.color[I - t.I0, J - t.J0, k_top - t.k0])
    wall_c = int(t.color[I - t.I0, J - t.J0, GROUND_K + 2 - t.k0])
    assert palette.entries()[roof_c][1] in ("slate", "roof_tile_red", "roof_tile_dark")
    # built 1650: the old-centre look (limestone and plaster, a little dark brick)
    assert palette.entries()[wall_c][1] in ("limestone", "plaster_white", "plaster_cream", "plaster_grey",
                                            "brick_dark_red", "mergel_light")
    fid = int(t.feature[I - t.I0, J - t.J0, k_top - t.k0])
    assert fid == 1 and int(t.feature[I - t.I0, J - t.J0, GROUND_K - t.k0]) == 0
    [feat] = build_features(world.registry)["features"]
    assert feat["kind"] == "building" and feat["bagId"] == "NL.IMBAG.Pand.0935100000000001"
    assert feat["year"] == 1650 and feat["heightM"] == 10.0
    assert feat["bboxIJ"] == [600, 1000, 619, 1015] and feat["centroid"] == [610, 1008]


def test_windows_follow_storey_rhythm(gabled):
    _, t = gabled
    glass = palette.idx("glass")
    J = 1000  # south facade
    rows = {k: [int(t.color[i - t.I0, J - t.J0, k - t.k0]) == glass for i in range(600, 620)]
            for k in range(GROUND_K + 1, 131)}
    glass_levels = [k for k, row in rows.items() if any(row)]
    base = GROUND_K + 1
    # top glass row stops below the roof band (slope stack + its studded back-row underlay)
    assert glass_levels == list(range(base + 4, base + 11)) + list(range(base + 19, 124))
    row = rows[base + 5]
    assert not row[0] and not row[-1]  # corners stay solid
    pattern = [i for i, g in enumerate(row) if g]
    assert len(pattern) >= 6 and len({b - a for a, b in zip(pattern, pattern[1:])}) == 1  # regular rhythm
    # no glass inside the building or in roof stacks
    assert not (t.color[601 - t.I0 : 619 - t.I0, 1001 - t.J0 : 1015 - t.J0] == glass).any()


def test_ridge_along_j():
    _, t = voxelise([gable_along_j("NL.IMBAG.Pand.2")], CellBox(790, 990, 830, 1030))
    J = 1008
    shapes = [top_and_shape(t, I, J)[1] for I in range(800, 820)]
    assert shapes[:9] == [SLOPE_W] * 9 and shapes[11:] == [SLOPE_E] * 9
    assert shapes[9:11] == [RIDGE_J, RIDGE_J]


def test_flat_roof_and_overlap_takes_higher():
    a = box_building("NL.IMBAG.Pand.A", 176000, 317000, 176004, 317004, 54.0)
    b = box_building("NL.IMBAG.Pand.B", 176002, 317000, 176006, 317004, 58.0)
    world, t = voxelise([a, b], CellBox(595, 995, 615, 1015))
    assert top_and_shape(t, 601, 1002) == (geo.z_to_k(54.0), FULL)
    assert top_and_shape(t, 605, 1002) == (geo.z_to_k(58.0), FULL)
    assert int(t.feature[605 - t.I0, 1002 - t.J0, 110 - t.k0]) == 2
    flat_roof = palette.entries()[int(t.color[601 - t.I0, 1002 - t.J0, geo.z_to_k(54.0) - t.k0])][1]
    assert flat_roof in ("dark_grey", "light_grey", "black")


def test_sint_jan_landmark_override():
    x, y = 176115.0, 317672.0  # Sint-Janstoren
    church = box_building("NL.IMBAG.Pand.SJ", x - 5, y - 5, x + 25, y + 5, 75.0, year=1400)
    world, t = voxelise([church], CellBox(*geo.rd_to_grid(x - 8, y - 8), *geo.rd_to_grid(x + 28, y + 8)))
    I, J = geo.rd_to_grid(x, y)
    tower = palette.idx("tower_red")
    assert int(t.color[I - t.I0, J - t.J0, GROUND_K + 5 - t.k0]) == tower
    Ie, _ = geo.rd_to_grid(x + 20, y)
    assert int(t.color[Ie - t.I0, J - t.J0, GROUND_K + 5 - t.k0]) == palette.idx("mergel")
    [feat] = build_features(world.registry)["features"]
    assert feat["kind"] == "landmark" and feat["name"] == "Sint-Janskerk"
    assert not (t.color == palette.idx("glass")).any()  # landmarks get no generic windows


def test_pitched_roof_has_back_row_underlay(gabled):
    """Below each slope stack sits one full stack in roof colour, so the layout can pair it
    as the studded back row of the next-lower slope stack."""
    _, t = gabled
    I, J = 610, 1003
    col_s = t.shape[I - t.I0, J - t.J0]
    col_c = t.color[I - t.I0, J - t.J0]
    top = int(np.flatnonzero(t.color[I - t.I0, J - t.J0])[-1])
    assert col_s[top] in (SLOPE_N, SLOPE_E, SLOPE_S, SLOPE_W)
    roof = col_c[top]
    assert all(col_c[top - n] == roof for n in range(6))
    assert all(col_s[top - n] == FULL for n in range(3, 6))
