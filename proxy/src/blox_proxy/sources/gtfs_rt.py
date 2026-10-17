"""OVapi GTFS-realtime: decode VehiclePositions and TripUpdates feeds.

OVapi adds its own proto extensions (gtfs-realtime-OVapi.proto); the standard bindings
skip those as unknown fields, and everything used here is standard GTFS-RT.
"""

from __future__ import annotations

from dataclasses import dataclass

from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2 as rt

from ..http import UpstreamError


@dataclass(frozen=True)
class VehicleObs:
    key: str  # stable vehicle key (vehicle.id, else label, else entity id)
    trip_id: str | None
    route_id: str | None
    lat: float
    lon: float
    bearing_deg: float | None
    speed_mps: float | None
    timestamp: int | None


def _decode(data: bytes) -> rt.FeedMessage:
    msg = rt.FeedMessage()
    try:
        msg.ParseFromString(data)
    except DecodeError as e:
        raise UpstreamError(f"bad GTFS-RT protobuf: {e}") from e
    return msg


def header_timestamp(msg: rt.FeedMessage) -> int | None:
    return int(msg.header.timestamp) if msg.header.HasField("timestamp") else None


def parse_vehicle_positions(data: bytes) -> tuple[int | None, list[VehicleObs]]:
    msg = _decode(data)
    out: list[VehicleObs] = []
    for ent in msg.entity:
        if not ent.HasField("vehicle") or ent.is_deleted:
            continue
        vp = ent.vehicle
        if not vp.HasField("position"):
            continue
        pos = vp.position
        if pos.latitude == 0.0 and pos.longitude == 0.0:
            continue
        desc = vp.vehicle if vp.HasField("vehicle") else None
        key = (desc.id if desc and desc.id else "") or (desc.label if desc and desc.label else "") or ent.id
        trip = vp.trip if vp.HasField("trip") else None
        out.append(
            VehicleObs(
                key=key,
                trip_id=(trip.trip_id or None) if trip else None,
                route_id=(trip.route_id or None) if trip else None,
                lat=float(pos.latitude),
                lon=float(pos.longitude),
                bearing_deg=float(pos.bearing) if pos.HasField("bearing") else None,
                speed_mps=float(pos.speed) if pos.HasField("speed") else None,
                timestamp=int(vp.timestamp) if vp.HasField("timestamp") else None,
            )
        )
    return header_timestamp(msg), out


def _stu_delay_and_time(stu: rt.TripUpdate.StopTimeUpdate) -> tuple[int | None, int | None]:
    for ev_name in ("arrival", "departure"):
        if stu.HasField(ev_name):
            ev = getattr(stu, ev_name)
            delay = int(ev.delay) if ev.HasField("delay") else None
            t = int(ev.time) if ev.HasField("time") else None
            if delay is not None or t is not None:
                return delay, t
    return None, None


def parse_trip_delays(data: bytes, now: int) -> dict[str, int]:
    """trip_id -> current delay in seconds.

    Uses ``TripUpdate.delay`` if present; otherwise the delay at the next stop, i.e. the
    first stop-time update whose event time is not more than 30 s in the past (falling back
    to the last update that carries a delay).
    """
    msg = _decode(data)
    out: dict[str, int] = {}
    for ent in msg.entity:
        if not ent.HasField("trip_update") or ent.is_deleted:
            continue
        tu = ent.trip_update
        trip_id = tu.trip.trip_id
        if not trip_id:
            continue
        if tu.HasField("delay"):
            out[trip_id] = int(tu.delay)
            continue
        chosen: int | None = None
        last: int | None = None
        for stu in tu.stop_time_update:
            delay, t = _stu_delay_and_time(stu)
            if delay is None:
                continue
            last = delay
            if t is not None and t >= now - 30:
                chosen = delay
                break
        if chosen is None:
            chosen = last
        if chosen is not None:
            out[trip_id] = chosen
    return out
