# 02: Pipeline (Python)

Folder: `pipeline/` (package `blox_pipeline`, managed with `uv`). Spec: CONTRACT 4-7.
The full source list is in `pipeline/README.md`; this page explains the flow.

## How to run

```bash
cd pipeline
uv sync
uv run pytest                                                   # 453 tests (2026-10-19)
uv run python -m blox_pipeline.testscene --out ../build/testscene   # look-test chunk (no downloads)
uv run python -m blox_pipeline.models                           # rewrite contract/models/*.json
uv run blox fetch --bbox 176000,317500,176500,318000            # real data (needs internet)
uv run blox build --bbox 176000,317500,176500,318000 --out ../build/centre
uv run python tests/town_fixture.py ../build/fixture_data       # synthetic town (no downloads) ...
uv run blox build --data-dir ../build/fixture_data --bbox 176215,317495,176305,317550 \
    --out ../build/fixture_world --no-ortho                      # ... built the real way
uv run python -m blox_pipeline.tools.island_share ../samples/markt   # share of turned buildings in a built world
```

`blox fetch` and `blox build` have never run against live hosts: the build container blocks
every data host (see `docs/DATA_SOURCES.md` and `docs/STATUS.md`).

## Stages and modules

```
blox fetch:  sources/                 download + cache under data/raw/
blox build:  sources/  load           -> AHN HeightGrid, 3D BAG Buildings, OsmData
             voxelise/ prepare_world  -> slice-wide items: colours, feature ids, fixed heights,
                                         street context, facade runs (plan_facades, once);
                                         islands/plan_islands takes turned buildings off the grid
                                         and paves their footprint                CONTRACT 5.1
             voxelise/ build_layers   -> 2.5D column layers per 8x8-chunk region
             voxelise/ voxelise_tile  -> VoxelTile per chunk (+1-cell rim) + placed facade
                                         pieces (tile.placed)                      CONTRACT 7
             layout/   layout_tile    -> brick records (global coords), placed=tile.placed  CONTRACT 4
             islands/  build_islands  -> per turned group: local frame -> the same prepare/voxelise/
                                         facade/layout code -> records in local I, J (.bxi)
             io/       write_world    -> chunks/*.bxc, islands/*.bxi, manifest.json, features.json
             preview/  render_preview -> preview.png
```

