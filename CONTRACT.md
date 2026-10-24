# Maastricht Blox: Interface Contract (v4)

This file is the single source of truth shared by every component. Parallel work streams
(pipeline, proxy, Unity data/meshing, Unity rendering) code against **this** file, not
against each other. Changing it is a breaking change: bump the version and update all sides.

Machine-readable parts live next to it:
- `contract/palette.json`: colour palette (indices are stable)
- `contract/brick_catalogue.json`: brick types (ids are stable, append-only)

---

## 1. World, units, coordinates

**v4: the slice comes from the manifest.** `originRD`, `chunksX` and `chunksY` in `manifest.json`
are authoritative, and renderers must read them rather than assume the defaults below. The
pipeline has named slices (`blox --slice centre|city`): **centre** is the table below (the
default, used by tests and fixtures); **city** is origin RD (174700, 314000), 128 × 176 chunks
(4.1 × 5.6 km: from Sint-Pietersberg/ENCI in the south to Bosscherweg in the north). Unity
metres are always relative to the manifest's origin. Chunk file names grow to 3 digits when
needed (`c_100_37.bxc`).

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

Reference points (RD, approx.; Unity metres in brackets): Vrijthof (176185, 317717) → [485, 1217] · Markt (176430, 318007) ·
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

**Facing (v2): the one rule to remember.** Every directional piece has a *front*. At rot 0
the front faces **+j (north)**. Code that places pieces should say which way the front
faces, not pick a `rot`:

| facing | front faces | rot |
|---|---|---|
| `N` | +j | 0 |
| `E` | +i | 1 |
| `S` | −j | 2 |
| `W` | −i | 3 |

Unrotated footprint cell `(a, b)` (`a` along `w`, `b` along `d`) lands at offset `(di, dj)`
from the record position:
rot 0 → `(a, b)` · rot 1 → `(b, w−1−a)` · rot 2 → `(w−1−a, d−1−b)` · rot 3 → `(d−1−b, a)`.
Every language implements exactly these helpers (`facing_to_rot`, `rotated_extent`,
`footprint_cell`) and passes the shared vectors in `contract/test_vectors/rotation.json`.

**Slope orientation:** a slope's front is its low edge, so at rot 0 the low edge faces
**+j** (north) and the high, studded back row(s) lie at the −j side. Low edge faces: rot 0 → +j, rot 1 → +i,
rot 2 → −j, rot 3 → −i. `slope_double` (ridge) at rot 0 slopes down toward both +j and −j.

**Slope lip (v2):** the vertical face at a slope's low edge is **0.25 plate (0.05 m)** tall,
like a real slope brick, not a full plate.

**Studs** are only *rendered* where a stud cell's top is not covered by another brick
(the renderer decides exposure; the data stores bricks, not studs). Tiles have no studs.
`studs` values: `all`, `none`, `backRows` (slopes), `center` (one stud centred on the
footprint: jumper plates).

### 2.1 Detail pieces (v2, ids 38+)

Placed explicitly by the facade grammar (never inferred from voxels). Directional ones
follow the facing rule: their decorated **front faces +j at rot 0**. The whole bounding box
counts as occupied for stud-exposure tests. Geometry every renderer must reproduce:

| id | name | kind | w×d×h | geometry |
|---|---|---|---|---|
| 38 | `arch_1x4` | `arch` | 4×1×3 | brick with an arched opening through it: middle 2 studs, opening 2 plates tall at the sides rising to a semicircular top |
| 39 | `arch_1x6` | `arch` | 6×1×6 | as above: middle 4 studs, opening 5 plates tall with round top |
| 40 | `window_1x2x2` | `window` | 2×1×6 | frame (0.06 m bars, record colour) with a vertical mullion and a transom at 2/3 height; panes are `glass` material, set 0.1 m back from the front |
| 41 | `window_1x2x3` | `window` | 2×1×9 | same, taller |
| 42 | `door_1x2x4` | `door` | 2×1×12 | frame plus door leaf set 0.06 m back with 4 raised panels, and a small `glass` fanlight in the top 2 plates |
| 43 | `fence_1x4` | `fence` | 4×1×3 | 0.5-plate top rail with studs, round spindles every 0.25 m, 0.5-plate bottom rail |
| 44 | `round_tile_1x1` | `round_tile` | 1×1×1 | flat round disc, no stud |
| 45 | `jumper_1x2` | `jumper` | 2×1×1 | plate with a single stud centred on the footprint (`studs: center`) |
| 46 | `slope30_1x2` | `slope` | 1×2×2 | shallow slope, no studs (`studRows: 0`); front lip 0.05 m |
| 47 | `grille_1x2` | `tile_grille` | 2×1×1 | tile with 3 grooves along `w` on top |

