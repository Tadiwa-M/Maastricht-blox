# 08: Live proxy

Folder: `proxy/` (package `blox_proxy`, FastAPI + httpx, managed with `uv`). Spec: CONTRACT 8.
Operating details (env vars, RWS station lookup, behaviour notes) are in `proxy/README.md`.

**Why a proxy?** Unity shouldn't do map projection, parse a 240 MB GTFS zip, or hammer
upstream APIs. The proxy polls each upstream politely on its own schedule, converts every
position to Unity world metres (and WGS84), and serves small cached JSON on
`http://127.0.0.1:8787`.

## How to run

```bash
cd proxy
uv sync
uv run pytest                     # 70 tests (2026-10-19), all upstreams mocked, no network
uv run blox-proxy                 # serve; first start filters the national GTFS (minutes)
uv run blox-proxy-build-gtfs      # do the GTFS filtering on its own beforehand
uv run blox-proxy-rws-locations   # find the RWS station code for Maastricht
```

Nothing has been tested against the live upstreams yet: the build container blocks them.

## Endpoints

| Endpoint | Upstream | Poll |
|---|---|---|
| `/v1/health` | per-source status | n/a |
| `/v1/vehicles` | OVapi GTFS-RT `vehiclePositions.pb` + `tripUpdates.pb` (+ NS with `NS_API_KEY`) | 20 s (never below 15 s), conditional GET |
| `/v1/shapes`, `/v1/stops` | OVapi GTFS static, filtered to the slice + 500 m | checked daily |
| `/v1/weather` | Buienradar JSON | 10 min |
| `/v1/water` | Rijkswaterstaat DDAPI20 (WATHTE) | 10 min |

## Module map

```
main.py          entry points: blox-proxy, blox-proxy-build-gtfs
config.py        Settings: contract constants, endpoints, intervals (env overrides)
api.py           FastAPI app: routes, CORS, Cache-Control: no-store
service.py       LiveService: wires clients, pollers and the latest data; builds payloads
scheduler.py     asyncio pollers: per-source health, exponential backoff (30 s .. 15 min)
http.py          shared httpx client, UpstreamError
geo.py           WGS84 <-> RD (pyproj) -> world metres = RD - slice origin
sun.py           sunrise/sunset fallback (NOAA approximation)

gtfs/            static GTFS
  download.py      conditional download of gtfs-nl.zip
  preprocess.py    stream the zip, keep stops/trips/routes/shapes touching the slice
  csvzip.py        CSV-in-zip streaming
  model.py         GtfsIndex (trips, routes, shapes)
  cache.py         gtfs_slice.json.gz cache
  static.py        GtfsStatic: load or build in the background

sources/
  gtfs_rt.py       decode VehiclePositions / TripUpdates protobufs -> VehicleObs
  buienradar.py    nearest station -> contract weather (cloudPct estimated from condition)
  ns.py            optional NS trains (unverified format)
water/
  rws_ddapi20.py   RWS water level (cm NAP -> m), trend over the last hour
  locations.py     station search helper
  base.py          shared water-source types

vehicles.py      VehicleObs -> /v1/vehicles records (world coords, id, route, match)
matching.py      ShapeMatcher: position -> shapeId + distAlongShapeM
polyline.py      projection and cumulative distances in a metric CRS
shapes_api.py    /v1/shapes (clipped, keeping full-shape cumDistM) and /v1/stops
```

## The interesting parts

- **Shape matching** (`matching.py`). Projecting a point onto a looping or out-and-back route
  is ambiguous: the same street can be at 1.2 km and at 7.9 km along the shape. The matcher
  searches near the vehicle's previous projection first and prefers segments pointing the
  travel direction (GPS bearing or last displacement). Only then does it fall back to a global
  search. No shape within 60 m gives `shapeId: null`. A repeated report returns the cached
  match, so the speed estimate isn't lost on 304 polls.
- **Clock** (`service.py`). The `/v1/vehicles` `ts` is the proxy clock at response time,
  so Unity's `LiveClock` can follow it.
- **Stale data.** Each source keeps serving its last good result; a failure only shows in
  `/v1/health`. Vehicles not seen for 5 min are dropped. `/v1/weather` and `/v1/water` return
  503 until their first success.
- **Clipped shapes** keep `cumDistM` from the full GTFS shape, so `distAlongShapeM` stays
  valid. A jump in `cumDistM` marks where a shape leaves the area.

What Unity does with `/v1/vehicles` is in [guide 05](05-movers-and-models.md#live-bus-gtfs-rt--screen).

## Where to change things

| Want to change | Where |
|---|---|
| an upstream URL | `config.py` or the `BLOX_*_URL` env vars |
| poll intervals | `config.py` (`gtfs_rt_interval_s`, `weather_interval_s`, `water_interval_s`), env `BLOX_GTFS_RT_INTERVAL`, ... |
| the live margin around the slice | `config.py` `LIVE_MARGIN_M` |
| the RWS station | env `BLOX_RWS_LOCATION` (the default is **unverified** and probably below the Borgharen weir) |

## Tests

`tests/builders.py` makes real-format fixtures (a small GTFS zip, GTFS-RT protobufs, Buienradar-
and RWS-shaped JSON). Every upstream is mocked at the HTTP layer. `tests/test_api.py` also writes
real responses to `tests/fixtures/api_samples/`, which the C# `LiveTests` parse. That checks
proxy → Unity end to end.
