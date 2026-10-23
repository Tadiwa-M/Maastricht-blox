# 07: Unity project

Folder: `unity/` (Unity 6 LTS, URP 17.0.4, Burst, Collections, Input System). Runtime code is
under `unity/Assets/Blox/`. **Nothing here has run in a Unity editor yet**: Unity isn't
installed in the build container. The engine-free parts are compiled and tested with .NET 8
(see below). First-run steps on Windows are in `unity/README.md`.

## Assemblies and folders

| Assembly | Folder | What | Engine-free? |
|---|---|---|---|
| `Blox.Data` | `Runtime/Data/` | contract formats (chunks, v3 islands), `WorldIndex`, `IslandIndex`, `IslandPose`, `WorldRaycast`, `Rotation`, `Pose`, `PathMover`, `BrickModel`, `BrickVariation`, JSON parser | yes, all |
| `Blox.Meshing` | `Runtime/Meshing/Core/` + `Unity/` | chunk mesher, HLOD, studs, detail pieces, model meshes; Burst job wrappers | `Core/` yes |
| `Blox.Rendering` | `Runtime/Rendering/` | `WorldLoader` streaming, `ChunkRenderer`, `StudRenderer`, time of day, shadow range | `Core/` maths yes |
| `Blox.Live` | `Runtime/Live/` | proxy DTOs, JSON, `VehicleTrack`, `VehicleRegistry`; `Unity/LiveClient.cs` does HTTP | all but `Unity/` |
| `Blox.Gameplay` | `Runtime/Gameplay/` | `MapCameraRig`, `BrickModelRenderer`, `PathFollower`, `CharacterWalker` | `Core/` yes |
| `Blox.Editor` | `Editor/` | `Blox/Setup Project`, `Blox/Create Look Test Scene` | no |
| shaders | `Shaders/` | `BrickBody`, `BrickTransparent`, `Stud`, `StudCull.compute`, `Include/*.hlsl` | n/a |

Module READMEs with more detail: `Runtime/Data/README.md`, `Runtime/Meshing/README.md`,
`Runtime/Live/README.md`, `Runtime/Gameplay/README.md`.

## From files to pixels

```
WorldLoader (Rendering, MonoBehaviour, implements IWorldSource)
  WorldFiles.Open(dir)                -> WorldIndex (manifest, palette, catalogue, features)
  ChunkLodPlanner + ChunkLodPolicy    -> per chunk: full (<260 m), HLOD x2 (<600), x4 (<1200), x8; 10 % hysteresis
  WorldIndex.Load(coord)              -> ChunkReader -> ChunkData (+ its 8 neighbours for border culling)
  ChunkMeshBuilder.Schedule(coord)    -> Burst job: CellGrid.Fill -> ChunkMesherCore.Build
        BrickBodyMesher   profile bricks (bricks, plates, tiles, slopes with 0.05 m lip)
        RoundMesher       round bricks, round tiles (12-sided)
        DetailMesher      pieces 38-47 (DetailParts, DetailShapes)
        StudExtractor     exposed studs -> StudInstance list (skips hide_studs records)
  ChunkMeshResult -> ChunkRenderer (2 submeshes: 0 opaque, 1 trans/glass)
                  -> StudRenderer (GPU cull, 2 indirect draws: near 16-seg < 45 m, mid 8-seg < 130 m)
                  -> StudTopsBuffer (far: BrickBody fakes studs where a real one sits)
  for each island owned by that chunk (v3), at the chunk's level:
  WorldIndex.LoadIsland(id)           -> IslandReader -> IslandIndex (pose, occupancy within the island)
  ChunkMeshBuilder.ScheduleIsland     -> Burst job: IslandMesherCore (chunk mesher on the island grid)
  -> GameObject "island_000123" at (originX, 0, originZ), rotation Euler(0, yawDeg, 0)
  -> StudRenderer.SetIsland (studs already turned into world space)
```

Mesh positions are chunk-local in x/z and absolute in y. Place the chunk object at
`(spec.ChunkOriginX(c), 0, spec.ChunkOriginZ(c))`.

### Islands: rotated buildings (CONTRACT 5.1, v3)

Most Maastricht streets are not on the world grid, and a wall at 20 degrees rasterised onto it
is a staircase that can't hold windows. The pipeline therefore builds such buildings (or a
terrace of touching buildings sharing an angle) on their **own grid turned to the main wall**
and writes them as islands (`islands/i_{id:06d}.bxi`). Unity's side:

