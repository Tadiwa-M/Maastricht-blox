"""Facade grammar: bay spacing and that every house variant lays out cleanly."""

from __future__ import annotations

import numpy as np
import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade import GroundFloor, HouseSpec, RoofKind, paint_house
from blox_pipeline.facade.bays import WINDOW_W, bay_starts
from blox_pipeline.layout import layout_tile, verify_layout
from blox_pipeline.testscene.canvas import Canvas

G = 20


@pytest.mark.parametrize("width", range(8, 21))
def test_bays_fit_between_pilasters_with_piers(width: int) -> None:
    starts = bay_starts(0, width)
    assert starts, width
    assert starts[0] >= 2 and starts[-1] + WINDOW_W <= width - 2
    assert all(b - a >= WINDOW_W + 1 for a, b in zip(starts, starts[1:]))


@pytest.mark.parametrize("roof", list(RoofKind))
@pytest.mark.parametrize("ground", list(GroundFloor))
def test_house_variants_lay_out_exactly(roof: RoofKind, ground: GroundFloor) -> None:
    cv = Canvas(0, 0, k0=G - 3, nz=120)
    cv.fill(0, 64, 0, 64, G - 3, G, "cobble_grey", shape=7)
    spec = HouseSpec(4, 10, 12, 14, 2, 5, "brick_red", roof_kind=roof, ground=ground,
                     quoins=True, shutters=True, flowers="flower_pink", corner_west=True)
    paint_house(cv, spec, G)
    rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0)
    assert verify_layout(cv.color, cv.feature, cv.shape, rec, cv.k0, cv.I0, cv.J0) == []
    cat = load_catalogue()
    kinds = {cat[int(t)].kind for t in rec["type"]}
    assert "slope" in kinds or roof is RoofKind.FLAT_CORNICE or ground is GroundFloor.SHOP
    glass = cv.palette.idx("glass")
    assert np.count_nonzero(cv.color == glass) > 10
