# Dev log

Dated record of what was built and why. Newest at the bottom. Append a section for every
working session: what changed, decisions taken (and the alternatives turned down), test counts.

---

## 2026-10-17: Foundation (contract v1)

**Process.** Outline → tools → plan (`PLAN.md`) → **contract first** (`CONTRACT.md` v1,
`contract/palette.json`, `contract/brick_catalogue.json`), then parallel tracks with disjoint
file ownership (pipeline, proxy, Unity data/meshing, Unity rendering), then one integration and
review pass.

**Built**
- Pipeline: `blox fetch` (AHN, 3D BAG, OSM, optional aerial photo) and `blox build`
  (voxelise → brick layout → `.bxc` chunks → preview). Hollow culling, slopes and ridges,
  greedy packing with running bond, an independent layout verifier, golden chunk files.
- Proxy: FastAPI on `127.0.0.1:8787` with `/v1/health, vehicles, shapes, stops, weather, water`;
  GTFS-RT decode, shape matching, Buienradar, RWS.
- Unity: chunk reader, `WorldIndex`, ray cast, Burst mesher with HLOD and instanced studs,
  live client with the motion rule, URP setup and look-test scene from editor menus, shaders.
- `dotnet/` harness to test the engine-free C# without Unity.

**Decisions**
- **Scale: 0.5 m stud, 0.2 m plate** (real 8 : 3.2 : 9.6 proportions). 2 × 2 km is
  4096 × 4096 studs in 64 × 64 chunks of 64 × 64 studs.
- **Hollow storage:** only bricks with an exposed face are written.
- **Variation from a position hash**, not stored.
- **Analytic bevels in Unity** (face coordinates in UVs, the shader draws edges) instead of
  bevelled geometry: no extra triangles for a whole city.
- **No hand-edited Unity YAML:** scenes and assets come from editor scripts.

**Environment limits found.** The container blocks every data host (PDOK, 3D BAG, Geofabrik,
OVapi, Buienradar, RWS, NS), and Unity isn't installed. So everything was tested against
hand-built fixtures in the real formats, and `docs/DATA_SOURCES.md` marks unverified endpoints.

**Review fixes:** proxy `ts` is now the proxy clock; `LiveClock` snaps large errors; repeated
GTFS-RT reports reuse the cached match; Buienradar night icons parse. The Vrijthof reference
point is Unity (485, 1217).

**Tests:** pipeline 110, proxy 67, dotnet 254, LookTests 57.

---

## 2026-10-19: Facades, viewer, contract v2, movers, docs

**Look feedback that drove this session.** Facades looked flat. The user picked **option 2:
custom detail pieces** (windows with frames and mullions, doors, arches, fences, ...) at the
existing scale, over halving the stud size. Halving every cell dimension would mean about 8× the
cells, and still no window frame thinner than a cell. The user also asked for rotations and
movement to be easy, and for the project to be documented as it is built.

**Built**
- **Facade grammar** (`pipeline/.../facade/`): `HouseSpec` with three roof kinds, three ground
  floor kinds, shutters, flower boxes, balcony, corner windows. A richer look-test scene (Markt
  corner: river, quay, road, square, café terraces, four townhouses, tower).
- **Browser viewer** (`viewer/`, three.js): renders the same chunks in headless Chromium for
  screenshots, because Unity can't run here.
- **Contract v2** (`contractVersion` 2, chunk binary still BXC1 v1):
  - **Facing rule:** every directional piece's front faces +j at rot 0; callers say N/E/S/W.
    One rotation module per language; shared vectors in `contract/test_vectors/rotation.json`.
  - **Detail pieces 38-47** (CONTRACT 2.1), *placed* by the grammar and passed through layout.
  - **`hide_studs`** (rotFlags bit 3): studs under hollow-culled interiors.
  - **Thin slope lip:** 0.25 plate (0.05 m) instead of a full plate.
  - **Brick models** (CONTRACT 7.1): bus, boat, character as JSON in `contract/models/`,
    poses (position + yaw clockwise from north), `PathMover` with the "two axles" corner rule.
  - Palette v2 appended idx 41-46 (append-only, so no contract bump for that alone).
- **Movers:** C# `Pose` / `PathMover` in `Blox.Data`, shared by live buses (`ShapePolyline`),
  `PathFollower` and `CharacterWalker` (WASD walk mode with `GroundProbe` and `WalkCycle`).
  Viewer: `mover.js`, `demo.js` (bus, boat, walkers).
- **Docs:** `docs/README.md`, `ARCHITECTURE.md`, `guide/01..08`, this log.

**The eight look issues and what was done**

