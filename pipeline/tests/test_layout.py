import time

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.layout import RECORD_DTYPE, layout_tile, rasterise_records, verify_layout
from blox_pipeline.layout.cull import exposed_mask
from blox_pipeline.layout.tile import auto_border
from blox_pipeline.palette import load_palette
from test_layout_helpers import PAL, empty, gable_house, random_tile

CAT = load_catalogue()


def names(rec):
    return [CAT[int(t)].name for t in rec["type"]]


def check(c, f, s, k0, I0, J0, **kw):
    rec = layout_tile(c, f, s, k0, I0, J0, **kw)
    assert rec.dtype == RECORD_DTYPE
    errs = verify_layout(c, f, s, rec, k0, I0, J0, **kw)
    assert errs == []
    return rec


@pytest.mark.parametrize("seed", range(8))
def test_random_grids_round_trip(seed):
    c, f, s = random_tile(seed)
    I0 = [0, 30, 60, 100, 4000, 5, 64, 127][seed]
    check(c, f, s, 17 + seed, I0, 40 + seed)


def test_records_sorted_by_k_j_i():
    c, f, s = random_tile(3)
    rec = layout_tile(c, f, s, 0, 0, 0)
    key = np.lexsort((rec["I"], rec["J"], rec["K"]))
    assert np.array_equal(key, np.arange(len(rec)))


def test_solid_block_is_hollow():
    c, f, s = empty(12, 12, 12)
    c[2:10, 2:10, 0:9] = PAL.idx("mergel")
    rec = check(c, f, s, 0, 0, 0)
    r = rasterise_records(rec, 0, 0, 0, c.shape)
    assert r.count[4:8, 4:8, 0:8].sum() == 0  # interior (and its underside) not stored
    assert r.count[2:10, 2:10, 8].all()  # roof surface stored
    # neighbouring glass exposes a face: a window makes the cell behind it visible
    c[2, 5, 4] = PAL.idx("glass")
    rec = check(c, f, s, 0, 0, 0)
    assert rasterise_records(rec, 0, 0, 0, c.shape).count[3, 5, 4] == 1


def test_exposure_rules():
    pal = load_palette()
    c, _, s = empty(3, 3, 3)
    c[:] = PAL.idx("mergel")
    assert not exposed_mask(c, s, pal)[1, 1, 1]
    s[1, 1, 2] = 1  # a slope above does not hide the cell under it
    assert exposed_mask(c, s, pal)[1, 1, 1]
    s[1, 1, 2] = 7  # a tile does
    assert not exposed_mask(c, s, pal)[1, 1, 1]
    assert not exposed_mask(c, s, pal)[1, 1, 0]  # below the tile counts as ground


def test_border_cells_are_context_only():
    c, f, s = empty(66, 66, 6)
    c[:, :, :4] = PAL.idx("grass")
    assert auto_border(c.shape, 63, 127) == 1
    rec = check(c, f, s, 0, 63, 127)
    assert rec["I"].min() >= 64 and rec["I"].max() < 128
    assert rec["J"].min() >= 128 and rec["J"].max() < 192
    # the border hides the chunk's side faces: only the top plate level is stored
    assert set(rec["K"]) == {3}
    # explicit border=0 emits the border too and exposes the sides
    rec0 = check(c, f, s, 0, 63, 127, border=0)
    assert rec0["I"].min() == 63 and len(set(rec0["K"])) > 1


