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

## 2026-10-19: viewer performance for real neighbourhoods (per-chunk LOD, quality tiers)

The owner's laptop showed ~0 fps on 7x7 real chunks. Measured with the new `viewer/tools/perf.mjs`
(renderer.info, all passes per frame) on `samples/markt`: **224 draws, 341.3 M triangles, 71,817
studs** per frame. The viewer was built for one 4k-brick chunk (300-triangle bevelled bricks,
360-triangle studs, scene drawn three times: shadow map twice + main).

- **Shadow map once per frame** (was redrawn by the AO pass's normal render): same image, -25 %
  triangles everywhere. Look-test chunk: 498 / 6.53 M -> 380 / 4.89 M, pixel-identical within
  the AO noise between runs.
- **Per-chunk LOD** (`viewer/src/lod.js`, `farmesh.js`): near chunks keep the full look (lazy,
  one chunk per frame, LRU); the rest is a merged flat-box mesh (slope prisms, glass quads that
  still glow at night) with hidden faces removed via the occupancy grid, merged per 2x2 chunk
  cluster and material, chunks drawn as geometry groups. Studs only near, capped.
- **Exterior air from above** (`exterior.js`): flood from the sky down, never into "bottomless"
  air under the terrain shell. Culls 72 % of far faces on real data (was 44 %); grid 7 s -> 0.3 s.
- **Quality tiers** (`quality.js`, HUD selector, `#quality=`): auto = high without LOD for one
  chunk (look test unchanged), medium for bigger worlds (lite bevels near, half-res AO, pixel
  ratio 1, bloom only at night, 2048 shadows), stepping down to low on slow frames. The fps
  readout was measured correctly but rounded to whole fps; now one decimal + frame ms.
- Big-world hero is a 3/4 view over the centre; presets ignore features outside the embedded
  chunks (the Markt facade view pointed outside the sample). `#zoom=` scales a preset.
- Result on `samples/markt`: overview **90 draws / 2.67 M triangles** (medium), street level
  with 3 near chunks 380 / 5.89 M (low: 200 / 2.91 M). Load to first frame ~21 s -> ~4.5 s
  (headless). Viewer tests 24 -> 37.

**Open decisions**
- Not yet measured on the laptop iGPU; the medium street-level view is the heavy case.
- Far chunks have no studs; a procedural stud pattern on far tops (shader, no geometry) would
  soften the near/far change if the owner finds it visible.
- Tilt-shift stays full resolution (cheap at pixel ratio 1; half-res needs extra passes).
- Near-chunk build is a ~40-90 ms hitch when a chunk comes close; could be split over frames.

## 2026-10-19: Viewer renders rotated building islands (CONTRACT v3 section 5.1)

The browser viewer now reads `islands/*.bxi` and draws each island as one rigid object.

- `viewer/src/bxi.js` reads the 40-byte `BXI1` header + records (record decoding shared with
  `bxc.js`); tested against the pipeline's golden island (both files, header hex, records,
  each record's world position through the pose).
- `viewer/src/island.js`: one World per island **in local cells**, so occupancy, exterior flood
  fill, stud exposure, hidden-face culling, glow and colour variation (hash of local i, j, k)
  all run in island space unchanged. The group pose is `(originX, 0, -originZ)`, rotation
  **-yaw** about +Y in three.js (right-handed), checked against `contract/test_vectors/islands.json`.
- `lod.js`: islands are extra LOD "chunks" with their own source World, near/far looks under the
  posed group, near/far by the island's world bounding box. `picking.js: pickNearest` moves the
  ray into each island's frame, nearest hit wins; the info panel shows the building.
- `build.mjs` embeds islands (`--around` filters by owning chunk). New presets `#view=island`
  (street facade of the biggest island, chosen by where its windows/doors face) and
  `#view=islandmap` (top view to compare with `preview.png`).
- Verified on `pipeline/tests/fixtures/town_world`: plinths stand on the pavement plots (91-93 %
  of plinth cells, rest is the half-stud growth; a flipped yaw gives < 25 %; now a test). The
  look-test chunk and `samples/markt` give identical draw calls/triangles/studs to before.
  Viewer tests 37 -> 44.

**Open decisions**
- Feature names are empty for most fixture buildings; the panel falls back to kind + address
  or BAG id.
- Island near looks count against the same `maxNear`/stud caps as chunks; a dense real
  neighbourhood with many islands may want its own cap.
- `presets.js: clearestFacade` (the `facade` view) still only scores world-grid buildings.

## 2026-10-23: real city with islands; launch pivots to the browser

- Workstation full build: 4096 chunks and **2448 rotated-building islands**. A real-data bug was
  fixed: the island plinth overwrote door pieces on sloping streets.
- Sample `samples/markt_v3` (49 chunks, 40 islands) exported; `tools.sample` now includes islands.
- Downloads no longer splice two versions of a daily "latest" file (the corrupt-OSM bug).
- **Decision:** launch as a playable **web** city (three.js engine), not a Unity download.
  Reasons: link-clickable for the LinkedIn audience, already renders the real data, works on
  phones. Unity is parked until after launch. See PLAN.md phase 2.

## 2026-10-23: Walk mode (phase 2, track P: player)

Drop into a third-person walk anywhere in the web city (`viewer/src/player/`, guide 09).

- **Modes:** map (MapControls) <-> walk. Enter with the "Walk here" button, F (cursor), a
  double-click / double-tap or gamepad A (screen centre); leave with Esc, gamepad B or "Map".
  The camera tweens 1.1 s between them. `#mode=walk&at=x,z` (Unity metres) starts walking.
- **Character:** the original blocky `contract/models/character.json` at contract scale, walk
  cycle from `mover.js` (longer stride when running), forward lean, idle arm sway.
- **Controller:** kinematic cylinder (r 0.35 m, h 1.9 m) against a city query API
  `isSolid(x, y, z)` / `groundHeight(x, z)` (three.js metres, `'unknown'` when not loaded).
  Walk 1.4 m/s, run 4 m/s, eased acceleration, step-up ≤ 0.42 m (kerbs, steps; a 3-plate brick
  is a wall), sub-stepped moves (no tunnelling), gravity with exact landing, small jump.
  Unknown space is solid, so the player can't walk or fall into unloaded areas.
- **Islands collide** through the same API: until the core's streaming `src/city.js` is passed
  in, `city-adapter.js` builds it from the World + island poses (inverse pose into local
  cells, as picking does). Probe on `samples/markt_v3`: walking into the 6 nearest islands
  leaves 0 body samples inside solid cells.
- **Camera:** shoulder-height orbit, 5-ray pull-in against walls (instant in, smooth out),
  wheel / triggers / pinch zoom, figure hidden when the camera is squeezed in.
- **Input:** one `BINDINGS` table (keys, gamepad standard mapping, deadzones, sensitivities);
  keyboard, Gamepad API (hot-plug toast), touch joystick + drag-look + pinch (touch devices
  only). Gamepad also pans/orbits/zooms the map.
- **HUD:** mode hint, nearest street name (bounding-box heuristic over `features.json`), help
  overlay (H / Select).
- Integration: `main.js` `[player hook]` dynamic-imports `player/index.js`; the player's tick
  runs inside a wrapper around `stage.render`, after `controls.update()` and right before
  drawing, so the walk camera is never a frame late or overridden.
- Tests: 24 player tests (input 7, controller 10, camera/ray/streets/hash 7); viewer suite 90 green with the other tracks' tests.

**Open decisions**
- The contract character is 2 m wide with arms: it overlaps walls sideways and can't fit a
  door. Slim the model (pipeline) or accept it as the toy look?
- Water is walkable (solid). Needs a material query in the city API to swim/stop at banks.
- `ctx.city` should come from the core's `src/city.js` once it exists (the hook passes
  `window.__blox.city` for now).

