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
- **Windows**: facade cells exposed to air on one side get `glass` in a band 0.8-2.2 m above
  each 3 m storey, one stud wide every 2 or 3 studs (per-building hash); corners, roof
  stacks, churches and landmarks are skipped.
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

## Status

Tested offline with hand-built fixtures in the real formats (CityJSON, GeoTIFF, OSM PBF,
HTTP range resume). The live endpoints were not reachable from the build machine, so the
first real `blox fetch` may need endpoint/parameter tweaks in `sources/config.py`.

## Credits

AHN / PDOK (CC0) · 3D BAG by TU Delft 3D geoinformation (CC BY 4.0) · © OpenStreetMap
contributors (ODbL) · PDOK Luchtfoto. Not affiliated with, endorsed or sponsored by the LEGO Group.
