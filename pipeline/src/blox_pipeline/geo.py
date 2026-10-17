"""World coordinate conventions (CONTRACT.md section 1).

Three spaces are used throughout the pipeline:

* **RD**: EPSG:28992 metres (``x`` east, ``y`` north) plus ``z`` in metres NAP.
* **Grid**: integer cells ``(I, J, K)``; ``I`` east, ``J`` north, ``K`` up.
  One cell is 0.5 m x 0.5 m x 0.2 m. ``(0, 0, 0)`` has its min corner at the slice
  origin ``(x0, y0)`` and 30.0 m NAP.
* **WGS84**: EPSG:4326 longitude/latitude in degrees.

Unity world metres are ``(I * 0.5, K * 0.2, J * 0.5)`` for a cell's min corner.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterator

import numpy as np
from numpy.typing import ArrayLike, NDArray
from pyproj import Transformer

X0: float = 175700.0
Y0: float = 316500.0
STUD_M: float = 0.5
PLATE_M: float = 0.2
BASE_NAP_M: float = 30.0
CHUNK_STUDS: int = 64
CHUNKS_X: int = 64
CHUNKS_Y: int = 64
SLICE_STUDS: int = CHUNK_STUDS * CHUNKS_X  # 4096
SLICE_M: float = SLICE_STUDS * STUD_M  # 2048 m

CRS_RD = "EPSG:28992"
CRS_WGS84 = "EPSG:4326"


# --------------------------------------------------------------------------- scalars
def rd_to_grid(x: float, y: float) -> tuple[int, int]:
    """RD metres -> grid cell ``(I, J)`` containing the point."""
    return math.floor((x - X0) / STUD_M), math.floor((y - Y0) / STUD_M)


def z_to_k(z_nap: float) -> int:
    """Height in metres NAP -> grid level ``K`` containing it."""
    return math.floor((z_nap - BASE_NAP_M) / PLATE_M + 1e-9)


def k_to_z(k: int) -> float:
    """Grid level -> height (metres NAP) of the level's bottom face."""
    return BASE_NAP_M + k * PLATE_M


def grid_to_rd(i: float, j: float, centre: bool = False) -> tuple[float, float]:
    """Grid cell -> RD of its min corner (or its centre with ``centre=True``)."""
    off = 0.5 if centre else 0.0
    return X0 + (i + off) * STUD_M, Y0 + (j + off) * STUD_M


def grid_to_unity(i: float, j: float, k: float) -> tuple[float, float, float]:
    """Grid cell min corner -> Unity world metres ``(x, y, z)`` (Y up)."""
    return i * STUD_M, k * PLATE_M, j * STUD_M


def rd_to_unity(x: float, y: float, z_nap: float) -> tuple[float, float, float]:
    """RD + NAP -> Unity world metres ``(x, y, z)`` (continuous, no flooring)."""
    return x - X0, z_nap - BASE_NAP_M, y - Y0


def chunk_of(i: int, j: int) -> tuple[int, int, int, int]:
    """Global cell -> ``(cx, cy, local_i, local_j)``."""
    cx, li = divmod(i, CHUNK_STUDS)
    cy, lj = divmod(j, CHUNK_STUDS)
    return cx, cy, li, lj


# --------------------------------------------------------------------------- vectorised
def rd_to_grid_np(x: ArrayLike, y: ArrayLike) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    xa = np.asarray(x, dtype=np.float64)
    ya = np.asarray(y, dtype=np.float64)
    return (
        np.floor((xa - X0) / STUD_M).astype(np.int64),
        np.floor((ya - Y0) / STUD_M).astype(np.int64),
    )


def z_to_k_np(z: ArrayLike) -> NDArray[np.int64]:
    za = np.asarray(z, dtype=np.float64)
    return np.floor((za - BASE_NAP_M) / PLATE_M + 1e-9).astype(np.int64)


def cell_centres_rd(i0: int, j0: int, ni: int, nj: int) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """RD coordinates of cell centres for an ``ni x nj`` block, as ``[i, j]`` arrays."""
    xs = X0 + (np.arange(i0, i0 + ni) + 0.5) * STUD_M
    ys = Y0 + (np.arange(j0, j0 + nj) + 0.5) * STUD_M
    gx, gy = np.meshgrid(xs, ys, indexing="ij")
    return gx, gy


# --------------------------------------------------------------------------- WGS84
@lru_cache(maxsize=None)
def _transformer(src: str, dst: str) -> Transformer:
    return Transformer.from_crs(src, dst, always_xy=True)


def rd_to_wgs84(x: ArrayLike, y: ArrayLike) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """RD -> ``(lon, lat)``. Accuracy ~1 m without the RDNAPTRANS grid; set
    ``PROJ_NETWORK=ON`` to let PROJ fetch it for cm accuracy."""
    lon, lat = _transformer(CRS_RD, CRS_WGS84).transform(np.asarray(x, float), np.asarray(y, float))
    return np.asarray(lon), np.asarray(lat)