## 2026-10-23: City life (phase 2, track L): timetable buses, pedestrians, boats

The city moves with zero servers: everything is baked by the pipeline and animated in the
browser from a clock. Guide: `docs/guide/05-movers-and-models.md` (City life).

- **Pipeline `blox life --out build/world`** (`pipeline/src/blox_pipeline/life/`) writes
  `life/index.json` + `transit.json`, `walkways.json`, `river.json`. The world manifest is not
  changed (no contract bump). `blox fetch --only gtfs` caches the OVapi national feed
  (`sources/config.py: GTFS_URL`) under `data/raw/gtfs/`, refetched after 7 days.
- **Transit:** bus routes within 500 m of the slice, one reference week (7 dates from `--date`,
  one per weekday, from calendar + calendar_dates), shapes densified <= 10 m, clipped, with the
  full shape's cumulative distance; stop times projected onto the shape. Trips sharing timing
  collapse into patterns; identical (pattern, start) rows of different services merge their day
  masks. A national-feed-like synthetic feed (45 routes, 55 000 trips a week) gives 0.85 MB.
- **Walkways:** OSM footways/pedestrian/path/living_street/steps, sidewalks (tagged, or assumed
  on untagged urban streets), squares as a 6 m lattice, dead ends snapped; spawn weights by kind
  and nearby shops.
