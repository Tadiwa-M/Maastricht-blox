"""Expand brick records into their footprint cells (shared by the preview renderers)."""

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


def footprint_cells(rec: Records, cat: Catalogue) -> FootprintCells:
    ei, ej, eh = cat.extent_tables()
    stud_all = np.zeros(256, bool)
    back_rows = np.zeros(256, np.int64)
    sloped = np.zeros(256, bool)
    for t in cat.types:
        stud_all[t.id] = t.studs == "all"
        back_rows[t.id] = t.stud_rows if t.studs == "backRows" else 0
        sloped[t.id] = t.is_slope
    t = rec["type"].astype(np.int64)
    rot = rec["rot"].astype(np.int64) & 3
    a, b = ei[t, rot].astype(np.int64), ej[t, rot].astype(np.int64)
    sizes = a * b
    rid = np.repeat(np.arange(len(rec)), sizes)
    starts = np.cumsum(sizes) - sizes
    q = np.arange(int(sizes.sum())) - starts[rid]
    di, dj = q % a[rid], q // a[rid]
    tr, rr, br = t[rid], rot[rid], back_rows[t[rid]]
    # back (studded) rows of slopes: the side opposite the low edge (+j, +i, -j, -i)
    back = np.select(
        [rr == 0, rr == 1, rr == 2, rr == 3],
        [dj < br, di < br, dj >= b[rid] - br, di >= a[rid] - br],
    )
    return FootprintCells(
        I=rec["I"].astype(np.int64)[rid] + di,
        J=rec["J"].astype(np.int64)[rid] + dj,
        top=rec["K"].astype(np.int64)[rid] + eh[tr],
        K=rec["K"].astype(np.int64)[rid],
        color=rec["color"][rid],
        stud=stud_all[tr] | ((br > 0) & back),
        slope=sloped[tr],
    )
