# Maastricht Blox pipeline

Turns open data into the brick world in `build/world/` (format: `../CONTRACT.md`).

```
blox fetch   ->  data/raw/        AHN 0.5 m DTM/DSM, 3D BAG, OSM (Limburg), optional aerial photo
blox build   ->  build/world/     voxelise (sources/ + voxelise/) -> brick layout (layout/) -> chunks (io/) -> preview.png
```

## Quick start (Windows, macOS or Linux)

Install [uv](https://docs.astral.sh/uv/), then from the `pipeline/` folder:

```
uv sync
uv run blox fetch                       # whole 2 x 2 km slice, cached under ../data/raw (several GB of OSM + AHN)
uv run blox fetch --only ortho          # optional: aerial photo for ground colours
uv run blox build --out ../build/world  # whole slice
uv run blox build --bbox 176000,317500,176500,318000 --out ../build/centre   # a part (RD metres)
uv run pytest
```

Downloads are idempotent: finished files are never fetched again, interrupted ones
(`*.part`) are resumed with HTTP range requests. Delete a file or folder under `data/raw`
to refresh it. `BLOX_DATA_DIR` or `--data-dir` moves the cache.

## Sources (`src/blox_pipeline/sources/`)

All endpoints are constants in `sources/config.py`.

| Source | How | Cached as | Loader returns |
|---|---|---|---|
| AHN DTM/DSM 0.5 m | PDOK WCS `dtm_05m` / `dsm_05m`, 512 m GeoTIFF blocks | `ahn/<coverage>/<x>_<y>_512.tif` | `HeightGrid` on the stud grid; DTM gaps (buildings, water) IDW-filled |
| 3D BAG | OGC API `api.3dbag.nl/collections/pand/items?bbox=...`, 256 m blocks, all pages | `3dbag/<block>/page_NNNN.json` | `Building` list: BAG attributes + surfaces of the best LoD (2.2 first) with roof/wall/ground semantics |
| OSM | Geofabrik `limburg-latest.osm.pbf`, clipped to slice + 300 m with pyosmium (back-references kept, so geometries are whole) | `osm/slice_clip.osm.pbf` | `OsmData`: roads (highway, width, bridge), road areas/squares, railways, water polygons, waterways, trees, landuse/parks, OSM buildings (names/addresses), named POIs, all in RD |
| Aerial photo (optional) | PDOK WMS `Actueel_orthoHR`, 256 m PNG blocks at 0.5 m | `ortho/<block>.png` | `RGBGrid`, quantised to ground palette colours |

The CityJSON reader also accepts downloaded 3D BAG tiles (`.city.json`) and CityJSONSeq (`.city.jsonl`).

**AHN fallback (local tiles).** `docs/DATA_SOURCES.md` reports that the PDOK AHN WCS may no
longer be served; the current AHN5/AHN6 distribution is GeoTIFF sheets from the AHN dataroom
(`https://basisdata.nl/hwh-ahn/...`, see that doc). If `blox fetch --only ahn` fails, download
the 0.5 m DTM (and optionally DSM) sheets covering RD 175700,316500 - 177748,318548 and put them in
`data/raw/ahn/tiles/dtm/` and `data/raw/ahn/tiles/dsm/` (any file name, `.tif`/`.TIF`). Sheets of any
size work (windowed reads); once they cover the bbox, `blox fetch` skips the WCS and `blox build`
uses them. AHN5/AHN6 are CC BY 4.0 ("AHN.nl"); AHN4 via PDOK is CC0.

**3D BAG fallback (local tiles).** If the OGC API route fails, download the CityJSON tiles over
the slice (tile index `https://data.3dbag.nl/latest/tile_index.fgb`, column `cj_download`) into
`data/raw/3dbag/tiles/` (`*.city.json` or `*.city.jsonl`). When that folder has tiles, `blox fetch`
skips the API and `blox build` reads them (alongside any cached API pages).

## Voxelisation (`src/blox_pipeline/voxelise/`)

1. `prepare_world` turns sources into slice-wide items with palette colours, feature ids
   (stable: buildings by BAG id first, then OSM objects by id) and globally fixed heights
   (water levels, bridge decks) so independently built tiles agree at their borders.
2. `build_layers` rasterises them per 8 x 8-chunk region into 2.5D column layers:
   terrain (DTM), water, bridge decks, buildings (top roof surface from the LoD2.2 roof
   planes).
3. `voxelise_tile` fills a dense `VoxelTile` (CONTRACT section 7) for one chunk + 1-cell rim.

Rules worth knowing:
- **Terrain**: top cell = DTM surface colour (grass by default, aerial-photo colour if
  available, landuse/parks, roads); a crust of `terrain_depth_plates` below the lowest
  neighbouring surface so cliffs stay closed. Hollowing is done by the layout stage.
- **Roofs**: cells of planes pitched 15-75 deg get slope shapes 1-4 (towards the plane's
  fall direction) as **vertical stacks of 3 cells** (one brick height); the height of each
  pitched face is quantised to 3-plate steps from its eave. Directly below every slope stack
  sits one full stack in roof colour: that is the studded back row the layout pairs with the
  next-lower slope stack (without it most roof cells would become plain bricks). Where two faces meet at the
  top, the stacks become ridges (5 = ridge along i, 6 = along j). Flatter roofs are flat
  full cells in a flat-roof colour.
- **Facades**: walls on axis-aligned footprint edges get the facade grammar (below):
  window/door/arch pieces, storey bands, sills, shutters, shop fronts, eave cornice.
  Every other exposed wall (rotated buildings' staircase edges, short or low walls,
  party walls above a lower neighbour) keeps the fallback: `glass` cells in a band
  0.8-2.2 m above each 3 m storey, one stud wide every 2 or 3 studs (per-building hash).
  Corners, roof stacks, churches and landmarks get neither. `blox build --no-facades`
  turns the grammar off.
- **Rotated buildings (islands, CONTRACT 5.1)**: a building or terrace turned more than 3°
  from the grid is built on its own turned grid (`src/blox_pipeline/islands/`) and written
  to `islands/i_NNNNNN.bxi` instead of the chunks; its footprint in the chunks is paved.
  Its walls are straight there, so they get the facade grammar. `blox build --no-islands`
  keeps the old staircase walls. `python -m blox_pipeline.tools.island_share <world>`
  estimates the share of turned buildings in an existing world.
- **Roads** are tile cells (shape 7) replacing the terrain top: asphalt by default,
  cobble_grey for streets/pedestrian areas in the historic centre (Binnenstad, Wyck),
  pavement for footways, red for cycleways; OSM `surface` overrides. Railways: rail_brown
  bed with metal rails. Bridges (`bridge=yes`): a 3-plate deck between the end-point
  ground heights, at least 1.5 m above the water below.
- **Water**: polygon surface cell (shape 8) at the Maas level (`--maas-level`, default
  44.1 m NAP) for the Maas, otherwise at an estimate from the banks; 0.6 m of water below
  it, then a soil bed.
- **Trees**: OSM trees/tree rows; height from DSM - DTM when the DSM is present, else a
  per-tree hash; trunk + lumpy leaf ellipsoid, deterministic.
- **Colours**: wall colour by construction year (pre-1700 mergel, then brick variants...)
  hashed per BAG id; pitched roofs roof_tile_red/slate/roof_tile_dark; landmark table in
  `voxelise/landmarks.py` (Sint-Janstoren tower_red, Sint-Servaas mergel, ...).
- **Features**: `build_features(registry)` returns the `features.json` dict: buildings
  (BAG id, year, height, OSM name/address), landmarks, streets (one per name), water,
  named parks, POIs, stations, bus stops. `bboxIJ` is inclusive, `centroid` lies inside.

## Rotation and facing (`src/blox_pipeline/rotation.py`)

One rule: **a piece's front faces +j (north) at rot 0**. Code never picks `rot` itself; it
says where the front should face and `facing_to_rot` turns that into `rot`:

| facing | front faces | rot |
|---|---|---|
| `N` | +j | 0 |
| `E` | +i | 1 |
| `S` | -j | 2 (our house fronts) |
| `W` | -i | 3 (west side walls) |

`rotated_extent(w, d, rot)` gives the turned footprint size, `footprint_cell(w, d, rot, a, b)`
says where unrotated cell `(a, b)` lands relative to the record position (the min corner of
the turned box), `front_dir(rot)` is the unit step the front points along. Catalogue,
layout (slopes, verification), previews and models all use these helpers; the tests run
them against the shared `contract/test_vectors/rotation.json` that C# and JS also pass.

## Placed pieces and hide_studs (`src/blox_pipeline/layout/`)

Detail pieces (windows, doors, arches, fences, round tiles, jumpers, grilles, 30 deg
slopes; CONTRACT 2.1) can't come out of a voxel grid, so they are *placed*:

```python
cv.place("window_1x2x3", i, j, k, "S", "white", feature_id)   # testscene.Canvas
rec = layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=cv.placed_records())
```

`(i, j, k)` is the min corner of the box the turned piece fills. Its cells must be air in
the voxel grid (checked by `Canvas.place`, and again by `layout_tile`, which also rejects
pieces outside the chunk or overlapping each other). Because those cells are air, hollow
culling keeps the wall behind a window frame. `verify_layout(..., placed=...)` checks the
pieces came through unchanged.

`layout/studs.py` sets rotFlags bit3 `hide_studs` on any brick whose every stud cell lies
under a solid input cell that was hollow-culled (not stored), so renderers skip studs no
camera can see.

## Facade grammar (`src/blox_pipeline/facade/`)

The unit is a **facade run** (`run.py: FacadeRun`, `paint_run`): one straight wall with one
outward normal, painted in a run frame (x along the wall, y inward, pieces face `S`) as
corner pilasters -> upper storeys (`windows.py`) -> ground floor (`ground.py`) -> eave
cornice. `frame.py: FramePainter` turns that frame to face N/E/S/W. Two callers:

- the look-test scene: `HouseSpec` (width, storeys, colours, roof kind, ground floor kind,
  shutters, flower boxes, balcony, corner windows); `paint_house` = shell -> its front run
  -> west side windows -> roof (`roofs.py`);
- real buildings: `voxelise/facade_runs.py` extracts runs from the rasterised footprints and
  plans them once per building, `voxelise/facade_style.py` picks the style from the BAG id,
  `voxelise/streets.py` decides SHOP / HOUSE / PLAIN, and `voxelise/facade_paint.py` paints
  them into each chunk tile and collects its placed pieces (`VoxelTile.placed`, passed to
  `layout_tile(placed=...)` by `blox build`). See `docs/guide/04-facades-and-pieces.md`.

`pieces.py` has the tiny "clear, place, backdrop" helpers. What each part uses:

- every window is a `window_1x2x3` frame (trim colour) with a sloped `slope30_1x2` sill
  or a flower box with `round_tile_1x1` flowers; a dark "room" backdrop sits behind it,
  varying per window;
- doors are `door_1x2x4` (accent colour); shops get an `arch_1x4` over the door, a sign
  band with `grille_1x2` lettering and a striped awning; `GroundFloor.ARCHED` puts every
  ground-floor opening under an arch with a glass fanlight;
- flat roofs get a `fence_1x4` balustrade, stepped gables a `jumper_1x2` on top, attic
  and dormer windows are `window_1x2x2`; `balcony=True` adds a fenced balcony.

## Brick models (`src/blox_pipeline/models/`, CONTRACT 7.1)

```
uv run python -m blox_pipeline.models                      # writes ../contract/models/{bus,boat,character}.json
uv run python -m blox_pipeline.models --preview ../build/models   # plus iso PNGs
```

Each model is a short generator using `ModelBuilder`: `place(piece, i, j, k, facing, colour,
part=...)` for special pieces, then `box(...)` to pour the body into the cells that are
still empty. Models face +j. The bus (5 x 24 x 16) has wheel parts; the boat (7 x 30 x 27)
has its pivot on the waterline; the character (4 x 1 x 10, arms included) is an original
blocky figure with `leg_l/leg_r` (hip pivots) and `arm_l/arm_r` (shoulder pivots) for a
walk cycle. `check_model` validates any model file independently.

## Look-test scene

`uv run python -m blox_pipeline.testscene --out ../build/testscene` lays out one
hand-authored chunk (Markt corner: river, quay, road, square, four townhouses, tower),
verifies it and writes the world plus `preview.png` / `preview_iso.png`.

## Status

Tested offline with hand-built fixtures in the real formats (CityJSON, GeoTIFF, OSM PBF,
HTTP range resume). The live endpoints were not reachable from the build machine, so the
first real `blox fetch` may need endpoint/parameter tweaks in `sources/config.py`.

## Credits

AHN / PDOK (CC0) · 3D BAG by TU Delft 3D geoinformation (CC BY 4.0) · © OpenStreetMap
contributors (ODbL) · PDOK Luchtfoto. Not affiliated with, endorsed or sponsored by the LEGO Group.