- **Viewer `src/life/`:** clock (real Maastricht time or `#t=&day=&speed=`, 1x/10x/60x, coupled
  to the sun slider both ways); buses interpolated between stop times with dwell and
  after-midnight trips, posed with the shared PathMover rule in the right lane; LOD full model /
  box / hidden with caps; pedestrians random-walk the graph with rounded corners, palette
  colours, walk cycle, loose avoidance, step out of bus footprints, fewer at night; two boats
  loop the Maas. Every mover kind is one `InstancedModel` (crowd = 5 draw calls).
- **Fallback:** without an export the demo bus/boat stay and walkers use the world's paved cells
  (not under islands).
- Hook: `initLife(ctx)` returns `{ update(dt) }`, called by `main.js initHooks` in both the
  diorama and the streamed city. Ground from `city.groundHeight` (three.js z!) under
  `approxGround + 2.5 m`.
- Verified on `samples/markt_v3` with a synthetic export (two fake routes along real streets of
  the sample, walkways from its cobbled cells): diorama street/overview/dusk shots and the
  streamed site. Tests: pipeline +18 (`test_life_*.py`), viewer +24 (`test/life.*.test.mjs`).

**Open decisions**
- No real GTFS/OSM could be fetched here: real sizes, stop snapping and the assumed-sidewalk
  rule need a check on the workstation (`blox fetch --only gtfs,osm` then `blox life`).
- `build.mjs` (core) does not yet copy `<world>/life/` into the site (`<site>/world/life/`) or
  embed it in the diorama (`window.BLOX_WORLD.life`); `life/data.js` already looks in both places.
- Bus bodies take the nearest palette colour to the route colour; Arriva Limburg's real livery
  would need a palette entry.
- Walkers don't wait at crossings or stops, and buses don't yield to walkers (walkers are pushed
  aside). Trains (`--modes bus,rail`) are exported but would be drawn as buses.
- The river fallback line is approximate (only used without OSM).

## 2026-10-23: Streamed web city (phase 2, track S: streaming)

The viewer can now run the whole city in the browser: a static site streams chunks and islands
around the camera, and a pre-baked silhouette keeps all 2 km visible. Guide: 06 "Streamed city".

- **Site build:** `node build.mjs <world> --site <out>` (`scripts/site.sh` / `site.ps1`, default
  `build/world` -> `build/site`; they print how to serve locally and publish to GitHub Pages or any
  static host). World files are hard-linked (copied as fallback); `index.json` holds chunk boxes
  and island world boxes; `world/life/` is copied when the world has a life export (and embedded
  as `BLOX_WORLD.life` in embed mode; `BLOX_SITE.life` says whether it exists). The embed mode is
  unchanged (look-test chunk: same 380 draws / 4.89 M triangles).
