# 04: Facades and detail pieces

Spec: CONTRACT 2.1 (pieces 38-47) and CONTRACT 7 ("Placed pieces").
Code: `pipeline/src/blox_pipeline/facade/` (the grammar) and, for real buildings,
`pipeline/src/blox_pipeline/voxelise/facade_*.py` + `streets.py`. Two callers share one
painter: the look-test scene (`testscene/scene.py`) and every real 3D BAG building whose
walls lie on the grid (see [Real buildings](#real-buildings-3d-bag)).

## The facade grammar

The unit of the grammar is a **facade run**: one straight wall of one building with one
outward normal, a length in studs, a ground-floor line, an eave, and a style.
`FacadeRun` (`facade/run.py`) describes it and `paint_run` paints it:

```
corner pilasters -> upper storeys -> ground floor -> eave cornice
run.py              windows.py       ground.py       run.py
```

It paints in a **run frame**: `x` along the wall, `y` inward, the outside at −y, so its
pieces face `S` in the frame. `FramePainter` (`facade/frame.py`) maps the frame onto the grid
for any outward normal (a rotation, never a mirror), turning boxes, facings and slope
shape codes with it:

| outward normal | frame x | frame y (inward) |
|---|---|---|
| `S` (−j) | +i | +j |
| `E` (+i) | +j | −i |
| `N` (+j) | −i | −j |
| `W` (−i) | −j | +i |

So a window placed facing `S` in the frame faces the wall's real outward direction, and
`tests/test_facade_frame.py` checks that a run painted through each frame is exactly the
`S` result turned (cells, slopes, piece boxes and facings).

### Test-scene houses

A house is an axis-aligned box whose **street front faces −j** (so street pieces face `S`).
`HouseSpec` (`facade/spec.py`) says what it looks like; `paint_house` (`facade/walls.py`)
builds it, with its front as a run (`HouseSpec.front_run()`, the grid is its frame).

```python
HouseSpec(x0=13, y0=45, width=12, depth=16, storeys=2, fid=11, wall="brick_red",
          trim="white", accent="dark_green", roof="roof_tile_dark",
          roof_kind=RoofKind.EAVE_DORMERS, ground=GroundFloor.ARCHED,
          shutters=True, flowers="flower_pink", balcony=True)
```

| Field | Choices |
|---|---|
| `roof_kind` | `STEPPED_GABLE` (ridge runs back, stepped gable to the street), `EAVE_DORMERS` (ridge parallel to the street, dormers), `FLAT_CORNICE` (flat roof, cornice, fence balustrade) |
| `ground` | `HOUSE` (plinth, door, windows), `SHOP` (shop windows, arched door, sign band, awning), `ARCHED` (every opening under an arch), `PLAIN` (windows only: side and back walls of real buildings) |
| extras | `quoins`, `shutters`, `flowers` (first-floor window boxes), `balcony`, `corner_west` (windows on the west side wall) |

Vertical rhythm, in plates: plinth 3, ground floor 18, each upper storey 15.

### Rows along the run frame's y, seen from the street

```
y = y0 - 1   overhang row: cornice, awning slopes (outside the building)
y = y0       trim layer: pilasters, sills, bands, shutters, flower boxes (stick out)
y = wall_j   wall plane: window/door/arch pieces sit here      (y0 + 1)
y = glass_j  first interior row: dark "room" backdrops         (y0 + 2)
```

### Build order (`walls.py: paint_house`)

The order matters: placed pieces need air, and nothing may be painted over them later.

```
shell -> front run (pilasters, upper storeys, ground floor, eave cornice) -> west side windows -> roof
walls.py  run.py: paint_run                                                 windows.py           roofs.py
```

(Before 2026-10-19 the cornice came after the west windows; the two never touch, so the
look-test voxels are unchanged. The only look-test change of the run refactor: the shop
sign band's wall-plane row now stops inside the corner pilasters so it cannot wrap round a
corner, 8 cells, 4,245 -> 4,247 bricks, placed pieces identical.)

### Module map

| File | What |
|---|---|
| `spec.py` | `HouseSpec`, `RoofKind`, `GroundFloor`, the vertical rhythm (`PLINTH`, `GROUND_H`, `STOREY_H`), `front_run` |
| `run.py` | `FacadeRun` (a run in its frame; `bays()` and `free()` keep pieces off chunk borders), `paint_run`, pilasters, eave cornice |
| `frame.py` | `Frame` + `FramePainter`: run frame → grid for normals N/E/S/W |
| `bays.py` | `bay_starts`: spreads 2-wide window bays evenly between the corner pilasters, the remainder going to the central gaps |
| `pieces.py` | small helpers that all do "clear → place facing S (in the frame) → paint what's behind": `window`, `door`, `arch_over`, `sloped_sill`, `flower_box`, `fence_run` |
| `windows.py` | an upper-storey bay (window + sill or flower box + lintel + shutters), balcony, west side windows (facing `W`) |
| `ground.py` | `house_front`, `shop_front` (awning + `grille_1x2` sign lettering), `arched_front`, `plain_front` |
| `roofs.py` | stepped gable, eave roof with dormers (`window_1x2x2`), flat roof with `fence_1x4` balustrade, chimneys; slopes as 3-cell stacks (CONTRACT 7) |
| `props.py` | café table, planter, bench, bollard, street lamp (round tiles as flower heads and caps) |
| `painter.py` | the `Painter` protocol (`fill`, `clear`, `place`) the grammar needs; `testscene.Canvas` implements it |

Backdrops behind glass come from a hash of position and feature (`pieces.py: BACKDROPS`), so
rooms look different from window to window but stay stable between builds.

## Real buildings (3D BAG)

Code: `voxelise/facade_runs.py` (find and plan runs), `facade_style.py` (style per
building), `streets.py` (street context), `facade_paint.py` (paint into chunk tiles).
`prepare_world` plans every run once (`world.facades`); `voxelise_tile` paints the runs that
reach into its tile last (after trees); `blox build` passes `tile.placed` to
`layout_tile(placed=...)`. `--no-facades` (or `VoxelConfig.facade_detail=False`) switches it off.

### Run extraction

For each building (not a landmark, not a church), layers are built for its bounding box
+ 4 cells with the same `build_layers` the tiles use, so the planner sees exactly the cells
the voxeliser will fill (including which building wins where footprints overlap).

1. **Wall cells**: cells the building owns whose outward neighbour column (N/E/S/W) holds
   no building at all. Party walls and walls above a lower neighbour are not runs.
2. **Runs**: per normal, wall cells are grouped along their row (rows of j for N/S, columns
   of i for E/W) into maximal straight runs of consecutive cells.
3. **Eligibility** (else `reason`, and the run keeps the glass-cell fallback):

| reason | rule |
|---|---|
| `short` | fewer than 4 studs (`MIN_RUN`) |
| `skew` | less than 75 % of the run lies on a footprint edge that is axis-aligned (drifts < 0.25 m across its length) and sits within half a cell outward of the run's cell centres |
| `thin` | the two rows behind the wall are not the same building |
| `low` | less than one ground floor (18 plates) between floor line and eave |
| `street` | ground/water/deck in front higher than floor line + 2 plates, or water in front |

`skew` is what removes staircases: a building turned 30° rasterises into steps of 1-3
cells, and even a turned building with longer steps has no axis-aligned polygon edge
under them, so every step falls back. A footprint edge within ~1.4° of an axis (0.25 m
over 10 m) still counts as straight.

### Planning a run

- **Floor line** (`base`): the highest first-building-cell of the run's columns. Lower
  columns (sloping streets) get plinth down to their own ground.
- **Eave**: the lowest wall top (below the roof band: slope stack + back-row underlay, as
  `tile.py` fills it) over the run and the two rows behind it. Storeys come from the
  building height this way: ground floor 18 plates, each upper storey 15, the remainder
  (`eave_extra`) stays plain wall under the cornice. Roofs stay the LoD2.2 slope
  voxelisation; gable walls above the eave are repainted plain (no glass slits) with one
  `window_1x2x2` attic window where the gable is tall enough.
- **Ground floor** (`streets.py`): a probe strip 8 m deep in front of the middle 80 % of the
  run is tested against the street surfaces (OSM roads buffered by width, minus
  path/track/steps/cycleway/service; road areas). `SHOP` when it touches a pedestrian street
  or square in the centre zones, or the building has a shop/café POI inside (and has an
  upper storey for the sign band); else `HOUSE` with a door (or `ARCHED` for some
  pre-1800 buildings); runs facing no street, or narrower than 8 studs, are `PLAIN`.
- **Style** (`facade_style.py`, hash of the BAG id): trim, accent, plinth, quoins,
  shutters, flower boxes, awning colours, following the eras of `colours.py`: before 1900
  cream/white trim, mergel_dark plinth, shutters and flowers sometimes, quoins on mergel;
  1900-1945 painted trim, no shutters; after 1945 grey trim, no ornament. Light walls get
  a darker trim.

### Painting into chunk tiles (CONTRACT 4 and 7)

The carving: the wall row becomes the trim layer (air between the corner pilasters from
plinth to eave), the row behind it is the wall plane, the next the backdrop row, exactly
the rows a test-scene house has. Then `paint_run` runs through a `FramePainter` onto a
`TileCanvas` (global coordinates, clipped to the tile).

- **Same everywhere**: runs are planned once for the world, and each tile paints every run
  whose box reaches its tile (rim included) in the same order. Neighbouring tiles therefore
  agree on their shared rim (tested), so hollow culling at chunk borders is right.
- **Pieces stay in their chunk**: a tile records only the pieces inside its own chunk.
  Along a run, `FacadeRun.bays()` moves a bay off a chunk border by up to 2 studs (it needs
  `x-1 .. x+3` free for shutters and an arch) or drops it; the shop front skips units on a
  border and picks the door unit nearest the middle with room for its arch. Across the
  wall's depth, a piece that would still straddle a border (a sill whose wall row is the
  last row of a chunk) becomes a voxel stand-in: glass for windows, the piece colour
  otherwise.
- **No overlap**: every piece's cells are cleared first and locked; later fills skip locked
  cells, and a piece landing on a locked cell is skipped.

### What the fixture shows (`tests/town_fixture.py`)

Four terraced gabled houses (both ridge directions, one crossing a chunk border along i,
the back walls on the first row of the next chunk in j), a house turned 30°, a residential
street, a pedestrian street and a café POI. On it: 10 of 94 runs, **170 of 286 studs
(59 %) of exterior wall get full detail**: the whole terrace (fronts, backs, both end
walls); the turned house's 116 studs are all `short` staircase steps and keep glass cells.
`blox build` on it, viewed in the viewer: `build/shots/fixture_hero.png` (close-ups
`fixture_south.png`, `fixture_west.png`, `fixture_north.png`).

```bash
cd pipeline
uv run python tests/town_fixture.py ../build/fixture_data
uv run blox build --data-dir ../build/fixture_data --bbox 176215,317495,176305,317550 \
    --out ../build/fixture_world --no-ortho        # logs the detailed share
cd ../viewer && node build.mjs ../build/fixture_world && node screenshot.mjs ../build/shots hero
```

### Limitations

- **Maastricht's streets are not on the grid.** Only walls on axis-aligned footprint edges
  get the grammar; buildings along diagonal streets keep the glass-cell rhythm. On real data
  the detailed share will be well below the fixture's 59 %, and it has not been measured
  (data hosts are blocked in the build container). Fixing this properly needs rotated
  pieces or a per-street rotated grid, both beyond CONTRACT v2.
- Party-wall stretches above a lower neighbour are not runs (glass rhythm).
- Run ends are corner pilasters even where a run ends at a concave corner or a party wall.
- One style per building, one ground-floor kind per run; no balconies, dormers or roof
  details on real buildings (roofs stay the LoD2.2 voxelisation).
- Planning builds small layers per building: about 2 ms per building on synthetic data.

## The detail pieces (ids 38-47)

All are **placed** (never inferred from voxels). Directional ones have their decorated
front toward +j at rot 0. The whole bounding box counts as occupied for stud tests.

| id | name | w×d×h | Used for | Notes |
|---|---|---|---|---|
| 38 | `arch_1x4` | 4×1×3 | over shop doors and arched openings | opening is a half-ellipse under a lintel (see CONTRACT ISSUES in STATUS) |
| 39 | `arch_1x6` | 6×1×6 | (available, not used yet) | |
| 40 | `window_1x2x2` | 2×1×6 | dormers, bus and boat windows | frame 0.06 m bars, mullion, transom at 2/3, glass 0.1 m back |
| 41 | `window_1x2x3` | 2×1×9 | every storey window, boat cabin | |
| 42 | `door_1x2x4` | 2×1×12 | front doors, balcony doors, bus doors | leaf 0.06 m back, 4 raised panels, glass fanlight |
| 43 | `fence_1x4` | 4×1×3 | balustrades, balconies, boat rails | rails with studs, round spindles every 0.25 m |
| 44 | `round_tile_1x1` | 1×1×1 | flowers, bollard caps, lamp tops | no front, placed with `N` |
| 45 | `jumper_1x2` | 2×1×1 | top of stepped gables | one centred stud (`studs: center`) |
| 46 | `slope30_1x2` | 1×2×2 | window sills | shallow, no studs, 0.05 m lip |
| 47 | `grille_1x2` | 2×1×1 | shop sign "lettering" | 3 grooves on top |

Window and door panes always use the `glass` material, whatever the record colour; the record
colour is the frame. At night each window glows on its own (viewer `glow.js`; Unity uses the
brick seed in UV2.y).

Where the geometry is built:

| Renderer | File | Frame |
|---|---|---|
| viewer | `viewer/src/details.js` (`detailGeometry`), helpers in `shapes.js` | centred footprint, front −z |
| Unity | `Runtime/Meshing/Core/DetailMesher.cs` (pieces), `DetailParts.cs` (boxes, posts), `DetailShapes.cs` (sizes, `CoversLocal`) | rot-0 metres, front at z = d |

Both use the same numbers (bar 0.06 m, pane back 0.1 m, rail 0.1 m, spindle step 0.25 m).

## How to add a new piece end to end

Example: a `shutter_1x2x3`. Each step names the file to touch.

1. **Contract** (needs a version bump and every component updated, CLAUDE.md):
   - append an entry to `contract/brick_catalogue.json` (ids are append-only), with `kind`,
     `w`, `d`, `h`, `studs`;
   - describe its geometry in the CONTRACT 2.1 table, and say where its front is;
   - if it is a new `kind`, add it to the list in CONTRACT 2.
2. **Pipeline**
   - `catalogue.py`: add a new kind to `DETAIL_KINDS`.
   - `layout/verify.py` needs no change: any kind outside `KIND_CODE` is treated as
     `DETAIL_CODE`, which is valid only as a placed piece.
   - Use it from the grammar with `cv.place("shutter_1x2x3", i, j, k, "S", colour, fid)`,
     usually inside a helper in `facade/pieces.py` that clears the cells first.
   - Tests: `tests/test_catalogue.py` (loads, stud offsets), `tests/test_facade.py` (faces S,
     air in front and wall behind, layout verifies).
3. **Viewer**
   - `src/details.js`: add a `case` in `detailGeometry` that returns `{ body, glass? }`,
     built in the local frame (centred, front toward −z).
   - `src/gallery.js`: add a colour in `COLOR_BY_KIND` so the gallery shows it.
   - Check it by eye: `node screenshot.mjs ../build/shots gallery ids=48`. The decorated side
     must look at the yellow marker for all four facings.
4. **Unity**
   - `Runtime/Data/Contract/Catalogue.cs`: add a `BrickKind` value, parse its `kind` string,
     and include it in `IsDetail`.
   - `Runtime/Meshing/Core/DetailMesher.cs`: add a `case` in `Emit`, built in the rot-0
     metre frame (front at z = d), from `DetailParts` building blocks.
   - `Runtime/Meshing/Core/DetailShapes.cs`: its sizes, and in `CoversLocal` which cell faces
     it closes (that drives face culling of its neighbours).
   - Tests: `dotnet/Blox.Tests/DetailMesherTests.cs` (every rotation; closed, outward-facing
     geometry; glass panes in submesh 1).
5. **Regenerate and look:** `scripts/shots.sh`, then `scripts/check.sh`.
6. **Docs:** add a row to the table above and an entry in `docs/DEVLOG.md`.
