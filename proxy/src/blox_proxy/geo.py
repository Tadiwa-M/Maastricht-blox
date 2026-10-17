"""Coordinate conversion: WGS84 <-> RD New (EPSG:28992) -> Unity world metres.

CONTRACT.md section 1: ``unity.x = I * 0.5`` with ``I = (x - x0) / 0.5``, i.e. world
metres are simply RD metres relative to the slice SW corner (east -> x, north -> z).
Positions are continuous here; Unity floors to cells itself if it needs a grid cell.
"""

from __future__ import annotations

import math
from functools import lru_cache

from pyproj import Transformer

from .config import ORIGIN_RD_X, ORIGIN_RD_Y, STUD_M


@lru_cache(maxsize=1)
def _to_rd() -> Transformer:
    return Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)


@lru_cache(maxsize=1)
def _to_wgs() -> Transformer:
    return Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)


def wgs84_to_rd(lat: float, lon: float) -> tuple[float, float]:
    x, y = _to_rd().transform(lon, lat)
    return float(x), float(y)


def wgs84_to_rd_many(lats: list[float], lons: list[float]) -> list[tuple[float, float]]:
    """Batch version of ``wgs84_to_rd`` (one PROJ call; much faster for big lists)."""
    if not lats:
        return []
    xs, ys = _to_rd().transform(lons, lats)
    return [(float(x), float(y)) for x, y in zip(xs, ys)]


def rd_to_wgs84(x: float, y: float) -> tuple[float, float]:
    """Returns ``(lat, lon)``."""
    lon, lat = _to_wgs().transform(x, y)
    return float(lat), float(lon)


def rd_to_world(x: float, y: float) -> tuple[float, float]:
    """RD metres -> Unity world ``(x, z)`` metres."""
    return x - ORIGIN_RD_X, y - ORIGIN_RD_Y


def world_to_rd(wx: float, wz: float) -> tuple[float, float]:
    return wx + ORIGIN_RD_X, wz + ORIGIN_RD_Y


def wgs84_to_world(lat: float, lon: float) -> tuple[float, float]:
    return rd_to_world(*wgs84_to_rd(lat, lon))


def rd_to_cell(x: float, y: float) -> tuple[int, int]:
    """RD -> global grid cell ``(I, J)`` (CONTRACT section 1)."""
    return math.floor((x - ORIGIN_RD_X) / STUD_M), math.floor((y - ORIGIN_RD_Y) / STUD_M)


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def round_world(v: float) -> float:
    return round(v, 2)