`window`/`door` panes always render with the `glass` material (night glow included); the
record colour is the frame.

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
  uint8    rotFlags     bits0-1 = rot; bit2 = no_variation (exact colour, e.g. signage);
                        bit3 = hide_studs (v2: every stud cell is covered by a hollow-culled
                        interior cell, so renderers skip its studs); bits4-7 = 0
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
  "contractVersion": 4,
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
              "minK": 60, "maxK": 410, "sha1": "..."}],
  "islands": [{"id": 7, "file": "islands/i_000007.bxi", "cx": 12, "cy": 40, "bricks": 3120,
               "sha1": "..."}]
}
```

The output directory (`build/world/`) contains `manifest.json`, `palette.json`,
`brick_catalogue.json` (copies), `features.json`, `chunks/`, `islands/` (v3), `preview.png`.

## 5.1 Islands (v3): buildings on their own rotated grid

Most Maastricht streets are not aligned with the world grid. A wall at 20° rasterises into a
staircase, which can't carry facade detail. So a building (or a terrace of touching buildings
with the same orientation) whose main wall is more than **3°** off-axis is built on its **own
grid, rotated to that wall**, and stored as an **island** rather than in the chunks.

**Pose.** An island has `origin = [x, z]` (Unity metres: the world position of its local cell
(0, 0) min corner, at k = 0) and `yawDeg`, clockwise from north, the same convention as brick
model poses (7.1). Local axes in world (east, north) components:
local +j → `(sin yaw, cos yaw)`, local +i → `(cos yaw, −sin yaw)`. A local point `(u, v)` in
metres (u along +i, v along +j) lands at world
`x = origin.x + u·cos(yaw) + v·sin(yaw)`, `z = origin.z − u·sin(yaw) + v·cos(yaw)`;
height `y = K · 0.2` exactly as in chunks (islands use **global k**). |yawDeg| ≤ 45.
Shared vectors: `contract/test_vectors/islands.json`.

**File: `islands/i_{id:06d}.bxi`.** Little-endian.
```
Header (40 bytes)
  char[4]  magic       = "BXI1"
  uint16   version     = 1
  uint16   flags       bit0 = body is raw-DEFLATE compressed
  uint32   islandId
  int32    cx, cy      owning chunk (for streaming/LOD: the chunk holding the island's centre)
  float32  originX     Unity metres
  float32  originZ     Unity metres
  float32  yawDeg      clockwise from north, (−45, 45]
  uint32   brickCount
  uint32   bodyBytes
Body: brickCount × BrickRecord (section 4 layout: i, j are LOCAL 0..255, k global, facing rule
in the local frame, featureId global).
```
An island is at most 256 × 256 studs; larger terraces are split into several islands with
the same yaw and adjacent origins.

**Rules.** Island bricks never appear in chunks. Records are sorted by `(k, j, i)` like chunks.
The owning chunk `(cx, cy)` is the chunk under the centre of the island's brick extent
transformed to world space (clamped to the map), and the pipeline always writes that chunk.
Island ids are per build: don't store them across builds; use feature ids for anything durable.
Per-brick colour variation hashes the island-local `(i, j, k)` (as Unity does), so a rotated
building looks the same wherever it stands. Under an island's footprint the chunk
grid holds ground only (paving), so nothing shows through gaps. The island footprint is grown
by half a stud so rotated edges overlap their neighbours instead of leaving slits. Plinth bricks
go two plates below ground to hide the seam on slopes. Stud exposure and hidden-face culling
are computed **within the island** (the chunk grid doesn't cover island studs). Renderers
transform each island as one rigid object (local → world by the pose above).

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
**Placed pieces (v2):** alongside the arrays, a tile may carry a list of explicitly placed
records (detail pieces from section 2.1, or any catalogue piece). Their cells must be air in
the grid. They are passed through unchanged, and hollow culling treats their cells as air,
so the wall behind a window frame keeps its faces.
Brick layout consumes this and emits BrickRecords. It must reproduce the grid exactly
(no gaps, no overfill) apart from slope cells mapped to slope bricks.

## 7.1 Brick models (v2): things that move

Buses, boats and characters are **brick models**: small assemblies rendered as one movable
object, never baked into chunks. Files: `contract/models/<name>.json`.

```json
{ "name": "bus", "version": 1,
  "size": [5, 24, 16],
  "pivot": [2.5, 12.0, 0.0],
  "forward": "+j",
  "parts": { "leg_l": {"pivot": [1.0, 0.5, 4.0]} },
  "bricks": [ {"i": 0, "j": 0, "k": 0, "type": 3, "color": 38, "rot": 0, "part": "leg_l"} ] }
```
`size` is the bounding box in studs (i, j) and plates (k); `pivot` is the model origin in
local cells (floats; ground centre); models always face `+j` locally; `parts` are optional
animated groups. Brick fields follow section 4 (local cells, record = min corner of the rotated bbox); `part`
is optional. A **pose** is `{position: [x, y, z] Unity metres, yaw: degrees clockwise from
north}`: yaw 0 means the model's +j forward points north. Movers turn a path (a polyline in
Unity metres) plus a distance into a pose. Heading is the path tangent, smoothed over
`turnRadiusM`. Parts animate by rotating about their pivot's local i axis (walk cycles).

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