| # | Issue | Change |
|---|---|---|
| 1 | flat water, grey reflections | viewer: sky shader also renders the PMREM env map (`sky.js`), procedural ripple normals (`ripples.js`). Unity's water ripples are in `BloxWater.hlsl` |
| 2 | subtle AO | viewer GTAO radius 0.35 → 0.18 m with a stronger scale (`post.js`). Unity SSAO is set to 0.12 m, intensity 2.4 |
| 3 | uniform glass, seams on glass | per-window lighting from a hash (`glow.js`; Unity: brick seed); seamless glass geometry (viewer) and UV1 = 0 on glass faces (Unity) |
| 4 | long shadows, plain ground | minimum daytime sun elevation of 22° (`scene.js`); studded baseplate texture (`ground.js`) |
| 5 | strong tilt-shift in close-ups | blur grows with camera distance and is off below 15 m (`post.js`) |
| 6 | chunky slope lip | contract v2 lip 0.05 m (`LIP_PLATES` in the viewer, `BrickProfile.LipPlates` in Unity) |
| 7 | picking scans every instance | viewer: 3D DDA through the grid (`picking.js`); Unity has `WorldRaycast` (not wired to the camera yet) |
| 8 | studs under interiors | `hide_studs` from the pipeline; viewer also flood-fills outside air |

