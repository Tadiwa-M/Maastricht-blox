"""Rijkswaterstaat WaterWebservices, DDAPI20 generation (2026-).

Endpoint: POST {base}/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen, JSON body, no auth.
Request/response shapes follow Deltares ``ddlpy`` (>= 0.8, which targets ddapi20):
WATHTE (water height) in the surface-water compartment OW, values in **cm NAP**,
timestamps like ``2026-10-17T12:00:00.000+01:00``. HTTP 204 means "no data".
The location code for Maastricht is UNVERIFIED and lives in config (BLOX_RWS_LOCATION).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from ..http import UpstreamError
from .base import LevelSample, WaterReading

AMS = ZoneInfo("Europe/Amsterdam")
MISSING_VALUE_THRESHOLD = 1e8  # RWS uses 999999999 for "no value"
PATH = "/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen"


def format_rws_time(dt: datetime) -> str:
    """RWS only accepts ``YYYY-MM-DDTHH:MM:SS.000+HH:MM`` (other formats give HTTP 500)."""
    local = dt.astimezone(AMS)
    off = local.strftime("%z")
    return local.strftime("%Y-%m-%dT%H:%M:%S") + ".000" + off[:3] + ":" + off[3:]


def build_request(location_code: str, start: datetime, end: datetime) -> dict[str, Any]:
    return {
        "Locatie": {"Code": location_code},
        "AquoPlusWaarnemingMetadata": {
            "AquoMetadata": {"Compartiment": {"Code": "OW"}, "Grootheid": {"Code": "WATHTE"}}
        },
        "Periode": {"Begindatumtijd": format_rws_time(start), "Einddatumtijd": format_rws_time(end)},
    }


def parse_response(doc: dict[str, Any], fallback_station: str) -> WaterReading:
    if doc.get("Succesvol") is False:
        raise UpstreamError(f"rws: unsuccessful: {doc.get('Foutmelding') or 'no message'}")
    samples: list[LevelSample] = []
    station = fallback_station
    for obs in doc.get("WaarnemingenLijst") or []:
        unit = (((obs.get("AquoMetadata") or {}).get("Eenheid") or {}).get("Code") or "cm").lower()
        scale = 0.01 if unit == "cm" else 1.0
        for m in obs.get("MetingenLijst") or []:
            val = (m.get("Meetwaarde") or {}).get("Waarde_Numeriek")
            tijd = m.get("Tijdstip")
            if val is None or tijd is None or abs(float(val)) >= MISSING_VALUE_THRESHOLD:
                continue
            samples.append(LevelSample(int(datetime.fromisoformat(tijd).timestamp()), float(val) * scale))
    if not samples:
        raise UpstreamError("rws: no usable WATHTE measurements in response")
    samples.sort(key=lambda s: s.ts)
    return WaterReading(station=station, samples=samples, source="rws")


class RwsDdapi20Client:
    def __init__(self, client: httpx.AsyncClient, base_url: str, location_code: str, station_name: str, history_h: float = 3.0) -> None:
        self._client = client
        self.url = base_url.rstrip("/") + PATH
        self.location_code = location_code
        self.station_name = station_name
        self.history_h = history_h

    async def fetch(self) -> WaterReading:
        end = datetime.now(AMS)
        body = build_request(self.location_code, end - timedelta(hours=self.history_h), end)
        resp = await self._client.post(self.url, json=body)
        if resp.status_code == 204:
            raise UpstreamError(f"rws: no data for location {self.location_code!r} (HTTP 204)")
        if resp.status_code != 200:
            raise UpstreamError(f"POST {self.url} -> HTTP {resp.status_code}: {resp.text[:200]}")
        try:
            doc = resp.json()
        except json.JSONDecodeError as e:
            raise UpstreamError(f"rws: invalid JSON: {e}") from e
        return parse_response(doc, self.station_name)
