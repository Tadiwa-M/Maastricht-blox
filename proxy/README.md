# blox-proxy: Maastricht Blox live-data proxy

A small local server that polls the live upstreams, converts every position into Unity world
metres, and serves the JSON API defined in `CONTRACT.md` section 8 on `http://127.0.0.1:8787`.

| Endpoint | Upstream | Upstream poll |
|---|---|---|
| `GET /v1/health` | per-source status | n/a |
| `GET /v1/vehicles` | OVapi GTFS-RT `vehiclePositions.pb` + `tripUpdates.pb` (+ NS, optional) | 20 s (never below 15 s), conditional GET |
| `GET /v1/shapes`, `GET /v1/stops` | OVapi GTFS static `gtfs-nl.zip`, filtered to the slice | once per day at most |
| `GET /v1/weather` | Buienradar JSON feed, nearest station to Maastricht | 10 min |
| `GET /v1/water` | Rijkswaterstaat DDAPI20 `OphalenWaarnemingen` (WATHTE) | 10 min |

All responses carry `Cache-Control: no-store` and open CORS.

## Run on Windows

1. Install [uv](https://docs.astral.sh/uv/) (PowerShell):
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
2. Start the proxy (from the repository root):
   ```powershell
   cd proxy
   uv run blox-proxy
   ```
   `uv` installs Python and the dependencies on first run. Then open
   <http://127.0.0.1:8787/v1/health>.

**First start:** the proxy downloads the national GTFS feed (about 240 MB) and filters it
once to the routes, trips, shapes and stops that touch the slice plus a 500 m margin. That
takes a few minutes. `/v1/shapes` and `/v1/stops` are empty and vehicles are unmatched
(`shapeId: null`) until it finishes; `/v1/health` shows `ovapi_static` progress or errors.
The result goes to `proxy/.cache/gtfs_slice.json.gz`, and later starts load it in under a
second. To do this step on its own beforehand:
```powershell
uv run blox-proxy-build-gtfs                       # download (if changed) + filter
uv run blox-proxy-build-gtfs --zip C:\path\gtfs-nl.zip   # filter a zip you already have
```

Options: `uv run blox-proxy --host 0.0.0.0 --port 8787 -v`.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `BLOX_PROXY_CACHE` | `proxy/.cache` | where the GTFS zip and slice cache live |
| `BLOX_GTFS_RT_INTERVAL` | `20` | GTFS-RT poll seconds (clamped to >= 15) |
| `BLOX_RWS_LOCATION` | `maastricht.borgharen.maas.beneden` | RWS location code (**unverified**, see below) |
| `BLOX_RWS_STATION_NAME` | `Maastricht Sint Pieter` | display name in `/v1/water` |
| `NS_API_KEY` | unset | enables NS train positions (optional) |
| `BLOX_GTFS_URL`, `BLOX_GTFS_RT_VEHICLES_URL`, `BLOX_GTFS_RT_TRIPS_URL`, `BLOX_BUIENRADAR_URL`, `BLOX_RWS_BASE_URL`, `BLOX_NS_VEHICLES_URL` | see `config.py` | upstream overrides |

PowerShell example: `$env:BLOX_RWS_LOCATION = "..."; uv run blox-proxy`.

### Finding the Rijkswaterstaat location code

RWS moved to new "DDAPI20" services and new location codes in 2026. The code for Maastricht
Sint Pieter (or Borgharen) could not be checked from the build machine. On a PC with
internet access, run:
```powershell
uv run blox-proxy-rws-locations              # searches "pieter|borgharen|maastricht"
```
Then set `BLOX_RWS_LOCATION` to the code you want. If the code is wrong, `/v1/water` returns
503 and `/v1/health` shows the RWS error (e.g. HTTP 204 = no data for that location).

## Behaviour notes

- **Coordinates.** `world = [x_RD - 175700, y_RD - 316500]` metres (CONTRACT section 1).
  WGS84 to RD uses pyproj (EPSG:4326 to EPSG:28992).
- **Stale data.** Each source keeps serving its last good result with its own `ts`. A failed
  poll only shows up in `/v1/health` (`ok: false`, `error`), and the source then backs off
  exponentially (30 s up to 15 min). A source also counts as not ok when its last success is
  older than 3 poll intervals. Vehicles whose last report is more than 5 min old are dropped.
  Before the first successful fetch, `/v1/weather` and `/v1/water` return HTTP 503
  `{"error": ...}`. `/v1/vehicles` returns `{"ts": 0, "vehicles": []}`.
- **Shape matching.** Each vehicle is projected onto its trip's shape. The proxy searches near
  the previous projection first and prefers segments that point in the travel direction, so a
  vehicle on a looping or out-and-back route does not jump between the two passes. If no
  shape lies within 60 m, `shapeId` and `distAlongShapeM` are `null`.
- **Shapes payload.** Shapes are densified to 10 m or less, then clipped to the slice plus
  500 m, with one point kept outside each boundary crossing. `cumDistM` is still measured from
  the start of the full GTFS shape, so it matches `distAlongShapeM`. A jump in `cumDistM`
  marks where a shape leaves the area and comes back.
- **Weather.** Buienradar has no cloud-cover field, so `cloudPct` is estimated from the
  weather condition. If the feed has no sunrise or sunset, the proxy calculates them.
- **Water trend.** The proxy fetches the last 3 h of readings. The level counts as
  rising or falling when it changed by more than 2 cm/h over the last hour.
- **NS trains** are only polled when `NS_API_KEY` is set. Otherwise the source does not exist
  and does not appear in `/v1/health`. The response format follows third-party usage and is
  unverified.

## Tests

```powershell
uv sync
uv run pytest
```
The tests use fixtures built from the real formats: a small GTFS zip, GTFS-RT protobufs made
with `gtfs-realtime-bindings`, a Buienradar-shaped JSON and an RWS DDAPI20-shaped JSON. Every
upstream is mocked at the HTTP layer. No test touches the network.

## Data credits / terms

OVapi (GTFS / GTFS-RT; best-effort service, do not claim to represent transit agencies) ·
Weather data: [Buienradar.nl](https://www.buienradar.nl) (non-commercial use, attribution
with link required) · Water levels: Rijkswaterstaat · Optional: NS API (NS terms).
