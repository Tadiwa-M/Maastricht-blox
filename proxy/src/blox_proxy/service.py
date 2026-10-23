"""Wires settings, upstream clients, pollers and the latest data together.

Stale-data policy: every source keeps its last good result and serves it with its own
``ts``; a failed poll only updates health. Vehicles whose last report is older than
``vehicle_max_age_s`` are dropped (frozen buses are worse than missing ones).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from .config import LIVE_BBOX_RD, MAASTRICHT_LAT, MAASTRICHT_LON, Settings
from .gtfs.static import GtfsStatic
from .http import ConditionalFetcher, make_client
from .matching import ShapeMatcher
from .scheduler import Poller, Scheduler
from .shapes_api import shapes_payload, stops_payload
from .sources.buienradar import fetch_weather
from .sources.gtfs_rt import VehicleObs, parse_trip_delays, parse_vehicle_positions
from .sources.ns import NsTrainClient
from .vehicles import build_vehicles
from .water.base import WaterClient, to_contract
from .water.rws_ddapi20 import RwsDdapi20Client

log = logging.getLogger(__name__)


class LiveService:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient | None = None,
        water_client: WaterClient | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.settings = settings
        self.client = client or make_client()
        self.clock = clock
        self.static = GtfsStatic(settings)
        self.matcher = ShapeMatcher()
        self.scheduler = Scheduler()

        self._vp = ConditionalFetcher(self.client, settings.gtfs_rt_vehicles_url)
        self._tu = ConditionalFetcher(self.client, settings.gtfs_rt_trip_updates_url)
        self._obs: list[VehicleObs] = []
        self._feed_ts: int | None = None
        self._delays: dict[str, int] = {}
        self._bus_vehicles: list[dict[str, Any]] = []
        self._train_vehicles: list[dict[str, Any]] = []

        self.weather: dict[str, Any] | None = None
        self.water: dict[str, Any] | None = None
        self.water_client: WaterClient = water_client or RwsDdapi20Client(
            self.client, settings.rws_base_url, settings.rws_location_code, settings.rws_station_name
        )
        self.ns: NsTrainClient | None = (
            NsTrainClient(self.client, settings.ns_vehicles_url, settings.ns_api_key, MAASTRICHT_LAT, MAASTRICHT_LON)
            if settings.ns_api_key
            else None
        )
        self._shapes_cache: tuple[int, dict[str, Any], dict[str, Any]] | None = None
        self._register_pollers()

    # --- pollers ---------------------------------------------------------------------
    def _register_pollers(self) -> None:
        s = self.settings
        common = {"backoff_initial_s": s.backoff_initial_s, "backoff_max_s": s.backoff_max_s, "clock": self.clock}
        self.scheduler.add(Poller("ovapi_static", s.gtfs_static_check_interval_s, self.step_gtfs_static, **common))
        self.scheduler.add(Poller("ovapi", s.effective_rt_interval_s, self.step_gtfs_rt, **common))
        self.scheduler.add(Poller("buienradar", s.weather_interval_s, self.step_weather, **common))
        self.scheduler.add(Poller("rws", s.water_interval_s, self.step_water, **common))
        if self.ns is not None:
            self.scheduler.add(Poller("ns", max(s.ns_interval_s, 15.0), self.step_ns, **common))

    async def step_gtfs_static(self) -> None:
        built = self.static.index.meta.get("builtAt")
        fresh = isinstance(built, int) and self.clock() - built < self.settings.gtfs_static_check_interval_s
        if self.static.loaded and fresh:
            return  # cache is recent: skip even the conditional request at startup
        await self.static.refresh(self.client)

    async def step_gtfs_rt(self) -> None:
        now = int(self.clock())
        vp = await self._vp.fetch()
        if vp is not None:
            self._feed_ts, self._obs = parse_vehicle_positions(vp)
        tu = await self._tu.fetch()
        if tu is not None:
            self._delays = parse_trip_delays(tu, now)
        self._rebuild_bus_vehicles(now)

    def _rebuild_bus_vehicles(self, now: int) -> None:
        self._bus_vehicles = build_vehicles(
            self._obs, self._delays, self.static.index, self.matcher, LIVE_BBOX_RD, now, self._feed_ts, self.settings.vehicle_max_age_s
        )

    async def step_weather(self) -> None:
        self.weather = await fetch_weather(self.client, self.settings.buienradar_url, MAASTRICHT_LAT, MAASTRICHT_LON, int(self.clock()))

    async def step_water(self) -> None:
        self.water = to_contract(await self.water_client.fetch())

    async def step_ns(self) -> None:
        assert self.ns is not None
        self._train_vehicles = await self.ns.fetch(LIVE_BBOX_RD)

    # --- views -----------------------------------------------------------------------
    def vehicles_payload(self) -> dict[str, Any]:
        now = self.clock()
        cutoff = now - self.settings.vehicle_max_age_s
        vehicles = [v for v in self._bus_vehicles + self._train_vehicles if v["observedTs"] >= cutoff]
        # ``ts`` is the proxy's clock at response time: Unity syncs its render clock to it
        # (LiveClock), so it must advance in real time. The upstream feed header time stays
        # constant across 304 polls and is 0 before the first fetch; it must not be used here.
        return {"ts": int(now), "vehicles": vehicles}

    def _static_payloads(self) -> tuple[dict[str, Any], dict[str, Any]]:
        if self._shapes_cache is None or self._shapes_cache[0] != self.static.version:
            idx = self.static.index
            self._shapes_cache = (self.static.version, shapes_payload(idx, LIVE_BBOX_RD), stops_payload(idx, LIVE_BBOX_RD))
        return self._shapes_cache[1], self._shapes_cache[2]

    def shapes(self) -> dict[str, Any]:
        return self._static_payloads()[0]

    def stops(self) -> dict[str, Any]:
        return self._static_payloads()[1]

    def health(self) -> dict[str, Any]:
        return self.scheduler.health(self.clock())

    # --- lifecycle -------------------------------------------------------------------
    async def start(self) -> None:
        if self.static.load_cached():
            log.info("using cached GTFS slice; background check for a newer feed")
        else:
            log.info("no GTFS slice cache yet: downloading + preprocessing in the background")
        self.scheduler.start()

    async def stop(self) -> None:
        await self.scheduler.stop()
        await self.client.aclose()