- **Streaming:** `StreamScheduler` (nearest first, frustum priority, concurrency, abort, unload,
  retry, several eyes), `CityLoader` (fetch, Web Worker pool, query API), `CityView` (near / mid
  / baked rings). The mid look puts every opaque class in one material (per-vertex glow + shine),
  so a chunk is ~1 draw call. Workers: on the synthetic city the street view is ready 22 % sooner
  and the main thread stops hitching (per item 26-490 ms of work moved off it).
- **Query API** (`src/city.js`): `isSolid`, `isWater`, `groundHeight(x, z, fromY)` over chunks
  and islands, `'unknown'` where a chunk or an island overlapping it is not loaded; the diorama
  offers the same API. 1-bit solid maps (64 KB per real chunk).
- **Far bake** (`tools/bake-far.mjs`, `src/farbake.js`, format `BXF1`): 3 levels of coarse voxels
  (1 m / 2 m / 4 m), majority colours with top-face colours, flood-filled outside air, greedy
  quads per owner chunk so baked chunks hide as the real ones stream in. Synthetic city (8x8 Markt
  = 3136 chunks + 2560 islands): level 3 = 0.72 M triangles for everything, 93 s bake.
- **Map camera** (`src/citycam.js`): zoom to cursor from the whole city to street level, tilt
  allowance and preferred tilt follow the zoom (sky in frame near the ground), target on the
  ground, inside the city, camera never under bricks; fog, shadow box and AO follow the zoom.
  `street` preset looks for open ground and a free line of sight once the area is streamed.
- **Hooks:** `main.js initHooks(ctx)` holds `// [player hook]` and `// [life hook]`, called by both
  modes; missing modules are stubbed by an esbuild plugin.
- **Numbers** (headless SwiftShader, all passes): synthetic city overview 131 draws / 1.44 M
  triangles, silhouette 1-2 s, 9 MB; street level 464 / 8.3 M (was 28 M and 538 MB before the
  triangle budget and buffer release), 88 MB. `samples/markt_v3`: embed hero 362 / 3.49 M ready
  6.1 s, 162 MB -> site hero 320 / 2.66 M, silhouette 0.3 s, 24 MB. Tests: +19 (stream, city,
  farbake, citycam).
- Fixes found by screenshots: wrong winding on the mirrored region meshes, fog near > far at
  street level, baked tops coloured by the earth under the paving, the baseplate covering streets
  (now under the lowest brick), street preset on a roof.

**Open decisions**
- Not yet run on the real 4096-chunk city or on a laptop iGPU: the synthetic city is denser than
  Maastricht everywhere, so real numbers should be lower; measure with `scripts/site.sh` +
  `tools/perf.mjs` on the workstation.
- Street level on the dense synthetic city is ~4.7 M triangles per pass; medium AO adds a full
  geometry pass close up. `auto` steps down to low (no AO, 130 m stream radius) when slow.
- Baked levels 2/3 glow little at night: glass rarely wins a 2-4 m cell's vote.
- Life data fetch: `life/data.js` should skip fetching when `BLOX_SITE.life === false` or
  `BLOX_WORLD.life === null` (no 404 noise); that's in Track L's file.
- GitHub Pages limits (1 GB, 100 MB per file) fit the city (~100 MB in ~6,500 files).

## 2026-10-24: contract v4, the slice comes from the manifest

- The owner's street (Bosscherweg, RD 176197 319239) is 691 m north of the 2×2 km slice, and
  Sint-Pietersberg is south of it. New named slice **city**: origin RD (174700, 314000),
  128 × 176 chunks (4.1 × 5.6 km). Build it with `blox --slice city ...` or `BLOX_SLICE=city`.
- Contract v4: `originRD`/`chunksX`/`chunksY` in the manifest are authoritative. Pipeline
  (`geo.configure`), viewer (site index carries `originRD`; places are RD points in
  `viewer/src/places.js`) and Unity (`WorldSpec.FromManifest`) read them. Readers accept v1–v4.
- The OSM clip is per slice (`slice_clip_city.osm.pbf`), so switching slices never reuses the
  wrong clip.
