"""Rasterise RD geometries onto the stud grid (cell-centre sampling)."""

from __future__ import annotations

import math
import zlib

import numpy as np
import shapely
from numpy.typing import NDArray
from shapely.geometry.base import BaseGeometry

from .. import geo
from ..geo import CellBox


def window_for(geom: BaseGeometry, box: CellBox) -> CellBox | None:
    """Sub-box of ``box`` covering ``geom``'s bounds, or None if disjoint."""
    if geom.is_empty:
        return None
    xmin, ymin, xmax, ymax = geom.bounds
    i0 = max(box.i0, math.floor((xmin - geo.X0) / geo.STUD_M))
    j0 = max(box.j0, math.floor((ymin - geo.Y0) / geo.STUD_M))
    i1 = min(box.i1, math.floor((xmax - geo.X0) / geo.STUD_M) + 1)
    j1 = min(box.j1, math.floor((ymax - geo.Y0) / geo.STUD_M) + 1)
    if i0 >= i1 or j0 >= j1:
        return None
    return CellBox(i0, j0, i1, j1)


def cover(geom: BaseGeometry, box: CellBox) -> tuple[CellBox, NDArray[np.bool_]] | None:
    """Cells of ``box`` whose centre lies in (or on the boundary of) ``geom``.

    Returns the tight window and a boolean mask over it, or None if nothing is covered.
    """
    win = window_for(geom, box)
    if win is None:
        return None
    x, y = geo.cell_centres_rd(win.i0, win.j0, win.ni, win.nj)
    shapely.prepare(geom)
    mask = shapely.intersects_xy(geom, x, y)
    if not mask.any():
        return None
    return win, mask


def paint(target: NDArray, box: CellBox, win: CellBox, mask: NDArray[np.bool_], value) -> None:
    """``target`` covers ``box``; set ``value`` where ``mask`` (over ``win``) is true."""
    view = target[win.i0 - box.i0 : win.i1 - box.i0, win.j0 - box.j0 : win.j1 - box.j0]
    view[mask] = value


def sub(target: NDArray, box: CellBox, win: CellBox) -> NDArray:
    return target[win.i0 - box.i0 : win.i1 - box.i0, win.j0 - box.j0 : win.j1 - box.j0]


def stable_hash(text: str) -> int:
    """Deterministic 32-bit hash (Python's ``hash`` is salted per process)."""
    return zlib.crc32(text.encode("utf-8"))


def cell_hash(I: NDArray, J: NDArray, K: NDArray | int = 0, seed: int = 0) -> NDArray[np.uint32]:
    """Deterministic per-cell hash for colour dithering."""
    h = (np.asarray(I, np.uint64) * np.uint64(73856093)) ^ (np.asarray(J, np.uint64) * np.uint64(19349663))
    h ^= np.asarray(K, np.uint64) * np.uint64(83492791) ^ np.uint64(seed)
    h ^= h >> np.uint64(13)
    h *= np.uint64(0x5BD1E995)
    h ^= h >> np.uint64(15)
    return (h & np.uint64(0xFFFFFFFF)).astype(np.uint32)
