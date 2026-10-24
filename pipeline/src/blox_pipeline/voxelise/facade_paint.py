"""Paint planned facade runs into one chunk tile and collect its placed pieces.

``TileCanvas`` is the grammar's :class:`~blox_pipeline.facade.painter.Painter` over a
:class:`VoxelTile` in global ``(I, J, K)``. Every tile paints every run that reaches into it
(rim included), always in the same order, so neighbouring tiles agree on the shared rim;
but a tile only *records* the pieces that lie inside its own chunk (the tile minus its
1-cell rim). Rules that keep CONTRACT 4 and 7:

* a piece whose box would straddle a chunk border is replaced by a voxel stand-in (glass
  for windows, its colour otherwise); bays are already moved off borders along the run,
  so this only happens across the wall's depth;
* a piece's cells are cleared before it is placed and *locked*: later fills skip them, and
  a piece that would land on a locked cell is skipped (counted in ``skipped``).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .. import geo
from ..catalogue import load_catalogue
from ..facade.frame import FramePainter
from ..facade.run import paint_run
from ..facade.spec import PLINTH
from ..layout.placed import as_records, make_placed, placed_box
from ..layout.records import FLAG_NO_VARIATION, Records
from ..rotation import Facing
from . import palette
from .facade_runs import RunPlan
from .grid import VoxelTile

ATTIC_GAP = 3  # plates between the eave cornice and the attic window, and above it
STAND_IN = {"window": "glass"}  # piece kind -> stand-in colour (default: the piece colour)


@dataclass
class TileCanvas:
    tile: VoxelTile
    border: int = 1
    placed: list[Records] = field(default_factory=list)
    skipped: int = 0
    stand_ins: int = 0

    def __post_init__(self) -> None:
        self.locked = np.zeros(self.tile.dims, np.bool_)

    def _clip(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int):
        t = self.tile
        ni, nj, nk = t.dims
        a0, a1 = max(i0 - t.I0, 0), min(i1 - t.I0, ni)
        b0, b1 = max(j0 - t.J0, 0), min(j1 - t.J0, nj)
        c0, c1 = max(k0 - t.k0, 0), min(k1 - t.k0, nk)
        if a0 >= a1 or b0 >= b1 or c0 >= c1:
            return None
        return slice(a0, a1), slice(b0, b1), slice(c0, c1)

    def fill(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int, colour: str | int,
             feature: int = 0, shape: int = 0) -> None:
        box = self._clip(i0, i1, j0, j1, k0, k1)
        if box is None:
            return
        c = palette.idx(colour) if isinstance(colour, str) else int(colour)
        free = ~self.locked[box]
        self.tile.color[box][free] = c
        self.tile.feature[box][free] = feature if c else 0
        self.tile.shape[box][free] = shape if c else 0

    def clear(self, i0: int, i1: int, j0: int, j1: int, k0: int, k1: int) -> None:
        self.fill(i0, i1, j0, j1, k0, k1, 0)

    def place(self, piece: str, i: int, j: int, k: int, facing: str, colour: str | int,
              feature: int = 0, *, no_variation: bool = False) -> tuple[int, int, int, int, int, int]:
        cat = load_catalogue()
        c = palette.idx(colour) if isinstance(colour, str) else int(colour)
        rec = make_placed(cat, piece, i, j, k, Facing.parse(facing), c, feature,
                          flags=FLAG_NO_VARIATION if no_variation else 0)
        i0, i1, j0, j1, k0, k1 = placed_box(cat, rec[0])
        n = geo.CHUNK_STUDS
        if i0 // n != (i1 - 1) // n or j0 // n != (j1 - 1) // n:
            self.fill(i0, i1, j0, j1, k0, k1, STAND_IN.get(cat[piece].kind, c), feature)
            self.stand_ins += 1
            return i0, i1, j0, j1, k0, k1
        box = self._clip(i0, i1, j0, j1, k0, k1)
        if box is not None:
            if self.locked[box].any():
                self.skipped += 1
                return i0, i1, j0, j1, k0, k1
            self.clear(i0, i1, j0, j1, k0, k1)
            self.locked[box] = True
        if self._own(i0, i1, j0, j1):
            self.placed.append(rec)
        return i0, i1, j0, j1, k0, k1

    def _own(self, i0: int, i1: int, j0: int, j1: int) -> bool:
        """Box inside the tile minus its rim (= the chunk, for chunk tiles)."""
        t, b = self.tile, self.border
        ni, nj, _ = t.dims
        return t.I0 + b <= i0 and i1 <= t.I0 + ni - b and t.J0 + b <= j0 and j1 <= t.J0 + nj - b

    def records(self) -> Records:
        return as_records(self.placed)


def paint_plan(cv: TileCanvas, plan: RunPlan) -> None:
    """Carve a real wall into the shape ``paint_run`` expects, then paint the run."""
    run = plan.run
    assert run is not None
    fp = FramePainter(cv, plan.frame)
    base, eave = plan.base, run.eave_k(plan.base)
    for x, low in enumerate(plan.lows):
        fp.fill(x, x + 1, 0, 2, low, base + PLINTH, run.plinth, run.fid)  # plinth, down to the street
    fp.clear(1, run.x1 - 1, 0, 1, base + PLINTH, eave)  # trim layer: air between the pilasters
    paint_run(fp, run, base)
    gable(fp, plan, eave)
    for x, df, kb, roof in plan.dormers:
        dormer(fp, run, x, df, kb, roof)
    if plan.chimney is not None:
        x, d, k0, k1 = plan.chimney
        fp.fill(x, x + 2, d, d + 1, k0, k1, run.dress, run.fid)
        fp.fill(x, x + 2, d, d + 1, k1, k1 + 1, "dark_grey", run.fid)


DORMER_WALL = "plaster_white"


def dormer(fp: FramePainter, run, x: int, df: int, kb: int, roof: int) -> None:
    """A white dormer with a slate gable roof on a real pitched roof (rows ``df ..``, frame
    coordinates; ``facade_runs.roof_details`` planned where it fits). Same shape as the
    test-scene dormer (``facade.roofs``): 4 wide, window_1x2x2, slopes + ridge on top."""
    from ..facade.painter import RIDGE_J, SLOPE_E, SLOPE_W
    from .facade_runs import DORMER_DEPTH

    h = load_catalogue()["window_1x2x2"].h
    k1 = kb + h + 1
    fp.fill(x - 1, x + 3, df, df + DORMER_DEPTH, kb - 1, k1, DORMER_WALL, run.fid)
    fp.clear(x, x + 2, df, df + 1, kb, kb + h)
    fp.place("window_1x2x2", x, df, kb, "S", run.trim, run.fid)
    fp.fill(x, x + 2, df + 1, df + 2, kb, kb + h, "black", run.fid)
    fp.fill(x - 1, x, df - 1, df + DORMER_DEPTH, k1, k1 + 3, roof, run.fid, SLOPE_W)
    fp.fill(x + 2, x + 3, df - 1, df + DORMER_DEPTH, k1, k1 + 3, roof, run.fid, SLOPE_E)
    fp.fill(x, x + 2, df - 1, df + DORMER_DEPTH, k1, k1 + 3, roof, run.fid)
    fp.fill(x, x + 2, df - 1, df + DORMER_DEPTH, k1 + 3, k1 + 6, roof, run.fid, RIDGE_J)


def gable(fp: FramePainter, plan: RunPlan, eave: int) -> None:
    """Wall above the eave (a gable end): plain wall instead of the glass-cell rhythm, with
    one attic window (``window_1x2x2`` in the wall row, sill below) where it fits."""
    run = plan.run
    assert run is not None
    for x, top in enumerate(plan.tops):
        fp.fill(x, x + 1, 0, 1, eave, top, run.wall, run.fid)
    h = load_catalogue()["window_1x2x2"].h
    mid = run.x1 // 2 - 1
    k = eave + ATTIC_GAP
    if mid >= 1 and all(t >= k + h + ATTIC_GAP for t in plan.tops[mid - 1: mid + 3]) and run.free(mid, mid + 2):
        fp.clear(mid, mid + 2, 0, 1, k, k + h)
        fp.place("window_1x2x2", mid, 0, k, "S", run.trim, run.fid)
        fp.fill(mid, mid + 2, 1, 2, k, k + h, "black", run.fid)       # dark attic behind the glass
        fp.fill(mid, mid + 2, -1, 0, k - 1, k, run.trim, run.fid)     # sill


def paint_facades(tile: VoxelTile, plans: list[RunPlan], border: int = 1,
                  canvas: TileCanvas | None = None) -> TileCanvas:
    """Paint every detailed run reaching into ``tile``; sets ``tile.placed``. A ``canvas``
    already holding other placed pieces (hero models) is painted on and kept."""
    cv = canvas if canvas is not None else TileCanvas(tile, border)
    ni, nj, _ = tile.dims
    for plan in plans:
        if not plan.detail:
            continue
        i0, i1, j0, j1 = plan.bbox()
        if i1 <= tile.I0 or i0 >= tile.I0 + ni or j1 <= tile.J0 or j0 >= tile.J0 + nj:
            continue
        paint_plan(cv, plan)
    tile.placed = cv.records()
    return cv
