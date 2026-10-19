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
