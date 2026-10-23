"""Static configuration: contract constants, upstream endpoints, poll intervals.

Every value can be overridden with an environment variable (see ``Settings.from_env``)
so the user can fix an endpoint or station code without touching code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# --- CONTRACT.md section 1 -------------------------------------------------------------
ORIGIN_RD_X = 175700.0
ORIGIN_RD_Y = 316500.0
SLICE_SIZE_M = 2048.0  # 4096 studs x 0.5 m
STUD_M = 0.5
PLATE_M = 0.2
BASE_NAP_M = 30.0

# --- CONTRACT.md section 8 -------------------------------------------------------------
LIVE_MARGIN_M = 500.0  # vehicles inside slice bbox + 500 m margin
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787

USER_AGENT = "MaastrichtBlox/0.1 (+https://github.com/Tadiwa-M/maastricht-blox)"

# Maastricht centre (Vrijthof), used to pick the nearest weather station.
MAASTRICHT_LAT = 50.8489
MAASTRICHT_LON = 5.6880

MIN_GTFS_RT_INTERVAL_S = 15.0  # OVapi fair use: never poll faster than this


@dataclass(frozen=True)
class BBoxRD:
    """Axis-aligned bounding box in RD New metres."""

    xmin: float
    ymin: float
    xmax: float
    ymax: float

    def contains(self, x: float, y: float) -> bool:
        return self.xmin <= x <= self.xmax and self.ymin <= y <= self.ymax

    def expanded(self, margin: float) -> "BBoxRD":
        return BBoxRD(self.xmin - margin, self.ymin - margin, self.xmax + margin, self.ymax + margin)


SLICE_BBOX_RD = BBoxRD(ORIGIN_RD_X, ORIGIN_RD_Y, ORIGIN_RD_X + SLICE_SIZE_M, ORIGIN_RD_Y + SLICE_SIZE_M)
LIVE_BBOX_RD = SLICE_BBOX_RD.expanded(LIVE_MARGIN_M)


def _default_cache_dir() -> Path:
    # src/blox_proxy/config.py -> proxy/.cache
    return Path(__file__).resolve().parents[2] / ".cache"


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw not in (None, "") else default


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name)
    return raw if raw not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    cache_dir: Path = field(default_factory=_default_cache_dir)

    # OVapi
    gtfs_static_url: str = "https://gtfs.ovapi.nl/gtfs-nl.zip"
    gtfs_rt_vehicles_url: str = "https://gtfs.ovapi.nl/nl/vehiclePositions.pb"
    gtfs_rt_trip_updates_url: str = "https://gtfs.ovapi.nl/nl/tripUpdates.pb"
    gtfs_rt_interval_s: float = 20.0
    gtfs_static_check_interval_s: float = 24 * 3600.0
    gtfs_static_filter_margin_m: float = LIVE_MARGIN_M
    shape_densify_m: float = 10.0
    vehicle_max_age_s: float = 300.0  # drop vehicles whose last report is older than this

    # Buienradar
    buienradar_url: str = "https://data.buienradar.nl/2.0/feed/json"
    weather_interval_s: float = 600.0

    # Rijkswaterstaat (DDAPI20). Location code is UNVERIFIED: see docs/DATA_SOURCES.md s.8
    # and run `uv run blox-proxy-rws-locations` on a networked PC to find the right code.
    rws_base_url: str = "https://ddapi20-waterwebservices.rijkswaterstaat.nl"
    rws_location_code: str = "maastricht.borgharen.maas.beneden"
    rws_station_name: str = "Maastricht Sint Pieter"
    water_interval_s: float = 600.0

    # NS (optional; only enabled when NS_API_KEY is set)
    ns_api_key: str | None = None
    ns_vehicles_url: str = "https://gateway.apiportal.ns.nl/virtual-train-api/v1/vehicle"
    ns_interval_s: float = 30.0

    # Backoff after upstream errors
    backoff_initial_s: float = 30.0
    backoff_max_s: float = 900.0

    @property
    def effective_rt_interval_s(self) -> float:
        return max(self.gtfs_rt_interval_s, MIN_GTFS_RT_INTERVAL_S)

    @classmethod
    def from_env(cls) -> "Settings":
        d = cls()
        return cls(
            host=_env_str("BLOX_PROXY_HOST", d.host),
            port=int(_env_float("BLOX_PROXY_PORT", d.port)),
            cache_dir=Path(_env_str("BLOX_PROXY_CACHE", str(d.cache_dir))),
            gtfs_static_url=_env_str("BLOX_GTFS_URL", d.gtfs_static_url),
            gtfs_rt_vehicles_url=_env_str("BLOX_GTFS_RT_VEHICLES_URL", d.gtfs_rt_vehicles_url),
            gtfs_rt_trip_updates_url=_env_str("BLOX_GTFS_RT_TRIPS_URL", d.gtfs_rt_trip_updates_url),
            gtfs_rt_interval_s=_env_float("BLOX_GTFS_RT_INTERVAL", d.gtfs_rt_interval_s),
            buienradar_url=_env_str("BLOX_BUIENRADAR_URL", d.buienradar_url),
            weather_interval_s=_env_float("BLOX_WEATHER_INTERVAL", d.weather_interval_s),
            rws_base_url=_env_str("BLOX_RWS_BASE_URL", d.rws_base_url),
            rws_location_code=_env_str("BLOX_RWS_LOCATION", d.rws_location_code),
            rws_station_name=_env_str("BLOX_RWS_STATION_NAME", d.rws_station_name),
            water_interval_s=_env_float("BLOX_WATER_INTERVAL", d.water_interval_s),
            ns_api_key=os.environ.get("NS_API_KEY") or None,
            ns_vehicles_url=_env_str("BLOX_NS_VEHICLES_URL", d.ns_vehicles_url),
        )
