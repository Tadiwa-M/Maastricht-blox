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

## 2026-10-19: Unity reads and renders islands (contract v3, track U)

**What changed**
- `Blox.Data`: `.bxi` reader/writer (`IslandHeader`, `IslandReader`, `IslandWriter`), `IslandPose`
  (local <-> world, plus `UnityEulerY`, Unity's own Y rotation written out), `IslandIndex`
  (occupancy within the island). `ChunkOccupancy` now wraps a shared `ColumnOccupancy` (any grid
  size, unsorted records). `Manifest.Islands`; `WorldSpec.ContractVersion` = 3 (manifests 1..3 read).
  `WorldIndex` lists islands by owning chunk and loads/unloads them; `WorldFiles` loads `.bxi`
  (sha1 and brick count checked). `WorldRaycast` also walks loaded islands (ray turned into the
  island frame, same DDA); `BrickHit.IslandId` marks island hits.
- `Blox.Meshing`: `IslandMesherCore` (the chunk mesher on the island grid, local space, no
  neighbours; `StudsToWorld`), `CellGrid.ComputeDims` and `LodMesherCore.ComputeDims` take a grid
  size, `IslandMeshJob`, `LodMeshJob.SizeI/SizeJ`, `ChunkMeshBuilder.ScheduleIsland` and
  `IslandTransform`. `PendingChunkMesh` carries an island id and returns world-space studs.
- `Blox.Rendering`: `WorldLoader` meshes a chunk's islands at the chunk's level, one GameObject per
  island at (originX, 0, originZ) with `Quaternion.Euler(0, yawDeg, 0)`; `StudRenderer` takes
  island batches; island materials are copies with fake studs off.
- Shaders: horizontal-face bevel axes follow the object's yaw (`objectXWS`, TEXCOORD7). Also fixes
  top-face bevels of rotated brick models.

**Why**
- Islands are "a chunk on its own turned grid", so reusing the chunk mesher, occupancy and record
  reader keeps one code path and one set of culling rules. Islands follow their owning chunk for
  streaming/LOD (the contract's "owning chunk"), so there is no second planner to tune.
- Sign check: Unity is left-handed, Y up, +Z north; positive Y rotation turns +Z toward +X =
  clockwise from above = the contract's yaw. No flip; pinned by tests against
  `contract/test_vectors/islands.json`.
- Studs are baked to world space on the CPU (instead of a per-batch matrix) so `StudCull.compute`
  and `Stud.shader` stay unchanged.

**Numbers**
- dotnet: `Blox.Tests` 360 passed (was 319), `Blox.LookTests` 67 passed. The pipeline golden
  island (`i_000001.bxi`, yaw -33.5, a brick at local i = 252) reads byte-exact; the uncompressed
  one re-writes byte for byte; record `world` positions match the pose.
- `build/fixture_world` (synthetic town): island 1 yaw -30, 998 bricks, 28 x 32 studs, 292 studs;
  island 2 yaw 20, 2722 bricks, 46 x 29 studs, 657 studs; both mesh on their own grid.

**Open decisions / not done**
- Nothing ran in Unity (not installed here): island GameObjects, Burst `IslandMeshJob`, the shader
  change. Check on the GPU workstation with `scripts/unity.ps1 all`.
- Islands get no far fake studs (beyond 130 m roofs look smooth). Fix would be a per-island
  stud-top lookup or object-space fake studs.
- Gameplay ground queries (`WorldIndex.IsSolid`/`ColumnTop`, `CharacterWalker`) ignore islands:
  walkers pass through rotated buildings. Needs an "is solid at world point" that also asks islands.
- Colour variation of island bricks hashes island-local (i, j, k); the contract doesn't say.
  The viewer should do the same, or the contract should pick a rule.

## 2026-10-19: rotated building islands in the pipeline (contract v3, track P)

**What changed**
- New package `pipeline/src/blox_pipeline/islands/`: `orient.py` (dominant wall direction mod
  90°: length-weighted histogram peak, then circular mean of the edges near it), `group.py`
  (|yaw| > 3° → island; touching houses with yaws within 3° → one terrace group, merged
  strongest contact first while the group stays within 3°), `frame.py` (local frame: origin
  snapped so the main walls sit on cell centres, footprint grown by 0.25 m, DTM sampled at
  world positions, street probes evaluated back in world space), `build.py` (voxelise + facade
  + layout per 64-stud local sub-tile, terrain stripped, plinth 2 plates below ground,
  split into 256-stud islands), `pose.py` (`island_local_to_world`, passes
  `contract/test_vectors/islands.json`).
- World side: island buildings leave `world.buildings`; their footprint is paved
  (`island_paving`, priority above roads); `Layers.island_k` marks them occupied, so
  neighbours get no facade/glass on a party wall against an island and no trees inside.
- IO: `.bxi` writer/reader (`io/island_*.py`, 40-byte header), manifest `"islands"` list,
  `contractVersion` 3. Golden fixture `pipeline/tests/fixtures/golden/i_000001.bxi`
  (+ `_uncompressed`) and `golden_island.json` (every field, plus world positions) for C#.
- `blox build` builds islands, logs facade detail for world grid / islands / total;
  `--no-islands` keeps v2 behaviour. Top-down preview draws islands turned into place.
- Town fixture: + a terrace of three touching houses turned −20° (one island, yaw +20) with
  a pedestrian street along its front, + a house turned 2° (stays on the grid).
- `tools/island_share.py`: estimates the share of turned buildings in an existing world from
  its bricks (outline from brick columns, simplified, same estimator and grouping).

**Why this way**: the voxeliser, facade planner and layout already work; islands reuse them
unchanged by mapping local metres to "fake RD" `(X0 + u, Y0 + v)`. Laying islands out in
64-stud sub-tiles keeps the chunk rules, so cutting at 256 never splits a brick and the
facade code's chunk-border handling still holds.

**Numbers**
- Town fixture facade detail: **42 % → 93 %** of exterior wall (v2 `--no-islands`: 12/182
  runs, 264 studs `short`; v3: 24/26 runs; islands alone 12/12 runs, 212 studs, 100 %;
  the turned terrace's fronts are shop fronts via the world-space street check).
- `samples/markt` (estimate, raster-based, ±2°): 108 of 132 whole buildings (82 %) would be
  islands, in 56 groups; 17 of them are at 3-5°, inside the estimator's error, so 69-82 %.
  Validated on the fixture rebuilt with `--no-islands`: finds exactly its 4 island
  buildings in 2 groups, yaws within 2.3°.
- Cost ~60-70 ms per island building (≈ 6-7 extra minutes for the full slice if ~80 % of
  8725 buildings are islands; parallelising groups is easy if needed).
- Tests: pipeline 453 passed (was 391).

**Open decisions**
- Renderers (viewer, Unity) don't draw islands yet (other tracks). Until then a v3 world
  shows paved empty footprints where turned buildings stand.
- Buildings turned 1-3° stay on the grid and can still have `skew` walls (fixture: the 2°
  house's 8 m walls). Threshold is `VoxelConfig.island_min_yaw_deg`.
- No water/bridges inside an island's local world: a canal-side island wall is not checked
  for the `street` (water in front) fallback.
- Two detailed walls meeting at a corner can put two corner windows back to back; more
  visible now that free-standing island houses get four detailed walls.

## 2026-10-19: islands cross-check (pipeline <-> C#)

**What changed**
- Bug fix (pipeline, `islands/frame.py`): an island's local world only contained the group's own
  members, so a party wall shared with an on-grid neighbour (or another island) was planned as
  a street front and got windows and a door. Nearby non-member buildings are now copied into the
  local world as occupancy only (`local_neighbours`, same mechanism the world grid uses for
  islands). Regression test: `test_party_wall_against_an_on_grid_neighbour_gets_no_facade`.
  The town fixture's output is unchanged (its islands touch no on-grid building).
- `write_world` warns when an island's owning chunk has no file (it would never stream in).
- `pipeline/tests/fixtures/town_world/`: the town fixture built with `blox build`, committed so
  CI's dotnet job (which doesn't run the pipeline) reads real pipeline-built islands. Kept
  current by `test_committed_town_world_is_current` (`BLOX_REGEN_FIXTURES=1` regenerates).
- C# `IslandTests`: the old fixture test skipped unless `build/fixture_world` existed (never in
  CI); it now reads the committed world (or `BLOX_ISLAND_WORLD_DIR`) and is a plain `[Fact]`.
  New `PipelineBuiltIslandsSitOnTheirPavedHole`: islands placed by C#'s `IslandPose` land on the
  pipeline's paving (91 %/93 % of interior columns; 1 %/12 % with the yaw flipped) and their
  plinth reaches the chunk ground: yaw sign and origin agree end to end.

**Reviewed, no change needed**: yaw sign on both sides (pipeline affine matrices, Unity
`Quaternion.Euler(0, yaw, 0)`), origin = local (0, 0) min corner with global k, cell-centre
snapping of the main walls, half-stud growth, owning chunk = brick-extent centre, 256-stud split
(sub-tiles never let a brick cross a 64-line, origins offset along local axes).

**Open**: island ids depend on build bbox (contract has no stability rule); a group's facade
props (sills, awnings, street props up to 3 cells out) can overlap world features outside the
paved footprint; the shared party wall itself is still drawn twice (neighbour's straight wall
and the island's turned wall cross), which is inherent to mixing grids.