- Owner photos of the Markt (2026-10-24): grey limestone and white/cream plaster facades, tall
  many-paned white windows, wrought-iron balconies, dark slate roofs with white dormers, dark
  cobbles, long rows of parked bikes under plane trees, double-lantern lamp posts, delivery vans.
  Notes are in `docs/reference/markt.md`.

## 2026-10-24: Life v2: a busy city and a new toy figure (phase 2, track L)

Owner feedback: the Markt is busier (bikes, people, buses, cars), Maastricht's buses are blue,
and the brick-built character was too blocky (a head of 2 bricks). Later photos: long rows of
parked bikes under the trees, delivery vans on the square, umbrellas in the rain, stall frames.

- **New figure** (`viewer/src/figure/`): an original smooth toy figure built in code (rounded
  boxes, capsules, lathe) in the city's glossy plastic: rounded-rectangle head on a neck, dot
  eyes and a smile, separate hair/hats (10 styles), shirts/jackets/coats/dresses, mitten hands,
  knees, shoes, backpacks/bags/umbrellas; adults 1.70-1.90 m with ~0.45 m shoulders, kids ~1.2 m,
  older people slower and stooped. Not a minifigure shape (no cylinder head/stud, trapezoid
  torso, C-hands, hip block). Poses: walk, run, idle, sit, cycle (leg IK on the pedals), browse.
  The player uses it too. Design sheets: `tools/figure-sheet.mjs` -> `build/shots/figures/`.
- **Rendering**: one InstancedMesh per part geometry, two LODs (detailed within 32 m, ~4.5k
  triangles; far ~1.5k). 1000 people = 12-15 draw calls far away, up to ~37 at street level
  (the < 30 target holds only when the nearest 160 are not all close; see open decisions).
  Posing uses in-place affine maths: ~4 ms per 1000 figures.
- **Busy city** (`life/density.js`): people 900/500/200 by tier, day curve, Saturday boost,
  quiet Sunday mornings; groups of 1-4 at the slowest pace, stops to chat; busiest nodes x1.6 by
  day and the market square x3 while it is on. Cafe **terraces** from OSM POIs (tables, chairs,
  parasols, people sitting and sipping), the **Wednesday/Friday market** (striped stalls in
  back-to-back rows, vendors, browsing shoppers, frames during setup/packing, parked delivery
  vans), **cyclists** on a cycle graph and **parked bike rows** (stations, squares, shops, and
  between the trees of tree lines), **cars and vans** on a directed road graph (right-hand
  traffic, one-way streets, IDM car following, slowing into junctions, no cars on pedestrian
  streets), **rain**: umbrellas and empty terraces (`#rain=1` until a weather source exists).
- **Buses blue**: `life/livery.js` colours buses by GTFS operator (Arriva `#0B5FA5`); route
  colours stay on the signs. Movers may use non-palette colours (skin/hair tones, cars,
  liveries); documented in the guide.
- **Pipeline**: `blox life` writes `streets.json` (cycle graph, road graph with one-way + class
  flags, terraces with the direction to the street, bike spots incl. tree rows, the market
  polygon + schedule); routes carry `agency`. `python -m blox_pipeline.life.sample` makes a
  synthetic export for `samples/markt_v3` (bus routes, walkways, streets, terraces at facades,
  tree rows) for screenshots without data hosts.
- Tests: `viewer/test/figure.test.mjs`, `life.traffic.test.mjs`, `pipeline/tests/test_life_streets.py`.
- Screenshots: `build/shots/figures/{sheet,poses,vehicles}.png`,
  `build/shots/life/{market_street,market_high,bus_terrace,bike_rows,overview,rain_market,thursday_high}.png`.

**Open decisions**
- Draw calls at street level are ~37 for people (24 detailed meshes: 10 hair styles, 4 tops,
  3 accessories, 7 body parts + 13 far meshes); getting under 30 needs `BatchedMesh` (several
  geometries per call) or fewer hair styles near the camera.
