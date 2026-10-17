"""In-memory model of the slice-filtered GTFS static feed."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..polyline import Polyline


@dataclass(frozen=True)
class Route:
    route_id: str
    agency_id: str
    short_name: str
    long_name: str
    route_type: int
    mode: str
    color: str  # "#RRGGBB"


@dataclass(frozen=True)
class Trip:
    trip_id: str
    route_id: str
    shape_id: str | None
    headsign: str


@dataclass(frozen=True)
class Stop:
    stop_id: str
    name: str
    lat: float
    lon: float
    x: float  # RD
    y: float  # RD


@dataclass
class Shape:
    shape_id: str
    line: Polyline  # RD metres, densified, with cumulative distance


@dataclass
class GtfsIndex:
    routes: dict[str, Route] = field(default_factory=dict)
    trips: dict[str, Trip] = field(default_factory=dict)
    stops: dict[str, Stop] = field(default_factory=dict)
    shapes: dict[str, Shape] = field(default_factory=dict)
    meta: dict[str, object] = field(default_factory=dict)

    def route_for_trip(self, trip_id: str) -> Route | None:
        trip = self.trips.get(trip_id)
        return self.routes.get(trip.route_id) if trip else None

    def shape_routes(self) -> dict[str, Route]:
        """shape_id -> one representative route using that shape."""
        out: dict[str, Route] = {}
        for trip in self.trips.values():
            if trip.shape_id and trip.shape_id not in out and trip.route_id in self.routes:
                out[trip.shape_id] = self.routes[trip.route_id]
        return out


# GTFS route_type (basic + extended "Hierarchical Vehicle Type") -> contract mode string.
_BASIC_MODES = {0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry", 5: "tram", 6: "gondola", 7: "funicular", 11: "bus", 12: "rail"}
_DEFAULT_COLOURS = {"bus": "#1F6FB2", "tram": "#C8102E", "rail": "#FFC917", "metro": "#E4002B", "ferry": "#00A3E0"}


def mode_for_route_type(route_type: int) -> str:
    if route_type in _BASIC_MODES:
        return _BASIC_MODES[route_type]
    family = route_type // 100
    if family in (1, 3):
        return "rail"
    if family in (2, 7, 8):  # coach, bus, trolleybus
        return "bus"
    if family == 4:
        return "metro"
    if family == 9:
        return "tram"
    if family in (10, 12):
        return "ferry"
    return "other"


def route_colour(raw: str, mode: str) -> str:
    raw = (raw or "").strip().lstrip("#")
    if len(raw) == 6 and all(c in "0123456789abcdefABCDEF" for c in raw):
        return "#" + raw.upper()
    return _DEFAULT_COLOURS.get(mode, "#808080")