def test_never_crosses_chunk_borders():
    c, f, s = empty(80, 70, 6)
    c[:, :, :] = PAL.idx("asphalt")
    rec = check(c, f, s, 0, 30, 50)  # spans chunk lines at I=64 and J=64
    ei, ej, _ = CAT.extent_tables()
    t, r = rec["type"].astype(int), rec["rot"].astype(int)
    assert np.all(rec["I"] // 64 == (rec["I"] + ei[t, r] - 1) // 64)
    assert np.all(rec["J"] // 64 == (rec["J"] + ej[t, r] - 1) // 64)


def test_brick_layers_follow_global_k():
    c, f, s = empty(4, 4, 10)
    c[1, 1, :] = PAL.idx("white")  # global K 5..14: brick layers start at K % 3 == 0
    rec = check(c, f, s, 5, 0, 0)
    assert sorted(zip(rec["K"].tolist(), names(rec))) == [
        (5, "plate_1x1"), (6, "brick_1x1"), (9, "brick_1x1"), (12, "brick_1x1")]


def test_merges_only_identical_colour_and_feature():
    c, f, s = empty(8, 1, 3)
    c[:, 0, :] = PAL.idx("white")
    f[4:, 0, :] = 9
    rec = check(c, f, s, 0, 0, 0)
    assert sorted(names(rec)) == ["brick_1x4", "brick_1x4"]
    assert sorted(rec["featureId"].tolist()) == [0, 9]


def test_tiles_and_water():
    c, f, s = empty(6, 4, 2)
    c[:, :, 0] = PAL.idx("cobble_grey")
    s[:, :, 0] = 7
    c[:, :, 1] = 0
    rec = check(c, f, s, 0, 0, 0)
    assert all(CAT[int(t)].kind == "tile" for t in rec["type"])
    assert sum(CAT[int(t)].w * CAT[int(t)].d for t in rec["type"]) == 24
    assert len(rec) <= 4  # largest tiles first
    w, fw, sw = empty(4, 4, 1)
    w[:] = PAL.idx("asphalt")  # wrong colour on a water cell -> palette water
    sw[:] = 8
    rec = check(w, fw, sw, 0, 0, 0)
    assert set(rec["color"].tolist()) == {PAL.idx("water")}
    assert len(rec) == 2 and set(names(rec)) == {"tile_2x4"}


def test_slope45_with_full_back_row():
    c, f, s = empty(4, 4, 3)
    c[0:4, 1:3, :] = PAL.idx("slate")
    s[0:4, 2, :] = 1  # low edge faces +j at j=2, back row (full) at j=1
    rec = check(c, f, s, 0, 0, 0)
    assert names(rec) == ["slope45_4x2"]
    assert (rec["I"][0], rec["J"][0], rec["rot"][0]) == (0, 1, 0)


@pytest.mark.parametrize("shape,rot,front_axis,sign", [(1, 0, 1, 1), (2, 1, 0, 1), (3, 2, 1, -1), (4, 3, 0, -1)])
def test_slope_orientations(shape, rot, front_axis, sign):
    c, f, s = empty(6, 6, 3)
    roof = PAL.idx("roof_tile_red")
    # a 2-deep slope (front cell + full back cell) of width 2, centred
    for w in (2, 3):
        front = [w, w]
        back = [w, w]
        front[front_axis] = 3 if sign > 0 else 2
        back[front_axis] = 2 if sign > 0 else 3
        other = 1 - front_axis
        for p, sh in ((front, shape), (back, 0)):
            p2 = list(p)
            p2[other] = w
            c[p2[0], p2[1], :] = roof
            s[p2[0], p2[1], :] = sh
    rec = check(c, f, s, 0, 0, 0)
    assert names(rec) == ["slope45_2x2"] and rec["rot"][0] == rot
    assert (rec["I"][0], rec["J"][0]) == (2, 2)


def test_slope33_from_two_stacks():
    c, f, s = empty(2, 5, 3)
    c[0:2, 0:3, :] = PAL.idx("slate")
    s[0:2, 1:3, :] = 1  # two slope stacks in a row + full back -> 33 degree, 2 wide
    rec = check(c, f, s, 0, 0, 0)
    assert names(rec) == ["slope33_2x3"]


def test_lone_slope_stack_falls_back_to_bricks():
    c, f, s = empty(3, 3, 5)
    c[1, 1, 0:5] = PAL.idx("slate")
    s[1, 1, 0:5] = 2  # no back row; 5 high = 1 stack + 2 leftover plates
    rec = check(c, f, s, 0, 0, 0)
    assert all(CAT[int(t)].kind in ("brick", "plate") for t in rec["type"])


def test_ridge_pairs():
    c, f, s = empty(4, 2, 3)
    c[:, :, :] = PAL.idx("slate")
    s[:, :, :] = 5  # ridge along i, two cells across (j)
    rec = check(c, f, s, 0, 0, 0)
    assert names(rec) == ["slope_double45_2x2", "slope_double45_2x2"]
    assert set(rec["rot"].tolist()) == {0}


@pytest.mark.parametrize("width,axis", [(8, "j"), (6, "i"), (7, "j"), (5, "i")])
def test_gable_house_round_trip(width, axis):
    c, f, s = empty(16, 16, 40)
    roof, wall = PAL.idx("roof_tile_red"), PAL.idx("brick_red")
    if axis == "j":
        gable_house(c, f, s, 2, 2 + width, 2, 14, 0, 18, wall, roof, 5, "j")
    else:
        gable_house(c, f, s, 2, 14, 2, 2 + width, 0, 18, wall, roof, 5, "i")
    rec = check(c, f, s, 0, 0, 0)
    kinds = [CAT[int(t)].kind for t in rec["type"]]
    assert kinds.count("slope") >= 2
    if width % 2 == 0:
        assert kinds.count("slope_double") >= 1


def seams(rec, axis="I"):
    """Internal seam positions per brick layer (end coordinate of each brick)."""
    ei, ej, _ = CAT.extent_tables()
    out = {}
    for x in rec:
        e = ei[x["type"], x["rot"]] if axis == "I" else ej[x["type"], x["rot"]]
        out.setdefault(int(x["K"]), set()).add(int(x[axis]) + int(e))
    return out


def test_running_bond_stagger_single_wall():
    c, f, s = empty(40, 1, 24)
    c[:] = PAL.idx("mergel")
    rec = check(c, f, s, 0, 0, 0)
    assert set(names(rec)) <= {"brick_1x8", "brick_1x6", "brick_1x4", "brick_1x3", "brick_1x2", "brick_1x1"}
    sm = seams(rec)
    for k in range(0, 21, 3):
        lo, hi = sm[k] - {40}, sm[k + 3] - {40}
        assert lo and hi and not (lo & hi), (k, lo, hi)


def test_running_bond_stagger_thick_wall():
    c, f, s = empty(48, 2, 18)
    c[:] = PAL.idx("brick_red")
    rec = check(c, f, s, 0, 0, 0)
    sm = seams(rec)
    for k in range(0, 15, 3):
        lo, hi = sm[k] - {48}, sm[k + 3] - {48}
        assert len(lo & hi) < len(lo) / 2  # most seams step sideways


def test_look_test_scene_round_trip():
    from blox_pipeline.testscene import make_scene

    cv = make_scene()
    rec = check(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0)
    kinds = {CAT[int(t)].kind for t in rec["type"]}
    assert {"brick", "plate", "tile", "slope", "slope_double"} <= kinds


def test_dense_chunk_performance():
    rng = np.random.default_rng(5)
    c, f, s = empty(66, 66, 400)
    c[:, :, :60] = PAL.idx("soil")
    for b in range(30):
        x, y = rng.integers(0, 60, 2)
        w, d = rng.integers(4, 16, 2)
        h = int(rng.integers(20, 330))
        c[x : x + w, y : y + d, 60 : 60 + h] = rng.choice([1, 4, 8, 16])
        f[x : x + w, y : y + d, 60 : 60 + h] = b + 1
        c[x : x + w : 3, y, 70 : 60 + h : 5] = PAL.idx("glass")
    for _ in range(4):
        x, y = rng.integers(1, 50, 2)
        gable_house(c, f, s, x, x + 8, y, y + 12, 60, 340, PAL.idx("white"), PAL.idx("slate"), 99, "j", 60)
    layout_tile(c, f, s, 0, 63, 127)  # warm-up (numba cache / JIT)
    t = time.perf_counter()
    rec = layout_tile(c, f, s, 0, 63, 127)
    dt = time.perf_counter() - t
    assert dt < 2.0, dt
    assert verify_layout(c, f, s, rec, 0, 63, 127) == []
