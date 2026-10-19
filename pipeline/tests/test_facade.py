"""Facade grammar: bay spacing and that every house variant lays out cleanly."""

from __future__ import annotations

from collections import Counter

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade import GroundFloor, HouseSpec, RoofKind, paint_house
from blox_pipeline.facade.bays import WINDOW_W, bay_starts
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.rotation import facing_to_rot
from blox_pipeline.testscene.canvas import Canvas

G = 20


@pytest.mark.parametrize("width", range(8, 21))
def test_bays_fit_between_pilasters_with_piers(width: int) -> None:
    starts = bay_starts(0, width)
    assert starts, width
    assert starts[0] >= 2 and starts[-1] + WINDOW_W <= width - 2
    assert all(b - a >= WINDOW_W + 1 for a, b in zip(starts, starts[1:]))


def _build(roof: RoofKind, ground: GroundFloor, **kw) -> tuple[Canvas, np.ndarray]:
    cv = Canvas(0, 0, k0=G - 3, nz=120)
    cv.fill(0, 64, 0, 64, G - 3, G, "cobble_grey", shape=7)
    args = dict(quoins=True, shutters=True, flowers="flower_pink", corner_west=True) | kw
    spec = HouseSpec(4, 10, 12, 14, 2, 5, "brick_red", roof_kind=roof, ground=ground, **args)
    paint_house(cv, spec, G)
    placed = cv.placed_records()
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=placed)
    assert verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0, placed=placed) == []
    return cv, rec


@pytest.mark.parametrize("balcony", [False, True])
@pytest.mark.parametrize("roof", list(RoofKind))
@pytest.mark.parametrize("ground", list(GroundFloor))
def test_house_variants_lay_out_exactly(roof: RoofKind, ground: GroundFloor, balcony: bool) -> None:
    cv, rec = _build(roof, ground, balcony=balcony)
    cat = load_catalogue()
    names = Counter(cat[int(t)].name for t in rec["type"])
    kinds = {cat[int(t)].kind for t in rec["type"]}
    assert "slope" in kinds
    # window pieces on every storey: 3 bays x 2 upper storeys (minus a balcony door),
    # 2 west bays x 2 storeys, plus the ground floor
    assert names["window_1x2x3"] >= 8
    assert names["door_1x2x4"] == int(ground is not GroundFloor.PLAIN) + int(balcony)
    assert names["fence_1x4"] >= int(balcony) + 2 * int(roof is RoofKind.FLAT_CORNICE)
    assert names["slope30_1x2"] >= 2 and names["round_tile_1x1"] >= 2
    if ground in (GroundFloor.SHOP, GroundFloor.ARCHED):
        assert names["arch_1x4"] >= 1
    if ground is GroundFloor.SHOP:
        assert names["grille_1x2"] >= 2
    if roof is RoofKind.STEPPED_GABLE:
        assert names["jumper_1x2"] == 1 and names["window_1x2x2"] == 1
    if roof is RoofKind.EAVE_DORMERS:
        assert names["window_1x2x2"] >= 1


def test_street_pieces_face_south_and_side_pieces_face_west() -> None:
    cv, rec = _build(RoofKind.STEPPED_GABLE, GroundFloor.HOUSE)
    cat = load_catalogue()
    windows = rec[rec["type"] == cat.id("window_1x2x3")]
    west = windows["I"] == 4  # the west wall at x0 = 4
    assert set(windows["rot"][~west]) == {facing_to_rot("S")}
    assert set(windows["rot"][west]) == {facing_to_rot("W")}


def test_window_has_wall_and_backdrop_around_it() -> None:
    cv, rec = _build(RoofKind.FLAT_CORNICE, GroundFloor.HOUSE, flowers=None)
    cat = load_catalogue()
    w = rec[(rec["type"] == cat.id("window_1x2x3")) & (rec["I"] != 4)][0]
    i, j, k = int(w["I"]) - cv.I0, int(w["J"]) - cv.J0, int(w["K"]) - cv.k0
    assert cv.color[i, j + 1, k] != 0  # backdrop behind the glass
    assert cv.color[i - 1, j, k] != 0  # wall beside the frame
    assert cv.color[i, j, k] == 0      # the piece's own cells are air in the voxel grid


@pytest.mark.parametrize("width", range(3, 17))
def test_fence_run_covers_span_exactly(width: int) -> None:
    from blox_pipeline.facade.pieces import fence_run

    cv = Canvas(0, 0, k0=0, nz=10)
    fence_run(cv, 5, 5 + width, 9, 2, "white", 0)
    posts = cv.color[1:-1, 10, 2] != 0  # local j = 9 -> array index 10
    cells = posts.copy()
    for rec in cv.placed:
        i = int(rec["I"][0]) - cv.I0 - 1
        cells[i : i + 4] = True
    assert cells.nonzero()[0].tolist() == list(range(5, 5 + width))
    assert len(cv.placed) == (width - 2) // 4
