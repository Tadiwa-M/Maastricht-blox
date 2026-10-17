from __future__ import annotations

import pytest

from blox_proxy.config import LIVE_BBOX_RD, Settings
from blox_proxy.geo import rd_to_wgs84
from blox_proxy.http import UpstreamError
from blox_proxy.service import LiveService
from blox_proxy.sources.ns import parse_trains


def test_parse_trains_filters_and_converts() -> None:
    lat, lon = rd_to_wgs84(177403, 317800)
    doc = {"payload": {"treinen": [
        {"treinNummer": 3561, "ritId": "3561", "lat": lat, "lng": lon, "snelheid": 36.0, "richting": 10.0, "type": "SPR"},
        {"treinNummer": 1, "ritId": "1", "lat": 52.37, "lng": 4.89, "snelheid": 80.0, "richting": 0.0, "type": "IC"},
    ]}}
    out = parse_trains(doc, LIVE_BBOX_RD, 100)
    assert len(out) == 1
    t = out[0]
    assert t["id"] == "NS:3561" and t["mode"] == "rail" and t["speedMps"] == pytest.approx(10.0)
    assert t["world"] == pytest.approx([1703.0, 1300.0], abs=0.5)
    assert t["shapeId"] is None and t["distAlongShapeM"] is None


def test_parse_trains_bad_payload() -> None:
    with pytest.raises(UpstreamError):
        parse_trains({"foo": 1}, LIVE_BBOX_RD, 0)


def test_ns_disabled_without_key(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("NS_API_KEY", raising=False)
    svc = LiveService(Settings(cache_dir=tmp_path))
    assert svc.ns is None and "ns" not in svc.health()["sources"]
    svc2 = LiveService(Settings(cache_dir=tmp_path, ns_api_key="k"))
    assert svc2.ns is not None and "ns" in svc2.health()["sources"]
