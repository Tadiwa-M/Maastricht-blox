# Maastricht Blox: Interface Contract (v1)

This file is the single source of truth shared by every component. Parallel work streams
(pipeline, proxy, Unity data/meshing, Unity rendering) code against **this** file, not
against each other. Changing it is a breaking change: bump the version and update all sides.

Machine-readable parts live next to it:
- `contract/palette.json`: colour palette (indices are stable)
- `contract/brick_catalogue.json`: brick types (ids are stable, append-only)

---

## 1. World, units, coordinates

| Item | Value |
|---|---|
| Source CRS | EPSG:28992 (RD New), heights in metres NAP |
| Slice origin (SW corner, RD) | `x0 = 175700`, `y0 = 316500` |
| Slice size | 4096 × 4096 studs = **2048 m × 2048 m** |
| Stud pitch (horizontal cell) | **0.5 m** |
| Plate height (vertical cell) | **0.2 m**; brick = 3 plates = 0.6 m (true 8 : 3.2 : 9.6 proportions) |
| Vertical base | grid level `k = 0` is at **30.0 m NAP** (below Maas bed; centre terrain ≈ 45–55 m NAP) |
| Chunk size | **64 × 64 studs** horizontally (32 m × 32 m), full height (column chunk) |
| Chunk grid | 64 × 64 chunks, `cx, cy ∈ [0, 63]` |

Grid axes (integers): `i` = east, `j` = north, `k` = up.
Global cell `(I, J, K)`: `I = cx*64 + i`, `J = cy*64 + j`.

RD → grid: `I = floor((x - x0) / 0.5)`, `J = floor((y - y0) / 0.5)`, `K = floor((z_nap - 30.0) / 0.2)`.

**Unity world space** (metres, left-handed, Y up), origin = slice SW corner at 30.0 m NAP:
`unity.x = I * 0.5` (east), `unity.z = J * 0.5` (north), `unity.y = K * 0.2` (up).
A cell's min corner is at those coordinates; it spans `+0.5, +0.2, +0.5`.

Reference points (RD, approx.): Vrijthof (176185, 317717) · Markt (176430, 318007) ·
Sint-Janstoren (176115, 317672) · Sint-Servaasbrug (176748, 317786) ·
Station (177403, 317800) · Bonnefanten (177040, 317098).

## 2. Brick catalogue (`contract/brick_catalogue.json`)

Each type: `id` (uint8, 0 reserved = none), `name`, `kind`
(`brick | plate | tile | slope | slope_double | round`), footprint `w` × `d` in studs
(at rotation 0, `w` along +i, `d` along +j), height `h` in plates, `studs` = which
footprint cells carry a top stud, and for slopes the `studRows` count.

**Rotation** `rot ∈ {0,1,2,3}`: footprint rotated `rot × 90°` *clockwise seen from above*.
Rotated extent: rot 0/2 → `w × d` along `(i, j)`; rot 1/3 → `d × w` along `(i, j)`.
A brick's record position `(i, j, k)` is the **minimum corner of its rotated bounding box**.

**Slope orientation:** at rot 0 the low edge of the slope faces **+j** (north) and the
high, studded back row(s) lie at the −j side. Low edge faces: rot 0 → +j, rot 1 → +i,
rot 2 → −j, rot 3 → −i. `slope_double` (ridge) at rot 0 slopes down toward both +j and −j.

**Studs** are only *rendered* where a stud cell's top is not covered by another brick
(the renderer decides exposure; the data stores bricks, not studs). Tiles have no studs.

## 3. Palette (`contract/palette.json`)

Up to 64 entries, `idx` uint8 (0 = air/none). Each: `name`, `srgb` hex, `material` ∈
`solid | trans | glass | emissive | metal`.
`glass` = window glass: dark/reflective by day, warm emissive at night (shader decides).
Hand-curated; data is **quantised to the palette**, never stored as raw colours.
Entries are **append-only**: existing indices never change meaning, so appending colours
bumps the palette file's `version` but not `contractVersion` (palette v2 added idx 41–46
for facade detail).

## 4. Chunk file: `chunks/c_{cx:02d}_{cy:02d}.bxc`

Little-endian. Only chunks with ≥ 1 brick are written.

```
Header (32 bytes)
  char[4]  magic        = "BXC1"
  uint16   version      = 1
  uint16   flags        bit0 = body is raw-DEFLATE compressed (RFC 1951, no zlib header)
  int32    cx
  int32    cy
  uint32   brickCount
  uint16   minK         lowest k of any brick
  uint16   maxK         highest k + h of any brick (exclusive top)
  uint32   bodyBytes    byte length of the (possibly compressed) body
  uint32   reserved     = 0
Body: brickCount × BrickRecord (12 bytes each, before compression)
  uint8    i            0..63 (local)
  uint8    j            0..63 (local)
  uint16   k            0..65535 (global vertical level)
  uint8    typeId       brick_catalogue id
  uint8    colorIdx     palette idx
  uint8    rotFlags     bits0-1 = rot; bit2 = no_variation (exact colour, e.g. signage); bits3-7 = 0
  uint8    reserved     = 0
  uint32   featureId    0 = none; else id in features.json
```

Rules:
- A brick belongs to the chunk containing its record position. Bricks **must not cross
  chunk borders** (the pipeline splits them).
- No two bricks overlap in any cell.
- **Hollow:** the pipeline emits only bricks with at least one face exposed to air or to a
  `trans`/`glass` brick. Building interiors and deep ground are not stored.
- Records are sorted by `(k, j, i)`.
- Per-brick colour/rotation *variation* is not stored. Renderers derive it from a hash of
  the global position `(I, J, K)` unless `no_variation` is set.

