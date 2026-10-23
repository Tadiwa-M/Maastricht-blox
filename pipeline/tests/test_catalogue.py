import numpy as np
import pytest

from blox_pipeline.catalogue import KINDS, load_catalogue, repo_root
from blox_pipeline.rotation import rotated_extent
from blox_pipeline.palette import load_palette


def test_catalogue_loads_and_looks_up():
    cat = load_catalogue()
    assert cat["brick_2x4"].id == 9
    assert cat[9].name == "brick_2x4"
    assert cat.id("tile_1x1") == 24
    assert "slope45_2x2" in cat and 0 not in cat
    assert {t.kind for t in cat.types} == set(KINDS)
    assert cat["slope33_2x3"].stud_rows == 1
    assert cat["window_1x2x2"].is_detail and not cat["brick_1x1"].is_detail


def test_stud_offsets():
    cat = load_catalogue()
    assert sorted(cat["brick_2x2"].stud_offsets(0)) == [(0, 0), (0, 1), (1, 0), (1, 1)]
    assert cat["tile_1x2"].stud_offsets(0) == [] and cat["slope30_1x2"].stud_offsets(1) == []
    # slope45_1x2: low edge is the front (+j at rot 0), the stud row is the back (-j side)
    assert cat["slope45_1x2"].stud_offsets(0) == [(0, 0)]
    assert cat["slope45_1x2"].stud_offsets(2) == [(0, 1)]   # front faces -j: back is +j
    assert cat["slope45_1x2"].stud_offsets(1) == [(0, 0)]   # front +i: back at low i
    assert cat["slope45_1x2"].stud_offsets(3) == [(1, 0)]
    assert sorted(cat["jumper_1x2"].stud_offsets(1)) == [(0, 0), (0, 1)]


def test_footprint_rotation_rule():
    # rot 0/2: w along i, d along j; rot 1/3: swapped (CONTRACT section 2)
    assert rotated_extent(2, 4, 0) == (2, 4)
    assert rotated_extent(2, 4, 1) == (4, 2)
    assert rotated_extent(2, 4, 2) == (2, 4)
    assert rotated_extent(2, 4, 3) == (4, 2)
    with pytest.raises(ValueError):
        rotated_extent(1, 1, 4)
    cat = load_catalogue()
    assert cat["slope45_4x2"].extent(1) == (2, 4)


def test_extent_tables_match_types():
    cat = load_catalogue()
    ei, ej, h = cat.extent_tables()
    for t in cat.types:
        for r in range(4):
            assert (ei[t.id, r], ej[t.id, r]) == t.extent(r)
        assert h[t.id] == t.h
    assert ei[0, 0] == 0 and ei[255, 0] == 0


def test_palette_lookups():
    pal = load_palette()
    assert pal.idx("water") == 32 and pal[32].material == "trans"
    assert pal["mergel"].rgb == (0xD9, 0xC4, 0x8A)
    see = pal.see_through_mask()
    assert see[0] and see[pal.idx("glass")] and see[pal.idx("water")]
    assert not see[pal.idx("brick_red")] and not see[pal.idx("lamp_warm")]
    assert see[200]  # undefined index behaves like air
    rgb = pal.rgb_table()
    assert rgb.shape == (256, 3) and tuple(rgb[pal.idx("white")]) == (0xF2, 0xF0, 0xEA)


def test_repo_root_has_contract():
    assert (repo_root() / "contract" / "palette.json").is_file()
