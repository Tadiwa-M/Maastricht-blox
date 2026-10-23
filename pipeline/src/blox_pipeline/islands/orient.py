"""Which way does a building face? The dominant wall direction of a footprint.

Walls of a building mostly meet at right angles, so a wall at 20 deg and its neighbour at
110 deg say the same thing: "this building is turned 20 deg". Working **modulo 90 deg** folds
all four wall directions onto one angle. Folding is done by multiplying angles by 4, which
makes "mod 90" a full circle, so averaging is an ordinary circular mean.

A plain length-weighted circular mean can be dragged by a chamfered corner or a bay window.
So this is a two-step estimate:

1. a length-weighted histogram of edge angles (0.5 deg bins on the folded circle, smoothed
   over +-2 deg) gives the peak direction;
2. the circular mean of only the edges within ``REFINE_DEG`` of that peak refines it.

The result ``theta`` is in (-45, 45] degrees, counter-clockwise from east. The island yaw
(clockwise from north, CONTRACT 5.1) that lines local +i up with that wall is ``-theta``.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

BIN_DEG = 0.5
SMOOTH_DEG = 2.0
REFINE_DEG = 5.0
MIN_EDGE_M = 0.2  # shorter edges (digitising noise) are ignored


def wrap90(deg: float) -> float:
    """Fold an angle into (-45, 45] (mod 90)."""
    a = (deg + 45.0) % 90.0 - 45.0
    return 45.0 if a <= -45.0 + 1e-9 else a


def edges(geom: BaseGeometry) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """``(angle_deg, length_m)`` of every ring edge of a (multi)polygon, angle CCW from east."""
    polys = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
    ang, ln = [], []
    for p in polys:
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        for ring in [p.exterior, *p.interiors]:
            c = np.asarray(ring.coords)[:, :2]
            d = np.diff(c, axis=0)
            length = np.hypot(d[:, 0], d[:, 1])
            keep = length >= MIN_EDGE_M
            ang.append(np.degrees(np.arctan2(d[keep, 1], d[keep, 0])))
            ln.append(length[keep])
    if not ang:
        return np.zeros(0), np.zeros(0)
    return np.concatenate(ang), np.concatenate(ln)


def dominant_angle(angles: NDArray[np.float64], lengths: NDArray[np.float64]) -> float:
    """Dominant wall direction (deg, (-45, 45], CCW from east) of weighted edge angles."""
    if len(angles) == 0 or lengths.sum() <= 0:
        return 0.0
    folded = np.mod(angles, 90.0)  # [0, 90)
    n = int(round(90.0 / BIN_DEG))
    hist = np.bincount((folded / BIN_DEG).astype(np.int64) % n, weights=lengths, minlength=n)
    w = int(round(SMOOTH_DEG / BIN_DEG))
    smooth = sum(np.roll(hist, s) for s in range(-w, w + 1))
    peak = (int(np.argmax(smooth)) + 0.5) * BIN_DEG
    near = np.abs(np.vectorize(wrap90)(folded - peak)) <= REFINE_DEG
    a4 = np.radians(4.0 * folded[near])
    mean = math.degrees(math.atan2(float((lengths[near] * np.sin(a4)).sum()),
                                   float((lengths[near] * np.cos(a4)).sum()))) / 4.0
    return wrap90(mean)


def footprint_yaw(geom: BaseGeometry) -> tuple[float, float]:
    """``(yaw_deg, wall_length_m)``: island yaw that puts the main wall on local +i."""
    a, ln = edges(geom)
    return wrap90(-dominant_angle(a, ln)), float(ln.sum())


def yaw_diff(a: float, b: float) -> float:
    """Smallest difference of two yaws modulo 90 deg."""
    return abs(wrap90(a - b))


__all__ = ["dominant_angle", "edges", "footprint_yaw", "wrap90", "yaw_diff"]