def wgs84_to_rd(lon: ArrayLike, lat: ArrayLike) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    x, y = _transformer(CRS_WGS84, CRS_RD).transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.asarray(x), np.asarray(y)


def grid_to_wgs84(i: float, j: float) -> tuple[float, float]:
    """Cell centre -> ``(lon, lat)``."""
    x, y = grid_to_rd(i, j, centre=True)
    lon, lat = rd_to_wgs84(x, y)
    return float(lon), float(lat)


def wgs84_to_grid(lon: float, lat: float) -> tuple[int, int]:
    x, y = wgs84_to_rd(lon, lat)
    return rd_to_grid(float(x), float(y))


# --------------------------------------------------------------------------- boxes
@dataclass(frozen=True)
class RDBox:
    """Axis-aligned RD box ``[xmin, xmax) x [ymin, ymax)`` in metres."""

    xmin: float
    ymin: float
    xmax: float
    ymax: float

    @classmethod
    def parse(cls, text: str) -> "RDBox":
        parts = [float(p) for p in text.replace(" ", "").split(",")]
        if len(parts) != 4:
            raise ValueError(f"bbox needs 4 numbers xmin,ymin,xmax,ymax, got {text!r}")
        box = cls(*parts)
        if box.xmax <= box.xmin or box.ymax <= box.ymin:
            raise ValueError(f"empty bbox {text!r}")
        return box

    def buffer(self, m: float) -> "RDBox":
        return RDBox(self.xmin - m, self.ymin - m, self.xmax + m, self.ymax + m)

    def intersect(self, other: "RDBox") -> "RDBox":
        return RDBox(
            max(self.xmin, other.xmin), max(self.ymin, other.ymin),
            min(self.xmax, other.xmax), min(self.ymax, other.ymax),
        )

    def to_wgs84(self) -> tuple[float, float, float, float]:
        """Enclosing ``(west, south, east, north)`` in degrees."""
        xs = np.array([self.xmin, self.xmax, self.xmin, self.xmax])
        ys = np.array([self.ymin, self.ymin, self.ymax, self.ymax])
        lon, lat = rd_to_wgs84(xs, ys)
        return float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())

    def as_tuple(self) -> tuple[float, float, float, float]:
        return self.xmin, self.ymin, self.xmax, self.ymax


def slice_box() -> RDBox:
    return RDBox(X0, Y0, X0 + SLICE_M, Y0 + SLICE_M)


@dataclass(frozen=True)
class CellBox:
    """Grid cell box ``[i0, i1) x [j0, j1)`` (global cells)."""

    i0: int
    j0: int
    i1: int
    j1: int

    @property
    def ni(self) -> int:
        return self.i1 - self.i0

    @property
    def nj(self) -> int:
        return self.j1 - self.j0

    def to_rd(self) -> RDBox:
        x0, y0 = grid_to_rd(self.i0, self.j0)
        x1, y1 = grid_to_rd(self.i1, self.j1)
        return RDBox(x0, y0, x1, y1)

    def grow(self, n: int) -> "CellBox":
        return CellBox(self.i0 - n, self.j0 - n, self.i1 + n, self.j1 + n)

    def chunks(self) -> Iterator[tuple[int, int]]:
        """Chunks ``(cx, cy)`` overlapping this box, clipped to the slice."""
        cx0 = max(0, self.i0 // CHUNK_STUDS)
        cy0 = max(0, self.j0 // CHUNK_STUDS)
        cx1 = min(CHUNKS_X, -(-self.i1 // CHUNK_STUDS))
        cy1 = min(CHUNKS_Y, -(-self.j1 // CHUNK_STUDS))
        for cy in range(cy0, cy1):
            for cx in range(cx0, cx1):
                yield cx, cy


def rd_box_to_cells(box: RDBox) -> CellBox:
    """Smallest cell box covering an RD box."""
    i0, j0 = rd_to_grid(box.xmin, box.ymin)
    i1 = math.ceil((box.xmax - X0) / STUD_M)
    j1 = math.ceil((box.ymax - Y0) / STUD_M)
    return CellBox(i0, j0, i1, j1)


def chunk_cells(cx: int, cy: int) -> CellBox:
    return CellBox(cx * CHUNK_STUDS, cy * CHUNK_STUDS, (cx + 1) * CHUNK_STUDS, (cy + 1) * CHUNK_STUDS)


def iter_blocks(box: RDBox, size_m: float) -> Iterator[RDBox]:
    """Split a box into ``size_m`` blocks aligned to the slice origin (stable cache keys)."""
    bx0 = math.floor((box.xmin - X0) / size_m)
    by0 = math.floor((box.ymin - Y0) / size_m)
    bx1 = math.ceil((box.xmax - X0) / size_m)
    by1 = math.ceil((box.ymax - Y0) / size_m)
    for by in range(by0, by1):
        for bx in range(bx0, bx1):
            x = X0 + bx * size_m
            y = Y0 + by * size_m
            yield RDBox(x, y, x + size_m, y + size_m)
