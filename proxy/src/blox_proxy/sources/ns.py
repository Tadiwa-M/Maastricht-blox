"""Optional NS Virtual Train API client (only active when NS_API_KEY is set).

Endpoint and payload follow third-party usage (docs/DATA_SOURCES.md s.5) and are
UNVERIFIED against the live API: ``GET .../virtual-train-api/v1/vehicle?lat=&lng=&radius=``
with header ``Ocp-Apim-Subscription-Key``; trains in ``payload.treinen[]`` with
``treinNummer``, ``lat``, ``lng``, ``snelheid`` (km/h), ``richting`` (deg), ``type``.
Without a key this module is never called and the source does not appear in /v1/health.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from ..config import BBoxRD
from ..geo import rd_to_world, round_world, wgs84_to_rd
from ..http import UpstreamError


def parse_trains(doc: dict[str, Any], bbox: BBoxRD, now: int) -> list[dict[str, Any]]:
    payload = doc.get("payload")
    trains = payload.get("treinen") if isinstance(payload, dict) else None
    if not isinstance(trains, list):
        raise UpstreamError("ns: missing payload.treinen")
    out: list[dict[str, Any]] = []
    for t in trains:
        lat, lon = t.get("lat"), t.get("lng")
        if lat is None or lon is None:
            continue
        x, y = wgs84_to_rd(float(lat), float(lon))
        if not bbox.contains(x, y):
            continue
        wx, wz = rd_to_world(x, y)
        speed_kmh = t.get("snelheid")
        bearing = t.get("richting")
        out.append(
            {
                "id": f"NS:{t.get('treinNummer') or t.get('ritId')}",
                "mode": "rail",
                "operator": "NS",
                "routeShort": t.get("type"),
                "routeId": None,
                "tripId": str(t["ritId"]) if t.get("ritId") is not None else None,
                "headsign": None,
                "shapeId": None,
                "lat": round(float(lat), 6),
                "lon": round(float(lon), 6),
                "world": [round_world(wx), round_world(wz)],
                "bearingDeg": float(bearing) if bearing is not None else None,
                "speedMps": round(float(speed_kmh) / 3.6, 2) if speed_kmh is not None else None,
                "distAlongShapeM": None,
                "delaySec": None,
                "observedTs": now,
            }
        )
    return out


class NsTrainClient:
    def __init__(self, client: httpx.AsyncClient, url: str, api_key: str, lat: float, lon: float, radius_m: int = 3000) -> None:
        self._client = client
        self.url = url
        self._key = api_key
        self._params = {"lat": lat, "lng": lon, "radius": radius_m}

    async def fetch(self, bbox: BBoxRD) -> list[dict[str, Any]]:
        resp = await self._client.get(self.url, params=self._params, headers={"Ocp-Apim-Subscription-Key": self._key})
        if resp.status_code != 200:
            raise UpstreamError(f"GET {self.url} -> HTTP {resp.status_code}")
        try:
            doc = resp.json()
        except json.JSONDecodeError as e:
            raise UpstreamError(f"ns: invalid JSON: {e}") from e
        return parse_trains(doc, bbox, int(time.time()))
