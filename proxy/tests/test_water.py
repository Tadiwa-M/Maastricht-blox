from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
import pytest

from blox_proxy.http import UpstreamError, make_client
from blox_proxy.water.base import LevelSample, WaterReading, to_contract, trend
from blox_proxy.water.locations import filter_locations
from blox_proxy.water.rws_ddapi20 import RwsDdapi20Client, build_request, format_rws_time, parse_response

from builders import rws_doc

RISING = [
    ("2026-10-17T12:00:00.000+02:00", 4390.0),
    ("2026-10-17T12:30:00.000+02:00", 4400.0),
    ("2026-10-17T13:00:00.000+02:00", 4410.0),
    ("2026-10-17T13:10:00.000+02:00", 999999999.0),  # RWS "no value" sentinel
]


def test_parse_response_converts_cm_to_m_and_skips_sentinels() -> None:
    r = parse_response(rws_doc(RISING), "Maastricht Sint Pieter")
    assert [s.level_m_nap for s in r.samples] == pytest.approx([43.9, 44.0, 44.1])
    assert r.latest.ts == int(datetime(2026, 10, 17, 11, 0, tzinfo=timezone.utc).timestamp())
    assert to_contract(r) == {
        "ts": r.latest.ts,
        "station": "Maastricht Sint Pieter",
        "levelMNap": 44.1,
        "trend": "rising",
        "source": "rws",
    }


def test_unsuccessful_or_empty_raises() -> None:
    with pytest.raises(UpstreamError):
        parse_response({"Succesvol": False, "Foutmelding": "Geen gegevens"}, "x")
    with pytest.raises(UpstreamError):
        parse_response(rws_doc([]), "x")


def test_trend() -> None:
    s = lambda t, v: LevelSample(t, v)  # noqa: E731
    assert trend([s(0, 44.0)]) == "steady"
    assert trend([s(0, 44.10), s(3600, 44.0)]) == "falling"
    assert trend([s(0, 44.0), s(3600, 44.01)]) == "steady"
    assert trend([s(0, 40.0), s(7200, 44.0), s(10800, 44.05)]) == "rising"  # only last hour counts


def test_request_format() -> None:
    dt = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
    assert format_rws_time(dt) == "2026-10-17T12:00:00.000+02:00"
    body = build_request("code.x", dt, dt)
    assert body["Locatie"] == {"Code": "code.x"}
    assert body["AquoPlusWaarnemingMetadata"]["AquoMetadata"]["Grootheid"]["Code"] == "WATHTE"
    assert body["Periode"]["Einddatumtijd"] == "2026-10-17T12:00:00.000+02:00"


async def test_client_posts_and_parses() -> None:
    seen: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"] = str(req.url)
        seen["method"] = req.method
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json=rws_doc(RISING))

    async with make_client(transport=httpx.MockTransport(handler)) as c:
        r = await RwsDdapi20Client(c, "https://ddapi20-waterwebservices.rijkswaterstaat.nl", "loc.code", "Maastricht Sint Pieter").fetch()
    assert seen["method"] == "POST"
    assert seen["url"] == "https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen"
    assert seen["body"]["Locatie"]["Code"] == "loc.code"  # type: ignore[index]
    assert isinstance(r, WaterReading) and r.latest.level_m_nap == pytest.approx(44.1)


async def test_client_204_is_error() -> None:
    async with make_client(transport=httpx.MockTransport(lambda r: httpx.Response(204))) as c:
        with pytest.raises(UpstreamError, match="204"):
            await RwsDdapi20Client(c, "https://h", "loc", "n").fetch()


def test_location_filter() -> None:
    doc = {"LocatieLijst": [
        {"Code": "maastricht.borgharen.maas.beneden", "Naam": "Borgharen Dorp"},
        {"Code": "sintpieter.noord", "Naam": "Sint Pieter Noord"},
        {"Code": "lobith.bovenrijn.tolkamer", "Naam": "Lobith"},
    ]}
    assert filter_locations(doc, "pieter|borgharen") == [
        ("maastricht.borgharen.maas.beneden", "Borgharen Dorp"),
        ("sintpieter.noord", "Sint Pieter Noord"),
    ]
