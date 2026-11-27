"""Named places in RD metres (keep in sync with viewer/src/places.js), resolved to chunks with the
active slice's origin (CONTRACT 1, v4), so they work for any slice."""

from __future__ import annotations

import math

from .. import geo

PLACES_RD: dict[str, tuple[float, float]] = {
    "markt": (176430, 318007),
    "vrijthof": (176185, 317717),
    "brug": (176748, 317786),
    "station": (177403, 317800),
    "bonnefanten": (177040, 317098),
    "bosscherweg": (176197, 319239),
    "fort": (176050, 316326),
    "enci": (176549, 314837),
}


def resolve_place(name: str, origin: tuple[float, float] | None = None) -> tuple[int, int]:
    """A place name or ``"cx,cy"`` -> chunk coordinates for ``origin`` (default: active slice)."""
    ox, oy = origin if origin is not None else (geo.X0, geo.Y0)
    chunk_m = geo.CHUNK_STUDS * geo.STUD_M
    if name.lower() in PLACES_RD:
        x, y = PLACES_RD[name.lower()]
        return math.floor((x - ox) / chunk_m), math.floor((y - oy) / chunk_m)
    try:
        cx, cy = (int(v) for v in name.split(","))
    except ValueError:
        raise SystemExit(f"unknown place {name!r}; use one of {', '.join(PLACES_RD)} or cx,cy") from None
    return cx, cy
