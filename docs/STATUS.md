# Maastricht Blox: status (updated 2026-10-19)

**New here?** Start with [docs/README.md](README.md) (reading order), then
[ARCHITECTURE.md](ARCHITECTURE.md) and the guides in [guide/](guide/). What changed and why
is in [DEVLOG.md](DEVLOG.md).

**Current test counts (2026-10-19, `scripts/check.sh`):**

| Suite | Result |
|---|---|
| Pipeline (`cd pipeline && uv run pytest`) | `208 passed in 9.78s` |
| Proxy (`cd proxy && uv run pytest`) | `70 passed, 1 warning in 0.99s` |
| dotnet core (`dotnet test dotnet/Blox.sln`) | `Passed!  - Failed:     0, Passed:   319, Skipped:     0, Total:   319` |
| LookTests (`dotnet test unity/Assets/Blox/Editor/PureTests~/Blox.LookTests.csproj`) | `Passed!  - Failed:     0, Passed:    67, Skipped:     0, Total:    67` |
| Viewer (`cd viewer && npm test`) | `# tests 24  # pass 24  # fail 0` |

Section 2 below keeps the 2026-10-17 (v1) numbers for history.

Everything below was built and tested in a cloud container that **blocks every real data
host** (PDOK, 3D BAG, Geofabrik, OVapi, Buienradar, Rijkswaterstaat, NS, adsb.lol) and has
**no Unity**. So: all code is written against the real APIs and formats, and tested with
hand-built fixtures that follow those formats. Nothing has run on live data or in the Unity
editor yet. The first real run on your PC is the actual integration test.

## v2 update (2026-10-19): custom detail pieces, facing, brick models, look fixes

Sections 1 to 5 below describe v1 (2026-10-17). This section covers what contract v2 added
and how it was checked across the three renderers.

**What v2 added, in one place each**

| Idea | Where to read it | Python | three.js viewer | Unity C# |
|---|---|---|---|---|
| Facing rule: say N/E/S/W, never raw `rot`; front faces +j at rot 0 | CONTRACT 2 | `pipeline/src/blox_pipeline/rotation.py` | `viewer/src/rotation.js` | `Runtime/Data/Geometry/Rotation.cs` |
| Detail pieces 38-47 (arch, window, door, fence, round tile, jumper, slope30, grille) | CONTRACT 2.1 | placed by `facade/` via `Canvas.place` | `viewer/src/details.js` | `Runtime/Meshing/Core/Detail*.cs` |
| `hide_studs` flag (rotFlags bit 3) | CONTRACT 4 | set in `layout/studs.py` | `viewer/src/bricks.js` | `Meshing/Core/StudExtractor.cs` |
| Brick models (bus, boat, character) and movers | CONTRACT 7.1 | written by `blox_pipeline.models` to `contract/models/` | `viewer/src/models.js`, `mover.js`, `demo.js` | `Data/Models/`, `Data/Motion/`, `Gameplay/` |

**Cross-language checks (all passing)**
- Every language runs `contract/test_vectors/rotation.json` (pytest `test_rotation.py`,
  viewer `rotation.test.mjs`, dotnet `RotationTests.cs`).
- Orientation in the look-test scene: every window, door, arch and fence on a street front is
  stored facing `S`, with air in front (or a flower box) and wall behind; the west side
  windows face `W`. The facade screenshot shows the decorated side toward the street.
- Studs: the pipeline sets `hide_studs` on 72 of 4,245 bricks; the C# mesher and the viewer
  both end up with **967** exposed studs on the look-test chunk (the viewer then drops more
  with its outside-air flood fill: 824).
- Models: `contract/models/*.json` load in C# (`BrickModelTests.cs`) and in the viewer
  (`viewer/test/models.test.mjs` checks parts, size and pivot for each model).

**Test runs (2026-10-19)**: pipeline `208 passed`; proxy `70 passed, 1 warning`;
dotnet core `Passed: 319`; LookTests `Passed: 67`; viewer `# pass 24  # fail 0`.