- Triangles: life adds 7-11 M per frame over all passes on the sample (shadow + AO + main);
  parked bikes (~400) are a big share. Next: a far bike/car LOD, no shadows for far figures.
- JS: a life step is 5-14 ms under headless software GL (~4 ms of it posing ~850 figures). Next:
  pose far figures every other frame.
- The synthetic sample's roads cross the Markt (picked on the top map); real OSM keeps cars off
  pedestrian squares. Not yet run on a real `blox life` export (data hosts blocked here).
- Bus model is still the brick bus (contract model); only its colour changed.

## 2026-10-24: Look v2: the old centre from the owner's Markt photos (track: look)

The owner's photos of the Markt (notes in `docs/reference/markt.md`; photos stay out of the repo)
showed a different city than our heuristics drew: blue-grey limestone and grey/white/cream
plaster under dark slate, tall many-paned white windows, iron balconies, white panelled doors,
dark wet cobbles, plane and chestnut trees, and the Stadhuis. What changed:

- **Contract (append-only, no `contractVersion` bump)**: palette v3 adds idx 47-53 `limestone`,
  `limestone_dark`, `plaster_white`, `plaster_cream`, `plaster_grey`, `cobble_dark`, `lead_grey`
  (slate a touch bluer); catalogue v3 adds ids 48-56 `window_1x2x4`, `shop_window_1x2x4`,
  `balcony_2x4`, `railing_1x2`, `pediment_1x4`, `lamp_double_1x3`, `bollard_1x1`, `chain_1x4`,
  `vent_1x2` (CONTRACT 2.1). They **reuse existing kinds** so Unity's catalogue parser still
  loads them; the viewer picks their geometry by name (`viewer/src/details-look.js`, far
  templates in `farmesh.js`). Unity's mesher draws them as the generic shape of their kind
  until it learns them (Unity is parked). `dotnet` catalogue count test 47 -> 56.
- **Old centre** (`voxelise/colours.py`): within 700 m of the Markt or the Vrijthof, or built
  before 1900: limestone/plaster walls (one in twelve dark red brick, no ochre), slate roofs
  (5 in 6). Elsewhere the era variety stays. Centre streets and squares are `cobble_dark` setts
  in four tones; a dark stone **kerb** (0.6 m, `limestone_dark`) runs outside every car road.
- **Facade grammar** (`facade/`): new `FacadeRun` fields (default off, so v2 houses are
  unchanged): `stone` dressings, `door` colour, tall `window_1x2x4`, stone shop fronts with
  `shop_window_1x2x4` between proud stone piers, flush stone jambs (only where >= 3 studs of
  wall remain), pediments over first-floor windows, wrought-iron `balcony_2x4` before a french
  window, `railing_1x2` french windows, cellar `vent_1x2` in the plinth, `pier` spacing. The
  old-centre style (`facade_style._centre_style`) turns them on for real buildings, plus white
  **dormers and a chimney on real pitched roofs** that fall toward the street
  (`facade_runs.roof_details`, painted in `facade_paint.dormer`).
- **Trees** (`voxelise/trees.py`): plane/chestnut style: a bare one-stud trunk of >= 4 m,
  branch stubs, a large crown of 4-6 overlapping blobs with paler autumn leaves; default
  height 8-15 m, crown up to 5.5 m (`TREE_MARGIN` 14).
- **Street props** (`voxelise/street_props.py`): double-lantern lamps along squares and
  pedestrian streets, bollard-chain-bollard groups along centre car streets, stone benches on
  squares; planned once per world from OSM, kept clear of buildings/islands/water/trees/decks,
  flat ground, never across a chunk border.
