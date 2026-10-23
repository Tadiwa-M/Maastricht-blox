"""Placed pieces (CONTRACT 7) and the hide_studs flag (CONTRACT 4, rotFlags bit3)."""

from __future__ import annotations

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.layout.placed import make_placed, placed_box
from blox_pipeline.layout.records import FLAG_HIDE_STUDS
from blox_pipeline.testscene.canvas import Canvas

CAT = load_catalogue()
G = 10


def _canvas() -> Canvas:
    cv = Canvas(0, 0, k0=G - 3, nz=60)
    cv.fill(0, 64, 0, 64, G - 3, G, "cobble_grey", shape=7)
    return cv


def _lay(cv: Canvas) -> np.ndarray:
    placed = cv.placed_records()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    assert verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0, placed=placed) == []
    return rec


@pytest.mark.parametrize("facing,size", [("N", (4, 1)), ("E", (1, 4)), ("S", (4, 1)), ("W", (1, 4))])
def test_place_box_follows_facing(facing, size):
    rec = make_placed(CAT, "fence_1x4", 10, 20, 30, facing, color=8)
    i0, i1, j0, j1, k0, k1 = placed_box(CAT, rec[0])
    assert (i0, j0, k0) == (10, 20, 30)  # the record is the min corner, whatever the facing
    assert (i1 - i0, j1 - j0, k1 - k0) == (*size, 3)
    assert int(rec["rot"][0]) == "NESW".index(facing)


def test_canvas_place_checks_air_and_overlap():
    cv = _canvas()
    cv.fill(5, 6, 5, 6, G, G + 3, "white")
    with pytest.raises(ValueError, match="not air"):
        cv.place("window_1x2x2", 4, 5, G, "S", "white")
    cv.place("window_1x2x2", 10, 5, G, "S", "white")
    with pytest.raises(ValueError, match="overlaps"):
        cv.place("arch_1x4", 9, 5, G + 2, "S", "white")
    with pytest.raises(ValueError, match="paints over"):
        cv.fill(11, 12, 5, 6, G + 1, G + 2, "white")
    with pytest.raises(ValueError, match="sticks out"):
        cv.place("fence_1x4", 62, 5, G, "N", "white")


def test_placed_pieces_pass_through_and_wall_behind_stays():
    cv = _canvas()
    cv.fill(0, 64, 30, 33, G, G + 12, "brick_red")       # a 3-thick wall
    cv.clear(10, 12, 30, 31, G, G + 6)                     # opening in its front row
    cv.place("window_1x2x2", 10, 30, G, "S", "white", 7)
    rec = _lay(cv)
    win = rec[rec["type"] == CAT.id("window_1x2x2")]
    assert len(win) == 1 and int(win["rot"][0]) == 2 and int(win["featureId"][0]) == 7
    # the wall cell right behind the window is exposed (the window counts as air) and stored
    covered = verify_cells(rec, cv)
    assert covered[10 + 1, 31 + 1, G - cv.k0]


def verify_cells(rec, cv):
    from blox_pipeline.layout import rasterise_records
    return rasterise_records(rec, cv.I0, cv.J0, cv.k0, cv.color.shape).count > 0


def test_layout_rejects_bad_placed():
    cv = _canvas()
    bad = make_placed(CAT, "window_1x2x2", cv.I0 + 1 + 5, cv.J0 + 1 + 5, G - 1, "S", 8)  # into the paving
    with pytest.raises(ValueError, match="not air"):
        layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=[bad])
    a = make_placed(CAT, "fence_1x4", 10, 10, G, "N", 8)
    b = make_placed(CAT, "fence_1x4", 12, 10, G, "N", 8)
    with pytest.raises(ValueError, match="two placed"):
        layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=[a, b])
    edge = make_placed(CAT, "fence_1x4", 62, 10, G, "N", 8)  # spills into the next chunk
    with pytest.raises(ValueError, match="outside"):
        layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=[edge])


def test_verify_reports_missing_placed():
    cv = _canvas()
    cv.place("jumper_1x2", 20, 20, G, "E", "white")
    placed = cv.placed_records()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    rec = rec[rec["type"] != CAT.id("jumper_1x2")]
    errs = verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0, placed=placed)
    assert any("missing" in e for e in errs)


def test_hide_studs_under_hollow_interior():
    cv = _canvas()
    cv.fill(20, 30, 20, 30, G, G + 30, "mergel")  # a solid block: its middle is hollow-culled
    cv.clear(20, 21, 22, 28, G + 10, G + 11)       # a 1-plate slot cut into its west face
    rec = _lay(cv)
    hidden = (rec["flags"] & FLAG_HIDE_STUDS) != 0
    # The back wall of the slot (i = 21) is stored because it faces the slot, but the
    # cells above it are solid interior: those studs can never be seen.
    back = (rec["I"] - cv.I0 - 1 == 21) & (rec["K"] == G + 10)
    assert back.any() and hidden[back].all()
    # Bricks under the slot see air above: their studs stay.
    below = (rec["I"] - cv.I0 - 1 == 20) & (rec["K"] == G + 9)
    assert below.any() and not hidden[below].any()
    # The roof faces the sky.
    tops = rec["K"].astype(int) + np.array([CAT[int(t)].h for t in rec["type"]]) == G + 30
    assert not hidden[tops].any()


def test_tiles_never_get_hide_studs():
    cv = _canvas()
    cv.fill(0, 64, 0, 64, G, G + 6, "mergel")  # paving buried under a slab
    rec = _lay(cv)
    tiles = rec[np.isin(rec["type"], [t.id for t in CAT.of_kind("tile")])]
    assert len(tiles) == 0 or not ((tiles["flags"] & FLAG_HIDE_STUDS) != 0).any()