| Module | Responsibility |
|---|---|
| `geo.py` | constants and RD ↔ grid ↔ Unity ↔ WGS84 conversions, `RDBox`, `CellBox` |
| `rotation.py` | the facing rule ([guide 01](01-coordinates-and-rotation.md)) |
| `catalogue.py`, `palette.py` | load `contract/*.json`; stud offsets and extents per type/rot |
| `sources/` | downloads (`http.py`: resumable, idempotent), `config.py` holds **all** endpoints; readers for AHN GeoTIFF, CityJSON, OSM PBF, aerial photo |
| `voxelise/` | turn sources into a dense `VoxelTile`: terrain, water, bridges, buildings (roof planes → slope stacks), trees, colours (`colours.py`, `landmarks.py`), features (`features.py`); facades: runs (`facade_runs.py`), style (`facade_style.py`), street context (`streets.py`), painting + placed pieces (`facade_paint.py`); glass-cell windows as the fallback |
| `facade/` | the facade grammar: facade runs (`run.py`, `frame.py`) used by test-scene houses and real buildings ([guide 04](04-facades-and-pieces.md)) |
| `testscene/` | hand-authored look-test chunk (`scene.py`), the `Canvas` painter (`canvas.py`), build script (`build.py`) |
| `layout/` | voxels → bricks (below) |
| `islands/` | rotated buildings (CONTRACT 5.1): `orient.py` dominant wall direction, `group.py` which buildings and terraces, `frame.py` local frame + axis-aligned local world, `build.py` voxelise/lay out with the world's code, `pose.py` the shared local ↔ world transform ([guide 04](04-facades-and-pieces.md)) |
| `io/` | `.bxc` format (`format.py`), `.bxi` islands (`island_format.py`, `island_writer.py`, `island_reader.py`), writer, reader, manifest/features documents, golden test files |
| `models/` | brick models (bus, boat, character) → `contract/models/` ([guide 05](05-movers-and-models.md)) |
| `preview/` | top-down PNG (islands drawn turned into place) and isometric PNG of any record array (a chunk or an island's local records) (no GPU needed) |
| `tools/` | `sample.py` (export a few chunks to `samples/`), `island_share.py` (how many buildings of a built world would be islands) |
| `cli.py` | `blox fetch` / `blox build` |

### Islands (`islands/`, CONTRACT 5.1)

Buildings turned more than 3° (alone, or as a terrace of touching houses with the same
angle) are not voxelised into the chunks. `prepare_world` moves them to `world.islands`
(`IslandGroup`: members + one yaw), paves their footprint, and `Layers.island_k` marks the
space as taken for neighbours. After the chunks, `build_islands` builds each group in its own
turned frame by running the *same* code on an axis-aligned copy ("fake RD" local
coordinates, see `islands/pose.py`), so walls are straight and get the facade grammar.
Buildings near a group but not in it (on-grid neighbours, other islands) are copied into the
local world as occupancy only (`frame.local_neighbours`), so an island's party wall against an
axis-aligned neighbour is not mistaken for a street front.
`blox build` logs the facade detail share for the world grid, the islands and the total, and
warns if an island's owning chunk has no file (renderers stream islands with their owner).
`tests/fixtures/town_world/` is the town fixture built with `blox build` (no preview),
committed so the C# tests read real pipeline-built islands; `test_committed_town_world_is_current`
fails when it is stale: regenerate with `BLOX_REGEN_FIXTURES=1 uv run pytest tests/test_islands_town.py`.
Cost: ~60 ms per island building. Full story: [guide 04](04-facades-and-pieces.md#rotated-buildings-islands-contract-51-pipelinesrcblox_pipelineislands);
file format: [guide 03](03-chunk-format.md).

### Buildings without 3D BAG (`sources/osm_buildings.py`)
3D BAG is the primary building source. When it is down, or some blocks were never fetched,
`load_all` fills the gaps: every OSM `building=*` footprint that no 3D BAG building covers
(at least 30% overlap) becomes a synthetic building. Ground comes from the DTM median. The
roof is a gable along the footprint's long axis (ridge at the DSM 90th percentile, eaves at the
25th) when the rise is at least 1.5 m and the width is 3-18 m; otherwise it is flat. Ids are
`osm-way/<id>`, there is no year, and the facade grammar and islands work unchanged.
`blox fetch` keeps going after a failed source and lists the failures at the end, so OSM
still downloads while 3D BAG is unreachable.

### Terrain smoothing (`voxelise/terrain_smooth.py`)

Before anything is quantised, the AHN ground model gets a NaN-aware blur
(`VoxelConfig.terrain_smooth_m`, default 2 m). AHN noise of ±10 cm would otherwise become
scattered one-plate steps on every square and street. Real slopes survive: a few metres of blur
leaves the rise from the Maas to the Vrijthof intact.

### The voxel tile (CONTRACT 7)

The voxel tile is the boundary between "where things are" and "which bricks". One tile is a
chunk plus a 1-cell rim. The rim is context for hollow culling only and is never emitted.

| Array | Type | Meaning |
|---|---|---|
| `color` | uint8 | palette idx, 0 = air |
| `feature` | uint32 | feature id, 0 = none |
| `shape` | uint8 | 0 full · 1..4 slope with low edge facing +j/+i/−j/−i · 5 ridge along i · 6 ridge along j · 7 tile (flat, no studs) · 8 water surface |

A tile also has `k0` (the global k of array index 0) and `(I0, J0)` (the global cell of index
[0,0]), plus optionally **placed** records (`VoxelTile.placed`: the facade pieces inside the
chunk; `cli.call_layout` passes them as `layout_tile(placed=...)`).

## How brick layout works

Entry point: `layout_tile(color, feature, shape, k0, I0, J0, placed=...)` in
`pipeline/src/blox_pipeline/layout/tile.py`. In order:

1. **Check placed pieces** (`layout/placed.py: placed_problems`). Each placed piece must be
   inside this chunk, on air cells, and must not overlap another piece. Otherwise
   `ValueError`.
2. **Hollow culling** (`layout/cull.py: exposed_mask`). A cell is kept when at least one of
   its 6 faces is not covered by an *occluder*. Occluders are cells with an opaque colour and
   a box-filling shape (full or tile). Slopes, ridges, water and glass don't occlude, so
   cells next to them stay. Outside the array counts as air sideways and above, and as
   ground below. Placed-piece cells are air in the grid, so **the wall behind a window
   frame stays**.
3. **Slopes and ridges** (`layout/slopes.py`). A slope is a vertical stack of 3 slope cells
   (one brick tall), and the full stack behind it is the studded back row. The code walks
   back from the low edge to measure depth, then splits into 33° (depth 3) and 45° (depth 2)
   slopes, merges equal neighbours into wider ones, and pairs ridges. The rot is
   `shape − 1` because slope shapes 1..4 are already in N/E/S/W order. Leftover slope cells
   fall back to plates.
4. **Tiles and water** are packed with tile pieces only (no studs). A water surface gets
   colour `water` unless its colour is already see-through.
5. **Full cells** are packed with bricks where 3 plates of the same label fit, and plates
   elsewhere.
6. **Placed pieces** are appended unchanged.
7. **`hide_studs`** (`layout/studs.py: hidden_studs`) is set on any record whose *every*
   stud cell has, directly above it, a solid input cell that no record covers (a
   hollow-culled interior). Renderers then skip those studs. On the look-test chunk it is set
   on 72 of 4,247 bricks.
8. **Sort** by `(K, J, I)`, the chunk file order.

### Greedy packing and running bond (`layout/pack2d.py`, numba)

Every cell gets a *label* (one per colour + feature pair). Pieces only merge cells with the
same label, and never cross a chunk border. Per level, candidates are scored

```
score = 4 * area - 9 * seams
```

`seams` counts the unit edges of the candidate's outline that sit exactly on a seam of the
level below, between two pieces of the same label. The penalty is bigger than the gain from
the next larger piece, so seams step sideways layer by layer: the running bond of a real
brick wall. On ties, the long axis prefers i on even layers and j on odd layers. Seams against
a different colour or wall are free, since they can't be avoided.

### Placed pieces

```python
rec = make_placed(cat, "window_1x2x2", I=10, J=40, K=95, facing="S", color=8)   # layout/placed.py
cv.place("window_1x2x3", i, j, k, "S", "white", fid)                           # testscene Canvas
layout_tile(cv.color, cv.feature, cv.shape, cv.k0, cv.I0, cv.J0, placed=cv.placed_records())
```

`(I, J, K)` is the min corner of the turned box. You never pick `rot`.

### Verification

`layout/verify.py: verify_layout` is an independent checker. It rasterises the records back
into cells and compares them with the input: no gaps, no overfill, no overlaps, no border
crossings, the hollow rule held, placed pieces unchanged, and `hide_studs` recomputed. The
test scene build (`testscene/build.py`) refuses to write a chunk that fails it.

## Tests worth knowing

| Test | Checks |
|---|---|
| `tests/test_rotation.py` | shared rotation vectors |
| `tests/test_layout.py`, `test_layout_helpers.py` | layout + fuzzed verify (random tiles with slopes, water, borders) |
| `tests/test_placed.py` | placed-piece rules, `hide_studs` |
| `tests/test_facade.py` | every house variant lays out exactly; street pieces face S, side pieces W; fence spacing |
| `tests/test_facade_frame.py` | a run painted through each frame (N/E/S/W) is the S result turned; bays move off chunk borders |
| `tests/test_facade_runs.py` | the synthetic town (`town_fixture.py`) through the real path: layouts verify with placed pieces, pieces face out of their wall and stay in their chunk, rims agree, determinism, the turned building falls back, shop/house/plain choice, storeys, detailed share; `--no-islands` staircase fallback |
| `tests/test_io.py` | `.bxc` writer/reader round trip, golden files shared with C# |
| `tests/test_island_io.py` | `.bxi` round trip, exact header bytes, writer validation, manifest `islands`, golden island shared with C# |
| `tests/test_islands_geometry.py` | shared `islands.json` vectors, affine matrices, orientation estimate (chamfer-robust), terrace grouping rules |
| `tests/test_islands_town.py` | the town fixture's islands: grouping, layouts verify, pieces face out, shops from world streets, plinth, paving, occupancy, before/after detail share, determinism, 256-stud split, `blox build` + preview, the `island_share` estimator, party wall against an on-grid neighbour, committed `fixtures/town_world` is current |
| `tests/test_models.py` | model generators and `check_model` |
| `tests/test_testscene.py` | the look-test scene builds and verifies |
