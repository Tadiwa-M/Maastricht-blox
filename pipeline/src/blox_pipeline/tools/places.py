"""Named places in chunk coordinates (chunk = floor((RD - origin) / 32 m)); keep in sync with viewer/build.mjs."""

from __future__ import annotations

PLACES: dict[str, tuple[int, int]] = {
    "markt": (22, 47),
    "vrijthof": (15, 38),
    "brug": (32, 40),
    "station": (53, 40),
    "bonnefanten": (41, 18),
}


def resolve_place(name: str) -> tuple[int, int]:
    """A place name or ``"cx,cy"``."""
    if name.lower() in PLACES:
        return PLACES[name.lower()]
    try:
        cx, cy = (int(v) for v in name.split(","))
    except ValueError:
        raise SystemExit(f"unknown place {name!r}; use one of {', '.join(PLACES)} or cx,cy") from None
    return cx, cy