- **Reading.** `IslandReader` (40-byte header + the normal record body, i/j local 0..255, k
  global). `Manifest.Islands` lists them (manifest `contractVersion` 1..3 accepted).
  `WorldIndex.IslandsOwnedBy(chunk)` / `LoadIsland(id)` give an `IslandIndex`: pose plus a
  per-island occupancy, because stud exposure and face culling are computed within the island.
- **Pose.** `IslandPose.LocalToWorld(u, v)`: `x = ox + u cos + v sin`, `z = oz - u sin + v cos`.
  Unity is left-handed, Y up, +Z north, +X east, and a positive Y rotation turns +Z toward +X,
  i.e. clockwise seen from above, the same sense as the contract's yaw. So the GameObject gets
  `Quaternion.Euler(0, yawDeg, 0)` with **no sign flip** (`ChunkMeshBuilder.IslandTransform`).
  `IslandPose.UnityEulerY` spells out Unity's rotation and the tests check it against
  `contract/test_vectors/islands.json`.
- **Tested against the pipeline.** `IslandTests` reads the committed pipeline-built town world
  (`pipeline/tests/fixtures/town_world`, or any world via `BLOX_ISLAND_WORLD_DIR`): every island
  loads, meshes, has an existing owning chunk, and, placed by `IslandPose`, sits on the paving
  the pipeline left in the chunks (>90 % of interior columns; with the yaw sign flipped it is
  1-12 %), with its plinth reaching the chunk ground. That pins yaw sign and origin end to end.
- **Meshing.** `IslandMesherCore` runs the unchanged chunk mesher with the island grid as its
  world (origin 0, no neighbours): one mesh per island in local metres.
- **Streaming/LOD.** An island follows its owning chunk: when `WorldLoader` meshes a chunk at
  some level it meshes that chunk's islands at the same level (full detail, or HLOD with the
  same factor via `LodMesherCore` on the island extent). The chunk stays "busy" until all its
  jobs finish. Island data is unloaded when the owner is neither busy nor at full detail.