## 5. Manifest: `manifest.json`

```json
{
  "contractVersion": 1,
  "crs": "EPSG:28992",
  "originRD": [175700, 316500],
  "baseNapM": 30.0,
  "studM": 0.5,
  "plateM": 0.2,
  "chunkStuds": 64,
  "chunksX": 64, "chunksY": 64,
  "palette": "palette.json",
  "catalogue": "brick_catalogue.json",
  "features": "features.json",
  "generated": "2026-10-17T12:00:00Z",
  "sources": [{"name": "3D BAG", "version": "...", "licence": "CC BY 4.0"}],
  "chunks": [{"cx": 12, "cy": 40, "file": "chunks/c_12_40.bxc", "bricks": 18234,
              "minK": 60, "maxK": 410, "sha1": "..."}]
}
```

The output directory (`build/world/`) contains `manifest.json`, `palette.json`,
`brick_catalogue.json` (copies), `features.json`, `chunks/`, `preview.png`.

## 6. Features: `features.json`

Clickable/searchable things. `id` (uint32 ≥ 1) is referenced by brick `featureId`.

```json
{ "features": [
  { "id": 17, "kind": "building", "name": "Sint-Servaasbasiliek",
    "bagId": "NL.IMBAG.Pand.0935100000xxxxxx", "osmId": "way/12345",
    "address": "Keizer Karelplein 3", "year": 1000, "heightM": 63.2,
    "centroid": [I, J], "bboxIJ": [I0, J0, I1, J1], "tags": {"wikidata": "Q..."} }
]}
```
`kind` ∈ `building | landmark | poi | street | water | park | station | stop`.
Bus stops are `stop` features (name + GTFS `stop_id` in `tags`). Search uses `name`, `address`.

## 7. Pipeline-internal voxel grid (Python only)

Between the *sources/voxelise* stage and the *brick layout* stage, a tile of the world is a
set of dense numpy arrays over cells `[i, j, k]` (any tile size, usually one chunk + 1-cell
border):
- `color: uint8`: palette idx, 0 = air
- `feature: uint32`: feature id, 0 = none
- `shape: uint8`: `0` = full cell; `1..4` = slope surface whose low edge faces
  `+j, +i, −j, −i` respectively; `5` = ridge along i; `6` = ridge along j; `7` = tile-only
  (flat, no studs, e.g. road surface); `8` = water surface
Plus `k0: int` (global k of array index 0) and `(I0, J0)` (global cell of index [0,0]).
Brick layout consumes this and emits BrickRecords. It must reproduce the grid exactly
(no gaps, no overfill) apart from slope cells mapped to slope bricks.

## 8. Live proxy API (`proxy/`, default `http://127.0.0.1:8787`)

All positions are converted by the proxy into **Unity world metres** `[x, z]` (section 1)
*and* given in WGS84, so Unity never does map projection. Times are Unix seconds (UTC).
JSON, `Cache-Control: no-store`. CORS open (for a future web viewer).

`GET /v1/health` → `{ "ok": true, "sources": { "ovapi": {"ok": true, "lastFetch": 0, "error": null}, ... } }`

`GET /v1/vehicles` → vehicles inside slice bbox + 500 m margin:
```json
{ "ts": 1760700000, "vehicles": [
  { "id": "ARR:1234", "mode": "bus", "operator": "ARR", "routeShort": "4",
    "routeId": "...", "tripId": "...", "headsign": "Station", "shapeId": "...",
    "lat": 50.85, "lon": 5.69, "world": [1234.5, 876.0], "bearingDeg": 90.0,
    "speedMps": 6.1, "distAlongShapeM": 1532.0, "delaySec": 45,
    "observedTs": 1760699990 } ] }
```
`shapeId`/`distAlongShapeM` may be null when the vehicle cannot be matched to a shape.

`GET /v1/shapes` → every shape used by routes touching the slice:
`{ "shapes": [ { "shapeId": "...", "routeShort": "4", "mode": "bus", "color": "#...",
  "points": [[x, z, cumDistM], ...] } ] }` (world metres, densified ≤ 10 m spacing).

`GET /v1/stops` → `{ "stops": [ {"stopId": "...", "name": "...", "world": [x, z]} ] }`

`GET /v1/weather` →
`{ "ts": ..., "tempC": 12.3, "precipMmH": 0.4, "cloudPct": 80, "windMps": 4.2,
   "windDirDeg": 230, "condition": "rain", "sunrise": ..., "sunset": ..., "source": "buienradar" }`
`condition` ∈ `clear | partly_cloudy | cloudy | rain | heavy_rain | snow | fog | thunder`.

`GET /v1/water` → `{ "ts": ..., "station": "Maastricht Sint Pieter", "levelMNap": 44.1,
  "trend": "rising|falling|steady", "source": "rws" }`

**Client motion rule (Unity):** render vehicles at `now − 60 s` and interpolate
`distAlongShapeM` between the two bracketing observations along the shape polyline
(fallback: lerp `world`). Never extrapolate more than 30 s; never teleport. Snap backward
jumps.

Polling: Unity polls `/v1/vehicles` every 5 s, weather/water every 5 min. The proxy
polls upstream on its own schedule, respecting upstream rate limits, and serves cached data.

## 9. Licence / attribution (must appear in-game credits and README)

OpenStreetMap contributors (ODbL), 3D BAG by TU Delft 3D geoinformation (CC BY 4.0),
AHN / PDOK (CC0), OVapi (GTFS/GTFS-RT), Buienradar (attribution + link required),
Rijkswaterstaat. *"Not affiliated with, endorsed or sponsored by the LEGO Group."*