- **Stadhuis hero** (`facade/stadhuis.py`, `voxelise/heroes.py`, `Landmark.model`): the
  landmark match (BAG id, OSM `wikidata`, name "Stadhuis", or the Markt point; within 150 m of
  it) replaces the 3D BAG shape by a hand-authored model on its footprint: banded grey
  limestone, giant pilasters, cornices, the risalit with a 3-arch arcade on piers (balustrades
  in the arches), the double stair with stepped parapets, the full-width balustraded balcony,
  an attic storey with window pediments, a pediment with a carved relief and corner
  cartouches, side pediments, iron railings with gilt tips and gate piers, a hipped slate
  roof with lead hips, and the lead-grey tower (square base with a dormer, oculi row, tall
  arched windows, clock stage with gold dials, gallery with balustrade and flags, open belfry
  with bells, bell-shaped dome, lantern, gilded orb and vane). On the grid or as an island
  (CONTRACT 5.1) as its footprint dictates; the front faces the side with most square.
- **Look test** (`testscene`): now two chunks; chunk 23,47 is a photo-like Markt row (5
  houses, every new piece, plane trees, lamps, bollards, benches). New synthetic
  `pipeline/tests/markt_fixture.py` (Stadhuis + square + terraces + tree row + streets) runs
  the real data path; `test_look_v2.py` covers it (also the Stadhuis as an island at 12°).
- Committed `tests/fixtures/town_world` regenerated (`BLOX_REGEN_FIXTURES=1`): new palette and
  catalogue copies, old-centre facades.
- Screenshots: `build/shots/look_v2/` (before/after pairs, Stadhuis front/SW/tower, gallery).

**Open decisions**
- Unity: add the 9 pieces to `DetailMesher` (now the generic shape of their kind).
- Real data not rebuilt here (data hosts blocked): the owner must rebuild the city
  (`blox build`) to see it; the Stadhuis match there is by name/point (no BAG id or wikidata
  id set yet: add them to `landmarks.py` once checked on the real data).
- Lamps' glass does not glow at night (glow is for window/door kinds only).
- Bench and chain heights are fixed; street props on slopes > 1 plate are skipped.

## 2026-10-24: Open-world camera (phase 2, track P)

Owner feedback after playing on Windows: "just need to make rotating the camera easier, I want
it to feel like an open world environment."

**What changed** (`viewer/src/player/`, guide `docs/guide/09-player.md`)
- Walk mode: click the world to capture the mouse (Pointer Lock, raw input where supported);
  mouse movement turns the camera with no button held. Yaw unlimited (wrapped), pitch −35°..70°.
  Esc frees the mouse, Esc with a free mouse (or H, gamepad Start/Select) opens the menu, M (or
  B) goes back to the map. This is the usual open-world split (Esc = pause menu, M = map) and
  fits the browser rule that Esc always releases a pointer lock; the Esc press that released
  the lock is swallowed so it does not also open the menu.
- Camera rotation and zoom go through a critically damped spring (aim -> shown values), so
  pointer-lock deltas, stick and touch input are smooth and overshoot-free at any frame rate;
  collision pull-in runs on the damped values as before.
- Movement stays camera-relative (shared `look.js moveHeading`); the figure turns with a
  frame-rate independent exponential (10 /s).
- Auto-recenter: after 2 s without look input while walking forward-ish, the camera eases
  behind the figure (gentle, faded in; never when walking toward the camera or sideways).
- Gamepad right stick: response curve |v|^1.8, 3.2 rad/s yaw, +70% turn boost after holding
  full tilt for 0.25 s; own sensitivity and invert Y.
- Menu has camera settings (mouse/touch sensitivity, invert Y, controller sensitivity, invert
  Y, auto-recenter) saved in `localStorage` with try/catch fallbacks (`settings.js`).
- Map mode (`maporbit.js`): Ctrl/Alt + left drag orbits, middle drag tilts, Q/E and the right
  stick turn through a damped spin (smooth start/stop); a compass (bottom right, both modes)
  shows north and turns the view north on click.
- New `test/player-look.test.mjs` (11 tests); input/camera tests updated and extended
  (bindings `exit` -> `map` + `menu`, pointer-lock spike filter, sensitivity/invert, damped turn
  at 60 and 10 fps, pull-in on damped values).

**Open decisions**
- Pointer lock is not testable in headless Chromium; the owner should try it on Windows
  (Chrome/Edge) and tune the default mouse sensitivity (0.003 rad/px × 1.0) if needed.