**Cross-language checks:** all rotation vectors pass in Python, JS and C#. In the look-test
chunk, every street-front window, door, arch and fence faces S, and the 12 west side windows
face W. `hide_studs` is set on 72 of 4,245 bricks. C# and the viewer both find 967 exposed
studs (824 after the viewer's flood fill). Models were regenerated: bus 144 bricks, boat 190,
character 9.

**Tests:** pipeline `208 passed`, proxy `70 passed, 1 warning`, dotnet core `Passed: 319`,
LookTests `Passed: 67`, viewer `# pass 24  # fail 0`.

---

## Open decisions / next steps

**Contract questions** (raised by the tracks, not applied; a v3 would settle them):
1. Arch opening: a true semicircle doesn't fit the brick height. Both renderers use a
   half-ellipse under a lintel. Reword CONTRACT 2.1.
2. Boat pivot is on the waterline, not "ground centre". Allow it in 7.1, or make movers
   offset boats.
3. Part rotation sign isn't stated. Unity uses "positive tips the top forward".
4. Jumper stud cells: which cells must be free for the centred stud (all three
   implementations require both).
5. `slope30_1x2` is `backRows` with `studRows: 0`; `studs: none` would be clearer.
6. Window/door frame bar depth and what sits behind the panes are unspecified (both use
   full-depth bars, open back).
7. No separate water material class: the viewer finds water by `water*` palette names.

**Next steps**
- First Unity run on the PC: `Blox/Setup Project`, `Blox/Create Look Test Scene`, Play; check
  the detail mesher inside the Burst job, the movement scripts, and whether the bus route fits
  the road.
- Use the facade grammar (placed windows and doors) on real map buildings instead of glass
  cells.
- Spawn a bus model per live vehicle from `LiveClient.SamplePoses()`.
- Wire `WorldRaycast` into `MapCameraRig` for brick-exact picking, then building info and search.
- Real data: `blox fetch` on the PC; confirm AHN, 3D BAG and the RWS station code.
- In-game credits screen (CONTRACT 9).
- Small Unity gap: changing the bus corner smoothing in the Inspector during Play only affects
  routes loaded afterwards.

## 2026-10-19 (later): workstation automation

- The owner's PC is slow; a GPU workstation will run Unity. Added `scripts/setup-workstation.{ps1,sh}`
  and `scripts/unity.{ps1,sh}` (headless setup → EditMode tests → player build → screenshot) so
  Claude on the workstation can iterate on compile errors and the look without manual clicks.
- Unity side: `Blox.Editor.BatchMode` (exit codes for scripts), `ProjectSetupMenu.Apply()` and
  `LookTestSceneMenu.Build()` split out of the menu handlers, `Blox.Gameplay.ShotRunner`
  (`-bloxShot`), and `WorldLoader` honours `-bloxWorld` (players have no project folder).
- Guide: `docs/guide/00-workstation-setup.md`. Still uncompiled until the first workstation run.

## 2026-10-19: Facade grammar on real 3D BAG buildings

**What changed**
- The grammar's unit is now a **facade run** (`facade/run.py: FacadeRun`, `paint_run`): one
  straight wall, one outward normal, a length, a floor line, an eave and a style.
  `facade/frame.py: FramePainter` turns the run frame (pieces face `S`) to N/E/S/W as a pure
  rotation (boxes, facings, slope codes). `HouseSpec.front_run()` makes the test-scene houses
  use the same painter. New `GroundFloor.PLAIN` (windows only).
- Real buildings: `voxelise/facade_runs.py` finds runs on the rasterised footprints (wall
  cells whose outward column has no building, maximal straight lines per normal) and plans
  them once per building from that building's own layers; `facade_style.py` picks style from
  a BAG-id hash by era; `streets.py` picks SHOP (shop/café POI inside, or facing a pedestrian
  street/square in the centre) / HOUSE (street-facing, door) / PLAIN; `facade_paint.py`
  carves the wall (trim layer, wall plane, backdrop rows as in a test house), paints the run
  into each chunk tile, repaints gables above the eave plain with an attic window, and puts
  the chunk's pieces in `VoxelTile.placed`, which `blox build` passes to
  `layout_tile(placed=...)`. Landmarks and churches get no grammar. `--no-facades` turns it off.
- Fallback unchanged: short runs (< 4 studs), staircase/non-axis-aligned walls (`skew`: less
  than 75 % on an axis-aligned footprint edge), thin, low or street-blocked walls keep the
  glass-cell rhythm.
- Chunk borders: bays shift up to 2 studs off a border or are dropped; shop units on a border
  are skipped; pieces that would still straddle (sills across the wall depth) become voxel
  stand-ins. Every tile paints all runs reaching it in one order, so tile rims agree.
- Synthetic town fixture `pipeline/tests/town_fixture.py` (4 terraced gabled LoD2.2 houses, a
  house turned 30°, residential + pedestrian street, café POI), written as a cached data dir
  so `blox build --data-dir` runs on it.

**Numbers**
- Fixture: 10 of 94 runs, **170 of 286 studs (59 %) of exterior wall** fully detailed (the
  whole terrace); the turned house's 116 studs are all `short` staircase steps. Its 6 chunks
  verify with `verify_layout(placed=...)`, 0 problems; 250 placed pieces (109 `window_1x2x3`,
  4 attic `window_1x2x2`, 112 `slope30_1x2` sills, 12 grilles, 6 round tiles, 5 doors, 2 arches).
- Look-test scene: voxels identical except the shop sign's wall-plane row no longer wraps
  round the corner pilaster (8 cells): 4,245 -> 4,247 bricks (re-packing: brick_1x1 -1,
  brick_1x4 -1, brick_1x6 +1, plate_1x1 +2, plate_1x2 +2, plate_1x3 -1, plate_1x6 +1, plate_1x8 +1,
  plate_2x2 -1, plate_2x8 -1); placed pieces identical (137), `hide_studs` still 72.
- Tests: pipeline `388 passed` (was 208; +6 PLAIN house variants, +144 bay/border cases,
  +17 frame tests, +13 real-path tests; existing building tests now pin `facade_detail=False`).
- Planning cost ~2 ms per building (400 synthetic buildings: 0.8 s vs 0.1 s without).
- Shots: `build/shots/fixture_hero.png` plus `fixture_south.png`, `fixture_west.png`,
  `fixture_north.png`.

**Open decisions**
- Maastricht's streets are mostly not grid-aligned, so on real data much less than 59 % will
  be detailed; unmeasured until real data can be fetched. Options: rotated detail pieces
  (contract change) or snapping near-axis edges more generously.
- Walls above a lower neighbour and runs ending at concave corners/party walls get simple
  treatment (glass rhythm / corner pilaster).

## 2026-10-19 (evening): laptop verified on Windows

- Windows laptop set up with `scripts/setup-workstation.ps1`; `scripts/check.ps1` passes all suites
  (pipeline, proxy, dotnet core + look, viewer). This is the first run outside the Linux container.
- Fixes found along the way: run from PowerShell, not cmd; refresh PATH after winget installs;
  the Chromium download (screenshots only) is now opt-in via `-WithBrowser`, because it hangs while
  extracting on Windows.
- Next: first real-data `blox fetch` (endpoints still UNVERIFIED), Unity on the GPU workstation.

## 2026-10-19 (night): first real Maastricht

- Laptop: `blox fetch` worked on the first try (the PDOK AHN WCS still serves AHN), and
  `blox build` made the full 2×2 km slice: 4096 chunks, 8725 buildings, 10388 features in 13.5 min.
- Facade detail on real data: **4%** of exterior wall (2180 of 255k runs). Most fallback is
  "short" (61%) and "skew" (32%): angled and jagged footprints. The rotated-building proposal is
  now the main open decision.
- First real-data sample committed: `samples/markt/` (49 chunks), exported with
  `blox_pipeline.tools.sample`, so the cloud session can debug real data.
- Fixes from the sample: flat roofs no longer use pure black (it read as holes); the DTM is
  smoothed before quantising (contour ripples on the Markt); slate and roof_tile_dark lightened
  slightly (palette values only, indices unchanged).
- The viewer was too slow on the laptop for 7×7 real chunks (265k bricks): per-chunk LOD work
  is in progress.
- Workstation (RTX 5070, no admin rights): the setup script now installs uv/.NET/Node per user.
  Unity needs IT or an existing install.
