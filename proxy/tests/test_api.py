"""End-to-end: LiveService with every upstream mocked at the HTTP layer + FastAPI TestClient."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from blox_proxy.api import create_app
from blox_proxy.config import Settings
from blox_proxy.http import make_client
from blox_proxy.service import LiveService

from builders import MARKT, VRIJTHOF, buienradar_doc, lerp, rws_doc, trip_update_feed, vehicle_feed

NOW = 1_792_241_400  # 2026-10-17 12:50 UTC
# Responses of the fully-polled fixture service, read back by the C# client tests
# (dotnet/Blox.Tests/LiveTests.cs) as a cross-language check of CONTRACT section 8.
SAMPLES = Path(__file__).parent / "fixtures" / "api_samples"


class Upstream:
    """Routes requests by host/path to fixture payloads; counts hits; can fail on demand."""

    def __init__(self, gtfs_zip: Path) -> None:
        self.gtfs = gtfs_zip.read_bytes()
        self.hits: dict[str, int] = {}
        self.fail: set[str] = set()
        self.etag_seen: list[str | None] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        key = req.url.path.rsplit("/", 1)[-1]
        self.hits[key] = self.hits.get(key, 0) + 1
        if key in self.fail:
            return httpx.Response(503)
        if key == "gtfs-nl.zip":
            return httpx.Response(200, content=self.gtfs, headers={"ETag": '"z1"'})
        if key == "vehiclePositions.pb":
            self.etag_seen.append(req.headers.get("If-None-Match"))
            if req.headers.get("If-None-Match") == '"v1"':
                return httpx.Response(304)
            feed = vehicle_feed(NOW, [{"id": "1234", "trip": "t4", "rd": lerp(VRIJTHOF, MARKT, 0.5), "ts": NOW - 10, "bearing": 40.0}])
            return httpx.Response(200, content=feed, headers={"ETag": '"v1"'})
        if key == "tripUpdates.pb":
            return httpx.Response(200, content=trip_update_feed(NOW))
        if key == "json":
            return httpx.Response(200, json=buienradar_doc())
        if key == "OphalenWaarnemingen":
            return httpx.Response(200, json=rws_doc([("2026-10-17T14:00:00.000+02:00", 4415.0), ("2026-10-17T14:40:00.000+02:00", 4410.0)]))
        return httpx.Response(404)


@pytest.fixture()
def upstream(gtfs_zip: Path) -> Upstream:
    return Upstream(gtfs_zip)


@pytest.fixture()
def service(tmp_path: Path, upstream: Upstream) -> LiveService:
    client = make_client(transport=httpx.MockTransport(upstream))
    return LiveService(Settings(cache_dir=tmp_path), client=client, clock=lambda: float(NOW))


async def _poll_all(svc: LiveService) -> None:
    for p in svc.scheduler.pollers.values():
        await p.run_once()


def test_before_any_data(service: LiveService) -> None:
    with TestClient(create_app(service, run_background=False)) as c:
        h = c.get("/v1/health").json()
        assert h["ok"] is False and set(h["sources"]) == {"ovapi_static", "ovapi", "buienradar", "rws"}
        assert c.get("/v1/vehicles").json() == {"ts": NOW, "vehicles": []}  # proxy clock, never 0
        assert c.get("/v1/shapes").json() == {"shapes": []}
        r = c.get("/v1/weather")
        assert r.status_code == 503 and r.headers["cache-control"] == "no-store"
        assert c.get("/v1/water").status_code == 503


async def test_full_flow(service: LiveService, upstream: Upstream, tmp_path: Path) -> None:
    await _poll_all(service)
    assert (tmp_path / "gtfs_slice.json.gz").exists()
    await service.step_gtfs_rt()  # matched now that static data is loaded

    with TestClient(create_app(service, run_background=False)) as c:
        r = c.get("/v1/health", headers={"Origin": "http://example.org"})
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["access-control-allow-origin"] == "*"
        h = r.json()
        assert h["ok"] is True
        assert h["sources"]["ovapi"] == {"ok": True, "lastFetch": NOW, "error": None}

        v = c.get("/v1/vehicles").json()
        assert v["ts"] == NOW and len(v["vehicles"]) == 1
        veh = v["vehicles"][0]
        assert set(veh) == {"id", "mode", "operator", "routeShort", "routeId", "tripId", "headsign", "shapeId", "lat", "lon",
                            "world", "bearingDeg", "speedMps", "distAlongShapeM", "delaySec", "observedTs"}
        assert veh["id"] == "ARR:1234" and veh["shapeId"] == "sh4" and veh["delaySec"] == 45
        assert veh["distAlongShapeM"] == pytest.approx(189.5, abs=2.0)

        shapes = c.get("/v1/shapes").json()["shapes"]
        assert {s["shapeId"] for s in shapes} == {"sh1", "sh4", "sh30"}
        for s in shapes:
            assert set(s) == {"shapeId", "routeShort", "mode", "color", "points"}
            assert all(len(p) == 3 for p in s["points"])

        stops = c.get("/v1/stops").json()["stops"]
        assert {"stopId", "name", "world"} == set(stops[0])

        w = c.get("/v1/weather").json()
        assert w["condition"] == "heavy_rain" and w["source"] == "buienradar"

        assert c.get("/v1/water").json() == {"ts": 1792240800, "station": "Maastricht Sint Pieter", "levelMNap": 44.1, "trend": "falling", "source": "rws"}

        SAMPLES.mkdir(parents=True, exist_ok=True)
        for name in ("health", "vehicles", "shapes", "stops", "weather", "water"):
            (SAMPLES / f"{name}.json").write_text(c.get(f"/v1/{name}").text, encoding="utf-8")


async def test_conditional_get_and_stale_policy(service: LiveService, upstream: Upstream) -> None:
    await service.step_gtfs_rt()
    await service.step_gtfs_rt()
    assert upstream.etag_seen == [None, '"v1"']  # second poll was conditional -> 304
    assert len(service.vehicles_payload()["vehicles"]) == 1  # 304 keeps last data
    service.clock = lambda: float(NOW + 25)
    assert service.vehicles_payload()["ts"] == NOW + 25  # response clock advances during 304s
    service.clock = lambda: float(NOW)

    weather_poller = service.scheduler.pollers["buienradar"]
    await weather_poller.run_once()
    upstream.fail.add("json")
    assert not await weather_poller.run_once()
    assert service.weather is not None and service.weather["tempC"] == 12.3  # last good served
    assert service.health()["sources"]["buienradar"]["error"] == "UpstreamError: GET https://data.buienradar.nl/2.0/feed/json -> HTTP 503"

    service.clock = lambda: float(NOW + 3600)  # vehicles too old now
    assert service.vehicles_payload()["vehicles"] == []


async def test_static_cache_reused_on_restart(tmp_path: Path, upstream: Upstream) -> None:
    svc = LiveService(Settings(cache_dir=tmp_path), client=make_client(transport=httpx.MockTransport(upstream)), clock=lambda: float(NOW))
    await svc.step_gtfs_static()
    assert upstream.hits["gtfs-nl.zip"] == 1

    import time

    svc2 = LiveService(Settings(cache_dir=tmp_path), client=make_client(transport=httpx.MockTransport(upstream)), clock=time.time)
    assert svc2.static.load_cached() and svc2.static.loaded
    await svc2.step_gtfs_static()  # cache fresh: no request at all
    assert upstream.hits["gtfs-nl.zip"] == 1