- `citycam.js` is unchanged: the map extras live in the player track so the diorama (plain
  MapControls) gets them too.
- Rotation smoothing (0.05 s) is light on purpose; if anyone wants raw, unsmoothed mouse look,
  add a "smoothing" slider.

## 2026-10-24: buildings survive a 3D BAG outage

The city fetch on the workstation stopped at 3D BAG: `api.3dbag.nl` timed out, and the whole
`3dbag.nl` domain (site and docs) did not resolve from an independent network either, so this
was an outage on their side. Because `fetch_all` stopped at the first failure, OSM was never
fetched either.
- `fetch_all` now runs every requested source and raises one `DownloadError` listing the
  failures at the end.
- New `sources/osm_buildings.py`: OSM footprints plus AHN DTM/DSM give synthetic buildings
  (gabled or flat) wherever 3D BAG has no building. `load_all` uses them, and also when no 3D
  BAG data is cached at all.
- Verified on the town fixture with the 3D BAG tile hidden and its roofs burned into the DSM:
  9/9 buildings, 2 islands, 100% facade runs, and the gables look right (screenshot reviewed).
- Tests: `test_sources_osm_buildings.py` (gable axis, flat roof, covered footprints skipped,
  fetch continues past a failure).

**Open decisions**
- Fallback houses have no construction year, so they get the default colour mix. If 3D BAG
  comes back before launch, refetch (`blox --slice city fetch --only bag3d`) and rebuild for
  the real roofs.
- `load_buildings` now finds cached 3D BAG block dirs by area (`cached_blocks`), not by
  recomputing the block grid. The centre slice (origin 175700) and the city slice (origin
  174700) use different 256 m grids, so the city build ignored the centre pages already
  fetched. Now the centre keeps its real 3D BAG roofs and only the rest uses the fallback.

## 2026-10-24: two city-build crashes fixed

The first full `--slice city` build exposed two bugs the 2×2 km centre never hit.
- `blox build` failed with "placed pieces rejected: 1 placed pieces outside the tile". A facade
  piece reached past the tile's k range, which comes only from terrain, building tops, trees,
  heroes and props. `TileCanvas.place` now gives such a piece a voxel stand-in, the same as a
  piece straddling a chunk border, instead of emitting it.
- `blox life` failed with an IndexError in `_snap_dead_ends`. Splitting an edge added a node
  that a later dead end reached through the neighbour map, but the point array was a snapshot.
  The array now grows with each split.
- Regression tests: `test_canvas_stands_in_for_pieces_above_the_tile` and
  `test_snap_reaches_nodes_split_earlier_in_the_same_pass`.

## 2026-10-26: launch: audit, licence, publish script

- The city slice built on the workstation: 22,355 chunks, 8,050 islands, 30,807 features in
  2 h 20 min; the site is 265 MB in ~30,400 files.
- Hosting: the code repo `Tadiwa-M/Maastricht-blox` (public, for the owner's CV) plus a separate
  site repo `Tadiwa-M/Maastricht_larper` on GitHub Pages. Cloudflare Pages was ruled out because
  its free plan caps a site at 20,000 files.
- New `scripts/publish.ps1` / `publish.sh`: copy the site, add `.nojekyll` and a README, and
  force-push one commit, so the site repo never accumulates builds. Tested against a local bare
  repo (two publishes leave one commit). The site was verified under a sub-path, since all URLs
  are relative.
- Public-repo audit: no keys or tokens in the history, no images ever committed (the owner's
  Markt photos never were), no blobs over 2 MB, the "not affiliated" line present. One commit
  carries the owner's university email as its author; it's left as is, because rewriting public
  history isn't worth it. A GitHub noreply address is suggested for new commits.
- Added an MIT `LICENSE`, and rewrote `README.md` for the launch (play link, what it is, how it
  works, how to build).

**Open decisions**
- Laptop performance on the full city is not measured yet; the far L1 bake is 24.5 M triangles.
  If the overview stutters, cap the L1 distance in the viewer (no rebuild needed).
