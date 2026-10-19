"""Expand brick records into their footprint cells (shared by the preview renderers).

Which cells carry a stud comes from ``BrickType.stud_offsets`` (which uses the shared
rotation helpers), tabulated once per ``(type, rot)`` so the expansion stays vectorised.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from ..catalogue import Catalogue
from ..layout.records import Records


@dataclass
class FootprintCells:
    I: NDArray[np.int64]
    J: NDArray[np.int64]
    top: NDArray[np.int64]  # K + h of the owning brick (exclusive top)
    K: NDArray[np.int64]  # bottom of the owning brick
    color: NDArray[np.uint8]
    stud: NDArray[np.bool_]  # this footprint cell carries a stud
    slope: NDArray[np.bool_]  # owning brick is a slope / double slope


MAX_SIDE = 8  # longest catalogue footprint side


def stud_table(cat: Catalogue) -> NDArray[np.bool_]:
    """``[typeId, rot, di, dj]`` -> that footprint offset carries a stud."""
    tab = np.zeros((256, 4, MAX_SIDE, MAX_SIDE), bool)
    for t in cat.types:
        for rot in range(4):
            for di, dj in t.stud_offsets(rot):
                tab[t.id, rot, di, dj] = True
    return tab


def footprint_cells(rec: Records, cat: Catalogue, pane_colour: int | None = None) -> FootprintCells:
    """``pane_colour``: if given, window pieces are drawn in it (their panes are glass;
    the record colour is only the thin frame, too small for a voxel preview)."""
    ei, ej, eh = cat.extent_tables()
    studs = stud_table(cat)
    sloped = np.zeros(256, bool)
    for t in cat.types:
        sloped[t.id] = t.is_slope
    t = rec["type"].astype(np.int64)
    rot = rec["rot"].astype(np.int64) & 3
    a, b = ei[t, rot].astype(np.int64), ej[t, rot].astype(np.int64)
    sizes = a * b
    rid = np.repeat(np.arange(len(rec)), sizes)
    starts = np.cumsum(sizes) - sizes
    q = np.arange(int(sizes.sum())) - starts[rid]
    di, dj = q % a[rid], q // a[rid]
    tr, rr = t[rid], rot[rid]
    return FootprintCells(
        I=rec["I"].astype(np.int64)[rid] + di,
        J=rec["J"].astype(np.int64)[rid] + dj,
        top=rec["K"].astype(np.int64)[rid] + eh[tr],
        K=rec["K"].astype(np.int64)[rid],
        color=_colours(rec, cat, pane_colour)[rid],
        stud=studs[tr, rr, di, dj],
        slope=sloped[tr],
    )


def _colours(rec: Records, cat: Catalogue, pane_colour: int | None) -> NDArray[np.uint8]:
    col = rec["color"].copy()
    if pane_colour is not None:
        panes = np.isin(rec["type"], [t.id for t in cat.of_kind("window")])
        col[panes] = pane_colour
    return col