- **Studs.** Local studs are turned into world space on the CPU when the job completes (position
  through the pose, yaw added to the stud's spin), so `StudRenderer` and `StudCull.compute`
  treat them like chunk studs (one batch per island). Far fake studs are **off** on islands:
  `_BloxStudTops` is indexed by world-grid columns, which don't line up with a rotated grid, so
  island faces use material copies with `_FakeStudStrength = 0`. Beyond the mid stud distance
  (130 m) island roofs therefore show no studs.
- **Bevels on turned objects.** The brick shader rebuilt top-face axes as world +X/+Z. That is
  wrong for anything turned (islands, and brick models too), so the vertex shader now passes the
  object's +X axis (`objectXWS`) and `BloxFaceAxes` uses it for horizontal faces. Side faces were
  already right (cross(up, n) turns with the object).
- **Picking.** `WorldRaycast.Cast` turns the ray into each loaded island's frame and runs the same
  DDA there; the nearest hit of chunks and islands wins (`BrickHit.IslandId`, island-local I/J).
  `MapCameraRig` doesn't use `WorldRaycast` for picking yet.
- **Not covered:** gameplay ground queries (`WorldIndex.IsSolid`/`ColumnTop`, used by
  `CharacterWalker`) only see chunks, so a walker passes through island buildings. Colour
  variation of island bricks hashes the island-local (i, j, k).

### Mesh format and analytic bevels

One flat polygon per brick face. 64-byte vertex: position, normal, linear colour (variation
already baked in), **UV0 = position on the face in metres**, **UV1 = face size in metres**
(0 = no edge on that axis), UV2 = (material class, brick seed). The shader
(`Shaders/Include/BloxEdges.hlsl`) rebuilds the face axes from the normal, bends the normal
over a small fillet near edges, draws a box-filtered seam and darkens indirect light in
crevices. That gives bevelled-looking bricks with no extra triangles. Glass faces get
UV1 = 0, so windows show no brick seams.

### Rotation in the mesher

Geometry is written in each piece's rot-0 frame (front at z = d). `BrickXform.Point`
(`Meshing/Core/FaceEmitter.cs`) maps it through `Rotation.RotatePoint` onto the record. Placing
in code: `BrickRecord.Place(i, j, k, type, color, Facing.S)` or `PlacedBrick.Place(...)`.
See [guide 01](01-coordinates-and-rotation.md).

## Editor menus (no hand-edited YAML)

| Menu | File | Creates |
|---|---|---|
| `Blox/Setup Project` | `Editor/ProjectSetupMenu.cs`, `UrpAssetFactory.cs`, `PostProcessProfileFactory.cs`, `BloxMaterialFactory.cs` | URP asset + renderer (Forward+, SSAO), post-processing profile, materials in `Assets/Blox/Generated/`; linear colour, GPU Resident Drawer, Input System |
| `Blox/Create Look Test Scene` | `Editor/LookTestSceneMenu.cs`, `LookTestActors.cs` | `Generated/Scenes/LookTest.unity`: sun, sky, volume, camera rig, `World` (WorldLoader → `../build/testscene`) + StudRenderer, a bus on a `PathFollower`, a walker (`CharacterWalker`) |

Some URP settings are set by reflection or serialized names (`SerializedSettings.cs`). They
log a `Blox setup:` warning if a name isn't found.

## Where to change the look

| Want to change | File | Knob / default |
|---|---|---|
| SSAO | `Editor/UrpAssetFactory.cs` | radius 0.12 m, intensity 2.4 |
| bloom, tonemapping, colour, vignette, depth of field | `Editor/PostProcessProfileFactory.cs` | ACES, warm colour filter, Bokeh DoF |
| tilt-shift ("miniature") | `Runtime/Gameplay/MapCameraRig.cs` | drives the Bokeh DoF from the camera distance |
| bevel width, seam, crevice darkening | `Shaders/Include/BloxEdges.hlsl` | |
| plastic material, glass, night glow | `Shaders/BrickBody.shader`, `BrickTransparent.shader`, `Include/BloxBrickCommon.hlsl` | `_BloxNight` from `TimeOfDayController` |
| water ripples | `Shaders/Include/BloxWater.hlsl` | `kBloxWaves` |
| far fake studs | `Shaders/Include/BloxFakeStuds.hlsl` | |
| stud distances | `Runtime/Rendering/StudRenderer.cs` | near 45 m, mid 130 m |
| HLOD distances | `Runtime/Rendering/Core/ChunkLodPolicy.cs` | 260 / 600 / 1200 m |
| sun, moon, ambient | `Runtime/Rendering/TimeOfDayController.cs`, `Core/SolarPosition.cs`, `Core/DaylightModel.cs` | real NOAA sun over Maastricht; clock modes RealTime / Manual / Accelerated |
| shadow range | `Runtime/Rendering/ShadowDistanceController.cs`, `Core/ShadowCascadeMath.cs` | 60-1500 m from camera height, 4 cascades |
| colour variation | `Runtime/Data/Geometry/BrickVariation.cs` | ±6 % value, ±2 % warmth |
| detail piece shapes | `Runtime/Meshing/Core/DetailShapes.cs` | same numbers as `viewer/src/details.js` |

## Tests without Unity

```bash
dotnet test dotnet/Blox.sln                                                    # 360 (Blox.Tests)
dotnet test unity/Assets/Blox/Editor/PureTests~/Blox.LookTests.csproj          # 67 (Blox.LookTests)
```

- `dotnet/Blox.Pure` links (doesn't copy) `Runtime/Data/**`, `Runtime/Meshing/Core/**` and
  `Runtime/Live/**` except `Live/Unity/**`, as netstandard2.1 / C# 9 with warnings as errors,
  the same profile as Unity's compiler. Tests are in `dotnet/Blox.Tests/` (file table in
  `dotnet/README.md`).
- `Editor/PureTests~/` (the `~` hides it from Unity) tests the rendering and gameplay maths:
  sun position, daylight, shadow cascades, LOD policy, stud geometry, camera maths, walk cycle,
  ground probe, character motion.
- `Editor/Tests/LookConventionTests.cs` are EditMode tests for inside Unity (not run yet), incl.
  `IslandTransformMatchesContractPose` (the island GameObject transform vs `IslandPose`).

## Not verified (needs Unity)

Editor menus, Burst jobs (incl. `IslandMeshJob`), `Mesh.MeshDataArray`, GPU stud culling,
island GameObject placement and the `objectXWS` shader change in a real editor, shader compile (138 of 158
variants compiled with DXC outside Unity; the 20 failures are instancing variants that fail the
same way for Unity's own Lit.shader), the look, frame time, input, and the movement scripts.
`WorldRaycast` exists (chunks and islands), but `MapCameraRig` doesn't use it for picking yet.
