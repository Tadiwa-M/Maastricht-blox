"""Buienradar JSON feed (https://data.buienradar.nl/2.0/feed/json) -> contract weather.

Feed facts (docs/DATA_SOURCES.md s.6): station list in ``actual.stationmeasurements``,
timestamps are local Europe/Amsterdam without offset, wind speed in m/s, ``precipitation``
in mm/h. The feed has no cloud-cover field, so ``cloudPct`` is *derived* from the weather
icon/condition (documented as an estimate, see ``_CLOUD_BY_CONDITION``).
Terms: non-commercial use; credit Buienradar.nl with a link to https://www.buienradar.nl.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..geo import haversine_m
from ..http import UpstreamError
from ..sun import sun_times

AMS = ZoneInfo("Europe/Amsterdam")

# Buienradar icon letter (last path part of ``iconurl``, e.g. ".../30x30/c.png") -> condition.
# Letters follow the python-buienradar condition table.
_ICON_CONDITION: dict[str, str] = {
    "a": "clear", "b": "partly_cloudy", "j": "partly_cloudy", "o": "partly_cloudy", "r": "partly_cloudy",
    "c": "cloudy", "p": "cloudy",
    "d": "fog", "n": "fog",
    "f": "rain", "h": "rain", "k": "rain", "l": "rain", "m": "rain", "q": "heavy_rain",
    "g": "thunder", "s": "thunder",
    "i": "snow", "t": "snow", "u": "snow", "v": "snow", "w": "snow",
}
# Dutch description keywords, checked in order (most severe first).
_DESC_CONDITION: list[tuple[str, str]] = [
    ("onweer", "thunder"), ("bliksem", "thunder"),
    ("sneeuw", "snow"), ("hagel", "snow"), ("ijzel", "snow"),
    ("zware regen", "heavy_rain"), ("hevige", "heavy_rain"),
    ("regen", "rain"), ("buien", "rain"), ("motregen", "rain"),
    ("mist", "fog"), ("nevel", "fog"),
    ("zwaar bewolkt", "cloudy"), ("geheel bewolkt", "cloudy"), ("bewolkt", "cloudy"),
    ("opklaringen", "partly_cloudy"), ("half bewolkt", "partly_cloudy"),
    ("zonnig", "clear"), ("helder", "clear"), ("onbewolkt", "clear"),
]
_CLOUD_BY_CONDITION = {
    "clear": 10, "partly_cloudy": 50, "cloudy": 90, "rain": 90, "heavy_rain": 100,
    "snow": 90, "fog": 100, "thunder": 90,
}
HEAVY_RAIN_MM_H = 4.0


def _num(v: Any) -> float | None:
    if v is None or v == "" or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def parse_local_ts(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=AMS)
    return int(dt.timestamp())


def condition_from(icon_url: str | None, description: str | None, precip_mm_h: float | None) -> str:
    cond: str | None = None
    if icon_url:
        # Night icons are either doubled ("cc.png", as the live feed uses) or "<x>n.png".
        m = re.search(r"/([a-z])(?:\1|n)?\.png$", icon_url.strip().lower())
        if m:
            cond = _ICON_CONDITION.get(m.group(1))
    if cond is None and description:
        d = description.lower()
        cond = next((c for kw, c in _DESC_CONDITION if kw in d), None)
    if cond is None:
        cond = "rain" if (precip_mm_h or 0.0) > 0.1 else "cloudy"
    if cond == "rain" and (precip_mm_h or 0.0) >= HEAVY_RAIN_MM_H:
        cond = "heavy_rain"
    return cond


def nearest_station(stations: list[dict[str, Any]], lat: float, lon: float) -> dict[str, Any]:
    usable = [s for s in stations if _num(s.get("lat")) is not None and _num(s.get("lon")) is not None and _num(s.get("temperature")) is not None]
    if not usable:
        raise UpstreamError("buienradar: no station with position and temperature")
    return min(usable, key=lambda s: haversine_m(lat, lon, float(s["lat"]), float(s["lon"])))


def parse_feed(doc: dict[str, Any], lat: float, lon: float, now: int) -> dict[str, Any]:
    actual = doc.get("actual")
    if not isinstance(actual, dict):
        raise UpstreamError("buienradar: missing 'actual'")
    st = nearest_station(list(actual.get("stationmeasurements") or []), lat, lon)
    precip = _num(st.get("precipitation"))
    if precip is None:
        precip = _num(st.get("rainFallLastHour"))
    cond = condition_from(st.get("iconurl"), st.get("weatherdescription"), precip)
    wind = _num(st.get("windspeed"))
    wdir = _num(st.get("winddirectiondegrees"))
    ts = parse_local_ts(st.get("timestamp")) or now
    sunrise, sunset = parse_local_ts(actual.get("sunrise")), parse_local_ts(actual.get("sunset"))
    if sunrise is None or sunset is None:
        sr, ss = sun_times(datetime.fromtimestamp(ts, AMS).date(), lat, lon)
        sunrise, sunset = sunrise or sr, sunset or ss
    return {
        "ts": ts,
        "tempC": _num(st.get("temperature")),
        "precipMmH": precip if precip is not None else 0.0,
        "cloudPct": _CLOUD_BY_CONDITION[cond],
        "windMps": wind,
        "windDirDeg": wdir,
        "condition": cond,
        "sunrise": sunrise,
        "sunset": sunset,
        "source": "buienradar",
    }


async def fetch_weather(client: httpx.AsyncClient, url: str, lat: float, lon: float, now: int) -> dict[str, Any]:
    resp = await client.get(url)
    if resp.status_code != 200:
        raise UpstreamError(f"GET {url} -> HTTP {resp.status_code}")
    try:
        doc = resp.json()
    except json.JSONDecodeError as e:
        raise UpstreamError(f"buienradar: invalid JSON: {e}") from e
    return parse_feed(doc, lat, lon, now)
