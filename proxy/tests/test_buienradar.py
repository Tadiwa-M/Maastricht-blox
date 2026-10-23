from __future__ import annotations

import httpx
import pytest

from blox_proxy.http import UpstreamError, make_client
from blox_proxy.sources.buienradar import condition_from, fetch_weather, parse_feed, parse_local_ts
from blox_proxy.sun import sun_times

from builders import buienradar_doc

LAT, LON = 50.8489, 5.6880


def test_parse_feed_picks_nearest_usable_station_and_maps_fields() -> None:
    w = parse_feed(buienradar_doc(), LAT, LON, now=0)
    assert w == {
        "ts": parse_local_ts("2026-10-17T14:50:00"),
        "tempC": 12.3,
        "precipMmH": 0.4,
        "cloudPct": 100,
        "windMps": 4.2,
        "windDirDeg": 230.0,
        "condition": "heavy_rain",  # icon 'q'
        "sunrise": parse_local_ts("2026-10-17T08:12:00"),
        "sunset": parse_local_ts("2026-10-17T18:46:00"),
        "source": "buienradar",
    }


def test_local_timestamps_are_europe_amsterdam() -> None:
    # 17 Oct 2026 is CEST (UTC+2)
    assert parse_local_ts("2026-10-17T14:50:00") == 1792241400
    assert parse_local_ts("2026-01-17T14:50:00") == 1768657800  # CET (UTC+1)


@pytest.mark.parametrize(
    ("icon", "desc", "precip", "expected"),
    [
        ("https://x/30x30/a.png", None, 0.0, "clear"),
        ("https://x/30x30/an.png", None, 0.0, "clear"),  # night icon variant
        ("https://x/30x30/aa.png", None, 0.0, "clear"),  # doubled-letter night icon
        ("https://x/30x30/cc.png", None, 0.0, "cloudy"),
        ("https://x/30x30/b.png", None, 0.0, "partly_cloudy"),
        ("https://x/30x30/c.png", None, 0.0, "cloudy"),
        ("https://x/30x30/d.png", None, 0.0, "fog"),
        ("https://x/30x30/f.png", None, 0.5, "rain"),
        ("https://x/30x30/f.png", None, 6.0, "heavy_rain"),
        ("https://x/30x30/s.png", None, 0.0, "thunder"),
        ("https://x/30x30/t.png", None, 0.0, "snow"),
        (None, "Zonnig", 0.0, "clear"),
        (None, "Mix van opklaringen en hoge bewolking", 0.0, "partly_cloudy"),
        (None, "Mist", 0.0, "fog"),
        (None, None, 1.0, "rain"),
    ],
)
def test_condition_mapping(icon: str | None, desc: str | None, precip: float, expected: str) -> None:
    assert condition_from(icon, desc, precip) == expected


def test_missing_sunrise_falls_back_to_computed() -> None:
    doc = buienradar_doc()
    del doc["actual"]["sunrise"]  # type: ignore[index]
    w = parse_feed(doc, LAT, LON, now=0)
    assert w["sunrise"] is not None and abs(w["sunrise"] - parse_local_ts("2026-10-17T08:12:00")) < 15 * 60


def test_sun_times_maastricht_october() -> None:
    from datetime import date

    rise, sset = sun_times(date(2026, 10, 17), LAT, LON)
    # Maastricht 17 Oct 2026: sunrise ~08:12 CEST, sunset ~18:46 CEST
    assert rise is not None and sset is not None
    assert abs(rise - 1792217520) < 10 * 60
    assert abs(sset - 1792255560) < 10 * 60


def test_no_stations_raises() -> None:
    with pytest.raises(UpstreamError):
        parse_feed({"actual": {"stationmeasurements": []}}, LAT, LON, 0)


async def test_fetch_weather_over_http() -> None:
    seen: dict[str, str] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["ua"] = req.headers["User-Agent"]
        return httpx.Response(200, json=buienradar_doc())

    async with make_client(transport=httpx.MockTransport(handler)) as c:
        w = await fetch_weather(c, "https://data.buienradar.nl/2.0/feed/json", LAT, LON, 0)
    assert w["tempC"] == 12.3
    assert seen["ua"] == "MaastrichtBlox/0.1 (+https://github.com/Tadiwa-M/maastricht-blox)"
