"""Facade runs in any direction: the frame painter turns the grammar without mirroring, and
bays move off chunk borders."""

from __future__ import annotations

import pytest

from blox_pipeline.catalogue import load_catalogue
from blox_pipeline.facade.bays import WINDOW_W, bay_starts
from blox_pipeline.facade.frame import Frame, FramePainter
from blox_pipeline.facade.painter import SLOPE_E, SLOPE_N, SLOPE_S, SLOPE_W
from blox_pipeline.facade.run import FacadeRun, paint_run
from blox_pipeline.facade.spec import GroundFloor
from blox_pipeline.rotation import Facing, rotated_extent


class DictPainter:
    """Records painted cells and placed pieces in plain dicts (any coordinates)."""

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int, int], tuple] = {}
        self.pieces: list[tuple[str, int, int, int, str]] = []

    def fill(self, i0, i1, j0, j1, k0, k1, colour, feature=0, shape=0):
        for i in range(i0, i1):
            for j in range(j0, j1):
                for k in range(k0, k1):
                    if colour:
                        self.cells[(i, j, k)] = (colour, shape)
                    else:
                        self.cells.pop((i, j, k), None)

    def clear(self, i0, i1, j0, j1, k0, k1):
        self.fill(i0, i1, j0, j1, k0, k1, 0)

    def place(self, piece, i, j, k, facing, colour, feature=0, *, no_variation=False):
        self.pieces.append((piece, i, j, k, Facing.parse(facing).name))
        return i, i, j, j, k, k


def _run(ground: GroundFloor) -> FacadeRun:
    return FacadeRun(x0=0, x1=12, y0=0, storeys=2, fid=3, wall="brick_red", ground=ground,
                     shutters=True, flowers="flower_pink", quoins=True)


def _wall(cv, run: FacadeRun, g: int) -> None:
    cv.fill(run.x0, run.x1, 1, 4, g, run.eave_k(g), "brick_red", 3)


@pytest.mark.parametrize("normal", ["N", "E", "S", "W"])
@pytest.mark.parametrize("ground", list(GroundFloor))
def test_frame_turns_the_grammar_rigidly(normal: str, ground: GroundFloor) -> None:
    run, g = _run(ground), 10
    ref = DictPainter()
    _wall(ref, run, g)
    paint_run(ref, run, g)
    frame = Frame(normal, 100, 200)
    out = DictPainter()
    fp = FramePainter(out, frame)
    _wall(fp, run, g)
    paint_run(fp, run, g)
    # every frame cell lands where the frame maps it, with its slope turned
    expect = {}
    for (x, y, k), (colour, shape) in ref.cells.items():
        expect[(*frame.to_global(x, y), k)] = (colour, frame.shape(shape))
    assert out.cells == expect
    # every piece faces the frame's direction of its frame facing and covers the mapped box
    cat = load_catalogue()
    assert len(out.pieces) == len(ref.pieces)
    for (name, x, y, k, f), (name2, i, j, k2, f2) in zip(ref.pieces, out.pieces):
        assert (name, k) == (name2, k2) and f2 == frame.direction(f)
        ex, ey = rotated_extent(cat[name].w, cat[name].d, Facing.parse(f).value)
        a, b, c, d = frame.box(x, x + ex, y, y + ey)
        assert (i, j) == (a, c)
        assert (b - a, d - c) == rotated_extent(cat[name].w, cat[name].d, Facing.parse(f2).value)
    if ground is not GroundFloor.PLAIN:
        assert any(p[0] == "door_1x2x4" for p in out.pieces)
    assert {p[4] for p in out.pieces if p[0].startswith("window")} == {normal}


def test_frame_directions_and_slopes() -> None:
    assert [Frame(n, 0, 0).direction("S") for n in "NESW"] == list("NESW")  # front = outward normal
    assert Frame("E", 0, 0).direction("W") == "S" and Frame("W", 0, 0).direction("W") == "N"
    assert Frame("N", 0, 0).shape(SLOPE_S) == SLOPE_N and Frame("E", 0, 0).shape(SLOPE_S) == SLOPE_E
    assert Frame("W", 0, 0).shape(SLOPE_S) == SLOPE_W
    # inward (+y) is minus the normal
    assert Frame("E", 5, 5).to_global(0, 1) == (4, 5) and Frame("N", 5, 5).to_global(1, 0) == (4, 5)


@pytest.mark.parametrize("width", range(8, 33, 3))
@pytest.mark.parametrize("cut", range(1, 32, 2))
def test_bays_move_off_chunk_borders(width: int, cut: int) -> None:
    run = FacadeRun(x0=0, x1=width, y0=0, storeys=1, fid=1, wall="white", cuts=(cut,) if cut < width else ())
    bays = run.bays()
    if not run.cuts:
        assert bays == bay_starts(0, width)
    for x in bays:
        assert run.free(x - 1, x + WINDOW_W + 1)  # window, shutters and arch clear of the border
        assert 1 <= x and x + WINDOW_W <= width - 1
    assert all(b - a >= WINDOW_W + 1 for a, b in zip(bays, bays[1:]))
    assert len(bays) >= len(bay_starts(0, width)) - 1  # at most the bay on the border is lost