**Open contract questions** (raised by the tracks, not yet decided; full list with details in
[DEVLOG.md](DEVLOG.md#open-decisions--next-steps)): arch opening shape (renderers use a
half-ellipse under a lintel), boat pivot on the waterline instead of the ground, the sign of
part rotation angles, which cells the jumper's centred stud needs free, `slope30_1x2` as
`studs: none`, window/door bar depth and what is behind the panes, and no separate water
material class (the viewer matches `water*` names).

**Still open after v2:** nothing has run in Unity; real map data still paints glass cells
instead of placed windows and doors; no component spawns live buses in Unity yet
(`LiveClient.SamplePoses()` is ready); `MapCameraRig` doesn't use `WorldRaycast` yet; the viewer's
outside-air flood fill switches off above 64 M cells (every stud is drawn then).

## 1. What exists

| Part | Where | What it does |
|---|---|---|
| Contract | `CONTRACT.md`, `contract/*.json` | Coordinates, chunk format, manifest, features, proxy API (v1, unchanged) |
| Data-source research | `docs/DATA_SOURCES.md` | Endpoints, licences, gotchas, hostname allowlist; UNVERIFIED items marked |
| Pipeline: sources + voxeliser | `pipeline/src/blox_pipeline/{geo,sources,voxelise,cli}` | `blox fetch` (AHN, 3D BAG, OSM, optional aerial), `blox build` (voxel tiles per chunk) |
| Pipeline: layout + IO + preview | `pipeline/src/blox_pipeline/{layout,io,preview,testscene}` | Voxels to bricks (slopes, ridges, staggered bond), `.bxc` writer/reader, manifest, `preview.png`, look-test scene |
| Live proxy | `proxy/` | FastAPI on `127.0.0.1:8787`: `/v1/health, vehicles, shapes, stops, weather, water` |
| Unity data/meshing/live | `unity/Assets/Blox/Runtime/{Data,Meshing,Live}` | Chunk reader, world index, raycast, Burst mesher with HLOD, stud instances, proxy client and vehicle interpolation |
| Unity rendering/gameplay/editor | `unity/Assets/Blox/{Runtime/Rendering,Runtime/Gameplay,Shaders,Editor}` | URP setup menu, brick/stud/water/glass shaders, GPU stud culling, world streaming, time of day, camera rig, look-test scene menu |
| .NET test harness | `dotnet/`, `unity/Assets/Blox/Editor/PureTests~/` | Compiles the engine-free C# and tests it without Unity |

## 2. What is verified (test runs on 2026-10-17, in this container)

| Suite | Command | Result |
|---|---|---|
| Pipeline (Python) | `cd pipeline && uv run pytest` | `110 passed` |
| Proxy (Python) | `cd proxy && uv run pytest` | `67 passed, 1 warning` (Starlette deprecation, harmless) |
| Unity data/meshing/live (C#) | `dotnet test dotnet/Blox.sln` | `Failed: 0, Passed: 254, Skipped: 0, Total: 254` |
| Rendering engine-free logic (C#) | `dotnet test unity/Assets/Blox/Editor/PureTests~/Blox.LookTests.csproj` | `Failed: 0, Passed: 57, Skipped: 0, Total: 57` |

Cross-component checks that these suites now cover:
- **Python writer and C# reader agree on the chunk format.** The C# tests read the pipeline's golden files
  (`pipeline/tests/fixtures/golden/`), match every record in `golden.json`, and re-encode the
  uncompressed body byte for byte. The pipeline test re-generates the golden files and
  checks that the bytes are identical.
- **The full `blox build` chain on fixture data.** The inputs are a GeoTIFF DTM/DSM, a 3D BAG
  page with a gabled LoD2.2 building, and an OSM PBF with a road and water. The chain runs
  with the real layout, writer and preview, and B2's verifier finds 0 problems on every chunk.
  The gabled roof comes out as slope and ridge bricks.
- **Pipeline output loads and meshes in C#.** Run the C# mesher on any world folder with
  `BLOX_WORLD_DIR=<dir> dotnet test dotnet/Blox.sln --filter TestsceneChunksLoadAndMesh`
  (the default folder is `build/testscene`). On the fixture world, 6 chunks passed the sha1 check and meshed
  (e.g. the building chunk: 1075 bricks, 13564 vertices).
- **Proxy output parses in the Unity client.** The proxy's end-to-end test writes its real
  responses to `proxy/tests/fixtures/api_samples/`. A C# test parses them with `LiveJson`
  and checks that each bus sits on its shape at `distAlongShapeM` (within 15 m).
- **Unity C# is consistent between the data/meshing code and the rendering code (static review).**
  - Namespaces and asmdef references fit together, and Data/Gameplay do not depend on Rendering.
  - The vertex layout matches the shader input: Position, Normal, Color f32x4, and UV0/UV1/UV2 f32x2 (64 bytes).
  - `StudInstance` (8 floats, 32 bytes) matches both `BloxStudInstance` and the StudCull struct.
  - The MaterialClass numbers 0..4 match `BLOX_CLASS_*`.
  - The `_BloxStudTops` index and packing match `StudTopsLayout`.
  - Brick variation is baked into vertex colour, UV2.y and the stud angle, so no shader needs a copy of the hash.
- **Shaders.** Agent E compiled them with DXC against the URP 17.0.4 sources: 138 variants
  compiled and 20 failed. The 20 failures are all `INSTANCING_ON` / `DOTS_INSTANCING_ON`
  variants, and Unity's own Lit.shader fails the same way outside Unity. These need Unity's compiler to check.

Rendered look test: `build/testscene/preview.png` and `preview_iso.png` come from
`uv run python -m blox_pipeline.testscene`.

## 3. Not verified (needs your PC)

- **Live endpoints.** No data host was reachable from here. See `docs/DATA_SOURCES.md` for
  every UNVERIFIED item. The riskiest ones:
  - **AHN.** The pipeline asks the PDOK WCS (`service.pdok.nl/rws/ahn/wcs/v1_0`), but the
    research suggests that route may be gone. A local-tiles fallback now exists (section 5, step 2).
  - **3D BAG API.** It is unconfirmed whether it accepts `bbox` in RD with `limit`. A local-tiles fallback exists for this too.
  - **RWS station code for Maastricht.** Look it up with `uv run blox-proxy-rws-locations`, then set `BLOX_RWS_LOCATION`.
  - **OVapi.** Unconfirmed whether Arriva Limburg buses appear in the feed, and the format of its vehicle ids.
  - **NS response format.** Only matters if you set `NS_API_KEY`.
- **Everything inside Unity.** None of these have run: the editor menus, EditMode tests,
  Burst jobs, `Mesh.MeshDataArray`, GPU stud culling, shader look, frame time, or input.
  Some settings are applied by reflection or serialized field name and log a warning if they fail:
  - the URP renderer factory;
  - the SSAO fields;
  - BatchRendererGroup variants;
  - the input backend.
- **Real-data scale.** Pipeline time and memory for the full 2 × 2 km slice are unknown.
  The synthetic estimate is about 9 min of voxelising plus layout time.

## 4. Known issues and gaps

1. **No vehicles are drawn in Unity yet.** `Blox.Live` (client, registry, interpolation) is
   done and tested, but no MonoBehaviour spawns bus or train meshes from `VehicleRegistry`.
2. **No in-game credits screen or UI yet.** CONTRACT section 9 requires one. The credits are in `README.md`.
3. **Camera picking uses a flat ground plane.** `WorldRaycast` (Blox.Data) exists but the rig doesn't use it yet.
4. **Studs are culled against the main camera only,** so the Scene view shows the main camera's set.
   The `World` GameObject must stay at the origin.
5. **Building geometry limits.**
   - Buildings are one top surface per column: no overhangs or passages.
   - Bridges are straight decks with no arches or piers.
   - Round bricks are never placed.
6. **Bus lag.** OVapi positions are about 60 s old, and the contract renders at now − 60 s,
   so buses show about 2 min behind reality.
7. **Data that can't be matched or measured directly.**
   - `stop` features carry OSM `ref` / `ref:IFOPT`, not a GTFS `stop_id`, so stops are matched by name or position on the game side.
   - `cloudPct` is estimated from the Buienradar condition.
8. **Wall bricks are small.** On facades with windows every 2–3 studs, wall pieces between
   windows are mostly 1×1 / 1×2 bricks. That is correct but makes many bricks.

### Contract clarifications to adopt in a v2 (not applied; CONTRACT.md is unchanged)
- **Slope encoding (section 7).**
  - A slope or ridge is a vertical stack of 3 cells.
  - The studded back row is a full cell stack of the same colour and feature directly behind it.
  - Slope geometry: 1-plate front lip, slope45 rises 2 plates over 1 stud, slope33 rises 2 plates over 2 studs.
- **Features and tiles (sections 6 and 7).**
  - `bboxIJ` is inclusive.
  - `centroid` is a cell inside the feature.
  - The 1-cell tile rim is context only.
- **`maxK` (section 4).** It is clamped to 65535 and cells above K = 65532 are dropped.
- **Glass and water.**
  - Glass doesn't hide what's behind it when culling, like water.
  - Water cells with a non-transparent colour are written as `water`.
- **Proxy (section 8).**
  - Health source names: `ovapi`, `ovapi_static`, `buienradar`, `rws`, `ns`.
  - `mode` is one of `bus | tram | rail | metro | ferry | other`. The GTFS route types for gondola and funicular currently produce `gondola` / `funicular` as well.
  - Empty responses before the first data arrives: `/v1/vehicles` returns an empty list, and `/v1/weather` and `/v1/water` return 503.
  - Shapes are clipped to the slice + 500 m.
- **Section 9 licences.**
  - AHN5/AHN6 are CC BY 4.0 ("AHN.nl"). Only AHN4 on PDOK is CC0.
  - Add PDOK aerial (CC BY, Beeldmateriaal Nederland), NS and KNMI (if used), and adsb.lol (ODbL).
  - Buienradar is non-commercial only.
- **Vrijthof reference.** It maps to Unity world (485, 1217), not (242.5, 608.5).

## 5. Next steps on your Windows PC

Prerequisites: [uv](https://docs.astral.sh/uv/), Git, Unity Hub with **Unity 6000.0 LTS**
(Windows Build Support), and optionally the .NET 8 SDK for the C# tests.

1. **Tests (5 min):**
   ```
   cd pipeline && uv sync && uv run pytest
   cd ..\proxy && uv sync && uv run pytest
   cd .. && dotnet test dotnet\Blox.sln
   ```
2. **Download the data.** Allow several GB of disk; you can start with a small bbox.
   ```
   cd pipeline
   uv run blox fetch --bbox 176000,317500,176500,318000
   ```
   - **If AHN fails** (the WCS has gone): download the 0.5 m DTM sheet(s) covering
     RD 175700,316500 – 177748,318548. Find the sheet in the coverage index
     `https://basisdata.nl/hwh-ahn/AUX/bladwijzer/index.html`. Files follow the pattern
     `https://basisdata.nl/hwh-ahn/AHN5/02a_DTM_50cm/<year>_M_<sheet>.TIF`.
     Put them in `data\raw\ahn\tiles\dtm\`, and DSM sheets (optional) in `data\raw\ahn\tiles\dsm\`.
     Re-run the fetch; it then skips the WCS.
   - **If 3D BAG fails:** open `https://data.3dbag.nl/latest/tile_index.fgb` in QGIS. Download
     the `cj_download` CityJSON tiles over the slice into `data\raw\3dbag\tiles\`, then re-run.
   - If a URL in `pipeline/src/blox_pipeline/sources/config.py` is wrong, fix it there; all endpoints are in that one file.
   - Then `uv run blox fetch` for the whole slice (optionally `--only ortho` for aerial colours).
3. **Build:**
   - Small area first:
     `uv run blox build --bbox 176000,317500,176500,318000 --out ..\build\world`
   - Check `build\world\preview.png`. Optionally check the C# side with
     `set BLOX_WORLD_DIR=<repo>\build\world` and
     `dotnet test dotnet\Blox.sln --filter TestsceneChunksLoadAndMesh`.
   - Then build the full slice: `uv run blox build --out ..\build\world`.
4. **Look test in Unity:**
   1. `uv run python -m blox_pipeline.testscene` (writes `build\testscene`).
   2. Open `unity\` in Unity 6000.0 LTS and accept the package version updates.
   3. Run **Blox → Setup Project**, then **Blox → Create Look Test Scene**, then press Play.
   4. Run the EditMode tests (Window → General → Test Runner).
   5. Check the Console for "Blox:" warnings from the reflection-based settings.
   6. Tune the look with the parameters listed in `unity\README.md`.
5. **Point the game at the real world:** on the `World` object, set `WorldLoader.worldDirectory` to `../build/world`.
6. **Live data:**
   1. `cd proxy && uv run blox-proxy`. The first start filters the 240 MB GTFS file, which takes several minutes.
   2. Run `uv run blox-proxy-rws-locations` to find the Maastricht code and set `BLOX_RWS_LOCATION`.
   3. Check `http://127.0.0.1:8787/v1/health`.
   4. In Unity Player Settings, enable "Allow downloads over HTTP".
7. **Still to build:** vehicle rendering from `VehicleRegistry`, an in-game credits screen,
   brick-accurate picking with `WorldRaycast`, and a feature search UI.

## Review (skeptical pass against CONTRACT.md)

Scope: chunk format (both sides), coordinate and rotation/slope conventions, brick layout,
proxy motion/matching and upstream politeness, Unity 6 URP API use, shader passes.
Nothing here ran against live hosts or inside Unity.

### Checked and found consistent
- `.bxc` header (`<4sHHiiIHHII`, 32 B) and 12-byte record agree byte for byte between
  `pipeline/src/blox_pipeline/io/format.py` and `Runtime/Data/Chunks/*.cs`. Both use raw DEFLATE
  with wbits -15 and `DeflateStream`, sort by (k, j, i), compute maxK the same way, and check borders.
- Rotation: clockwise from above (+j -> +i) and the slope low edge (rot 0..3 -> +j, +i, -j, -i)
  match in `Footprint.cs`, `layout/slopes.py`, `layout/verify.py` and `BrickProfile.cs`.
  Studded back rows lie at -j at rot 0. Roof planes get their shape from the upward normal's
  horizontal part, so a roof is low on the side its normal points to.
- RD -> grid -> Unity conversions are the same in `pipeline/geo.py`, `proxy/geo.py` and `WorldSpec.cs`.
- Layout fuzz test: 60 random tiles (slopes, ridges, tiles, water, chunk-border tiles with a
  1-cell rim, odd-sized tiles) through `layout_tile` + `verify_layout` gave 0 problems: no gaps,
  no overlaps, no border crossings, hollow rule held.
- Shaders: BrickBody and Stud have ForwardLit, ShadowCaster, DepthOnly and DepthNormals. URP SSAO
  in DepthNormals mode and shadows have every pass they need.

### Fixes in this pass
1. `proxy/src/blox_proxy/service.py` (`vehicles_payload`): `/v1/vehicles` `ts` was the
   upstream feed header time. That time is 0 before the first fetch and stays frozen through
   304 polls, so Unity's `LiveClock` jumped about 1.7e9 s at startup and then converged
   slowly (minutes). Afterwards it sawtoothed by up to 20 s, which made vehicles snap
   backwards. `ts` is now the proxy clock at response time. Tests updated and added in `tests/test_api.py`.
2. `unity/Assets/Blox/Runtime/Live/VehicleRegistry.cs` (`LiveClock`): ignores `ts <= 0`.
   It snaps the offset when the error is over 5 s (no slow convergence after a proxy restart).
   `Now()` never steps back by less than 5 s, so smoothing corrections don't drag vehicles
   backwards. Tests are in `dotnet/Blox.Tests/LiveTests.cs`.
3. `proxy/src/blox_proxy/matching.py`: each poll rebuilds vehicles from the same observation
   (on a 304, or when a vehicle hasn't reported again). It was re-matched with dt = 0, which
   dropped the speed estimate to null on every other poll. Repeated reports now return the
   cached match. Test in `tests/test_matching.py`.
4. `proxy/src/blox_proxy/sources/buienradar.py`: the live feed's night icons use doubled
   letters (`cc.png`), and the icon regex only accepted `<x>n.png`, so night conditions fell back
   to the Dutch description. Both forms are now accepted. Tests in `tests/test_buienradar.py`.

### Remaining risks (not fixed: unconfirmable here)
- **RWS station:** the default `BLOX_RWS_LOCATION` (`maastricht.borgharen.maas.beneden`) is
  *below* the Borgharen weir, several metres lower than the Maastricht pool. It is also served
  under the label "Maastricht Sint Pieter". Resolve the Sint Pieter code before trusting `levelMNap`.
- **StudRenderer args buffer:** it is created as `IndirectArguments | Raw` with a 20-byte stride.
  Some platforms want raw buffers to have a 4-byte stride (count 5). If Unity logs a stride
  error, switch to `(Target.IndirectArguments | Target.Raw, 5, sizeof(uint))` and `SetData(uint[5])`.
- **Stud shader:** it indexes `_StudInstances` with raw `SV_InstanceID`, not
  `GetIndirectInstanceID`. That is correct only while `startInstance == 0`, which holds today.
- **GPU Resident Drawer / DOTS instancing:** BrickBody includes `DOTS.hlsl` but declares no
  DOTS instanced properties. It compiles, but per-material overrides won't work under BRG.
- **Hollow culling across hidden cells:** the mesher treats missing (culled) neighbour cells as air.
  It therefore emits faces against hidden interior and deep-ground cells that nobody sees.
  This costs triangles only and doesn't affect correctness.
- **Proxy `step_gtfs_rt`:** a failure fetching trip updates aborts the whole step, so vehicles
  aren't rebuilt that cycle (they recover on the next poll).
- **Shapes clipping:** shapes clipped to the live bbox keep full-shape `cumDistM`. A shape
  that leaves and re-enters the area interpolates straight across the gap.
- All Unity compile and runtime behaviour is still unverified. The Editor setup uses
  reflection/serialized names for internal URP settings (SSAO feature, soft-shadow quality,
  BRG stripping) and logs a "Blox setup:" warning for every name it can't find.
