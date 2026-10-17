"""Pluggable water-level client interface + shared trend logic.

Rijkswaterstaat has migrated APIs more than once (most recently to DDAPI20 in 2026), so the
proxy depends only on ``WaterClient``; swapping the upstream means adding one module.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class LevelSample:
    ts: int  # Unix seconds
    level_m_nap: float


@dataclass(frozen=True)
class WaterReading:
    station: str
    samples: list[LevelSample]  # ascending by ts, at least one
    source: str

    @property
    def latest(self) -> LevelSample:
        return self.samples[-1]


class WaterClient(Protocol):
    async def fetch(self) -> WaterReading: ...


STEADY_CM_PER_H = 2.0


def trend(samples: list[LevelSample], window_s: int = 3600) -> str:
    """'rising' | 'falling' | 'steady' from the change over the last ``window_s`` seconds."""
    if len(samples) < 2:
        return "steady"
    last = samples[-1]
    ref = next((s for s in samples if s.ts >= last.ts - window_s), samples[0])
    if ref is last:
        ref = samples[-2]
    hours = max((last.ts - ref.ts) / 3600.0, 1e-6)
    rate_cm_h = (last.level_m_nap - ref.level_m_nap) * 100.0 / hours
    if rate_cm_h > STEADY_CM_PER_H:
        return "rising"
    if rate_cm_h < -STEADY_CM_PER_H:
        return "falling"
    return "steady"


def to_contract(reading: WaterReading) -> dict[str, Any]:
    latest = reading.latest
    return {
        "ts": latest.ts,
        "station": reading.station,
        "levelMNap": round(latest.level_m_nap, 3),
        "trend": trend(reading.samples),
        "source": reading.source,
    }
