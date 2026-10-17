"""Sunrise / sunset (NOAA solar position approximation, ~1 min accuracy).

Used as a fallback when the weather feed carries no sunrise/sunset.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone


def _julian_day(d: date) -> float:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp() / 86400.0 + 2440587.5


def sun_times(d: date, lat: float, lon: float) -> tuple[int | None, int | None]:
    """Unix seconds of sunrise and sunset (UTC) on calendar date ``d`` at lat/lon.

    Returns ``(None, None)`` during polar day/night.
    """
    n = math.ceil(_julian_day(d) - 2451545.0 + 0.0008)
    j_star = n - lon / 360.0
    m = math.radians((357.5291 + 0.98560028 * j_star) % 360.0)
    c = 1.9148 * math.sin(m) + 0.02 * math.sin(2 * m) + 0.0003 * math.sin(3 * m)
    lam = math.radians((math.degrees(m) + c + 180.0 + 102.9372) % 360.0)
    j_transit = 2451545.0 + j_star + 0.0053 * math.sin(m) - 0.0069 * math.sin(2 * lam)
    decl = math.asin(math.sin(lam) * math.sin(math.radians(23.4397)))
    phi = math.radians(lat)
    cos_w = (math.sin(math.radians(-0.833)) - math.sin(phi) * math.sin(decl)) / (math.cos(phi) * math.cos(decl))
    if not -1.0 <= cos_w <= 1.0:
        return None, None
    w = math.degrees(math.acos(cos_w)) / 360.0

    def to_unix(jd: float) -> int:
        return int(round((jd - 2440587.5) * 86400.0))

    return to_unix(j_transit - w), to_unix(j_transit + w)

