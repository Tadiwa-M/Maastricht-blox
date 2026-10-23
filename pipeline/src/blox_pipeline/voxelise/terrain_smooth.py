"""Terrain smoothing before quantisation.

AHN is accurate to a few centimetres, so a flat square still varies by ±10 cm. Quantised to
0.2 m plates, that noise turns into a scatter of one-plate steps ("contour ripples") all over
squares and streets. A NaN-aware box blur over a few metres removes the noise and keeps the
real slopes (Maastricht's centre rises about 5 m from the Maas to the Vrijthof).
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from ..sources.model import HeightGrid


def _box_sum(a: NDArray[np.float64], r: int, axis: int) -> NDArray[np.float64]:
    """Sum over a window of 2r+1 cells along ``axis`` (zero padding)."""
    pad = [(0, 0), (0, 0)]
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad), axis=axis)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return hi - lo


def smooth_nan(values: NDArray[np.float32], radius: int, passes: int = 2) -> NDArray[np.float32]:
    """Box-blur ``values`` ``passes`` times (≈ Gaussian), ignoring NaNs and keeping them NaN."""
    if radius <= 0:
        return values
    nan = np.isnan(values)
    v = np.where(nan, 0.0, values).astype(np.float64)
    w = (~nan).astype(np.float64)
    for _ in range(passes):
        for axis in (0, 1):
            v, w = _box_sum(v, radius, axis), _box_sum(w, radius, axis)
        # renormalise so the next pass blurs heights, not weighted sums
        with np.errstate(invalid="ignore", divide="ignore"):
            v = np.where(w > 0, v / w, 0.0)
        w = (w > 0).astype(np.float64)
    out = v.astype(np.float32)
    out[nan] = np.nan
    return out


def smooth_heights(grid: HeightGrid, radius_m: float, stud_m: float = 0.5) -> HeightGrid:
    return HeightGrid(grid.I0, grid.J0, smooth_nan(grid.values, int(round(radius_m / stud_m))))
