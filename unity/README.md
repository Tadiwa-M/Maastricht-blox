# Maastricht Blox: Unity project

Unity 6 (URP 17) client of the brick world described in `../CONTRACT.md`. Everything
Unity-specific (pipeline asset, renderer, post-processing, materials, scenes) is created
**by editor scripts**, never hand-edited YAML, so this folder starts out with only
`Assets/` and `Packages/manifest.json`.

| Assembly | Folder | What |
|---|---|---|
| `Blox.Data` | `Assets/Blox/Runtime/Data` | contract formats (engine-free) |
| `Blox.Meshing` | `Assets/Blox/Runtime/Meshing` | Burst chunk mesher, HLOD boxes, stud lists |
| `Blox.Rendering` | `Assets/Blox/Runtime/Rendering` | world streaming, chunk renderers, instanced studs, sun / time of day, shadow range |
| `Blox.Live` | `Assets/Blox/Runtime/Live` | live proxy client: vehicles, weather, water (motion rule as pure logic) |
| `Blox.Gameplay` | `Assets/Blox/Runtime/Gameplay` | map camera rig, brick models (bus, character), path following, walking (no dependency on `Blox.Rendering`) |
| `Blox.Editor` | `Assets/Blox/Editor` | `Blox/Setup Project`, `Blox/Create Look Test Scene` |
| shaders | `Assets/Blox/Shaders` | `Blox/BrickBody`, `Blox/BrickTransparent`, `Blox/Stud`, `StudCull.compute` |

## First run on Windows

1. **Install Unity 6 LTS.** Install [Unity Hub](https://unity.com/download), then in
   *Installs > Install Editor* pick the latest **Unity 6 LTS** (6000.0.x or newer LTS).
   No extra modules are needed to run in the editor.
2. **Open the project.** Hub > *Projects > Add > Add project from disk* > select this
   `unity` folder, open it with Unity 6.
   - `Packages/manifest.json` pins versions that were current for Unity 6000.0 LTS. URP,
     Burst, Collections and the other core packages are locked to your editor version:
     if Unity reports a version mismatch or offers an upgrade, **accept it** (it rewrites
     the manifest; that is expected).
   - When the Input System asks *"enable the new input system backends?"*, answer **Yes**
     (the editor restarts).
3. **Run `Blox > Setup Project`** (menu bar). It creates, in `Assets/Blox/Generated/`:
   the URP asset + Universal Renderer (Forward+, SSAO feature), the post-processing
   profile and the materials, and assigns them to *Graphics* and every *Quality* level.
   It also sets linear colour space, light colour temperature, GPU Resident Drawer,
   *BatchRendererGroup Variants = Keep All* and the Input System backend. If it says the
   input backend changed, restart the editor. Safe to run again (it re-applies the defaults
   listed below; materials keep your edits).
4. **Generate the look-test world** (one hand-built chunk: Markt corner by the Maas). In a
   terminal at the repository root, with [uv](https://docs.astral.sh/uv/) installed:
   ```
   cd pipeline
   uv sync
   uv run python -m blox_pipeline.testscene
   ```
   This writes `build/testscene/` (manifest, palette, catalogue, chunks, preview.png).
   A real slice is built with `uv run blox fetch` + `uv run blox build --out ../build/world`
   (see `../pipeline/README.md`); point the WorldLoader's *World Directory* at it.
5. **Run `Blox > Create Look Test Scene`.** It builds and saves
   `Assets/Blox/Generated/Scenes/LookTest.unity`: sun with time of day, procedural sky,
   global volume, camera rig framed on the test world, a `World` object with
   WorldLoader (pointed at `../build/testscene`) and StudRenderer, a **Bus** looping along
   the road (found from the world data) and a **Walker** figure on the square. Both are
   brick models from `../contract/models/` (CONTRACT 7.1).
6. **Press Play.** Controls: **left drag** pan, **right drag** orbit (sideways) and tilt
   (up/down), **wheel** zoom toward the cursor; keys **WASD** pan, **Q/E** rotate,
   **R/F** tilt, **Z/X** zoom. Press **C** to take control of the walking figure: WASD
   (or the arrow keys) then walk relative to the camera, **Shift** runs, the camera
   follows it; press C again to go back to the map camera.

The world directory is resolved relative to this `unity` folder (`../build/testscene` =
`<repo>/build/testscene`); an absolute path also works. In a standalone player, use an
absolute path (or copy the world next to the build and point to it).

## Placing and moving things (rotations made easy)

- **Facing, not rot.** Every directional piece has a front that faces +j (north) at rot 0.
  Place pieces by saying which way the front faces: `BrickRecord.Place(..., Facing.E)`,
  `PlacedBrick.Place(..., Facing.S)`. `Blox.Data.Rotation` is the only code that knows the
  rot maths (and is checked against `contract/test_vectors/rotation.json`).
- **Pose.** Anything that moves (bus, boat, figure) is placed by a `Blox.Data.Pose`:
  position in Unity metres plus yaw in degrees clockwise from north. In Unity that is
  `Quaternion.Euler(0, yaw, 0)`. `PathMover` turns path + distance into a pose; live buses
  (`VehiclePose.ToPose`), `PathFollower` and `CharacterWalker` all go through it.
- See `Assets/Blox/Runtime/Gameplay/README.md` for the walk-through of models and locomotion.

## How the look is built

- **Brick bodies** (`Blox/BrickBody`): moulded-plastic PBR (smoothness ~0.75, thin
  clear coat for the tight second highlight). Bevels, seams and crevice occlusion are
  analytic: the mesher writes each face's position-on-face (UV0, metres) and face size
  (UV1); the shader rebuilds the face axes from the normal exactly like
  `FaceEmitter.FaceAxes`, bends the normal over a ~0.04-stud quarter-round fillet at each
  brick edge, draws a box-filtered dark seam line and darkens the indirect light near
  edges. The bevel fades out by pixel footprint (`ddx`/`ddy` = `fwidth`) when it gets
  narrower than ~1.5 px, and the seam keeps its true average, so nothing sparkles in the
  distance.
- **Colour variation**: done once, in the mesher, with `Blox.Data.BrickVariation`
  (PCG hash of the brick's global min corner, documented in that file) and baked into the
  vertex colour; studs carry the same colour. The shader only adds the per-brick
  micro-variation (tiny normal tilt and smoothness jitter) from the seed in UV2.y.
- **Studs**: near (< 45 m) 16-segment studs with a bevelled top edge, mid (< 130 m)
  8-segment studs, drawn with `Graphics.RenderMeshIndirect` after GPU frustum + distance
  culling (`StudCull.compute`) into two indirect draws. Beyond that, `BrickBody` fakes
  them on top faces (rim normal, contact ring, short sun-side shadow), but only where
  `_BloxStudTops` (a 32 MB global buffer, highest exposed stud level per column, filled
  from each chunk's stud list) says a stud really sits on that face: roads (tiles) stay
  smooth.
- **Glass** (palette class `glass`): dark and glossy by day; at night a stable, hashed
  share of windows glows warm through `_BloxNight`. The hash is the brick seed (UV2.y), so
  each window piece (CONTRACT 2.1) lights up on its own. Glass faces get no bevel or seam
  (the mesher writes UV1 = 0 for every glass face), so stacked glass bricks read as one pane.
- **Detail pieces** (arches, windows with mullion/transom, doors with panels and fanlight,
  fences with round spindles, round tiles, jumpers, grille tiles, shallow slopes) are
  meshed by `Blox.Meshing.Core.DetailMesher` from boxes, quads and posts; see
  `Assets/Blox/Runtime/Meshing/README.md`. **Emissive** colours (lamps) glow a
  little by day and fully at night. **Water** (`trans`): procedural ripples, depth-tinted
  and more opaque with depth (needs the depth texture, enabled by setup).
- **SSAO** (DepthNormals, small radius 0.12 m, intensity 2.4) works because every Blox
  shader has `DepthOnly`, `DepthNormals` and `ShadowCaster` passes (studs included).
- **MSAA 4x** is on: the analytic bevel/seam handles interior edges, MSAA the silhouettes.
  SSAO is computed from the non-MSAA depth-normals prepass, so very thin halos on
  silhouettes are possible; set MSAA to off and use SMAA on the camera if you prefer.
- **HLOD**: per-chunk distance with 10 % hysteresis: full detail < 260 m, then HLOD boxes
  at factor 2 (< 600 m), 4 (< 1200 m) and 8.
- **Sun**: NOAA solar position for Maastricht from the real date and time (or a manual /
  accelerated clock), colour temperature 1900 K at the horizon to 5900 K high up, a cool
  moon light at night (the swap happens at -1.5 deg where both are 0).
- **Shadows**: soft, 4 cascades; `ShadowDistanceController` sets the range from the camera
  height (60 m at street level up to 1500 m) with practical-split cascades.

## Look tuning (every exposed parameter)

### Material `BrickBody` (`Assets/Blox/Generated/Materials/BrickBody.mat`)
| Property | Default | Effect |
|---|---|---|
| Smoothness | 0.75 | base gloss of the plastic |
| Per-brick smoothness jitter | 0.06 | gloss difference between neighbouring bricks |
| Clear coat | 0.35 | strength of the tight second highlight |
| Clear coat smoothness | 0.92 | tightness of that highlight |
| Per-brick normal tilt | 0.012 | how much each brick's face is "off" (catches light differently) |
| Metal smoothness | 0.6 | gloss of the `metal` palette class (metallic 0.85) |
| Bevel width (studs) | 0.04 | fillet width on brick edges (0.02 m) |
| Bevel strength | 0.9 | how far the normal bends at the very edge |
| Seam width (studs) | 0.012 | dark gap line between bricks |
| Seam darkness | 0.55 | darkness of that line |
| Crevice width (studs) | 0.12 | width of the indirect-light darkening along edges |
| Crevice occlusion | 0.35 | its strength |
| Fake stud strength | 1 | far-distance fake studs overall |
| Stud contact ring occlusion | 0.35 | dark ring around every stud base (all distances) |
| Fake stud sun shadow | 0.8 | short shadow of fake studs |
| Emissive intensity (HDR) | 4 | glow of `emissive` colours (with bloom) |
| Emissive share by day | 0.15 | fraction of that glow during the day |

### Material `BrickTransparent`
Same plastic and edge properties as BrickBody (defaults: smoothness 0.8, seam darkness
0.35, crevice 0.2), plus:
| Property | Default | Effect |
|---|---|---|
| Deep colour | (0.05, 0.13, 0.16) | water colour where it is deep |
| Alpha shallow / deep | 0.45 / 0.93 | water opacity at the edge / in depth |
| Depth density (1/m) | 2.5 | how fast water gets deep |
| Smoothness (water) | 0.93 | |
| Wave scale / speed / strength | 1 / 0.6 / 1.5 | ripple size, speed, normal strength |
| Alpha (glass) | 0.88 | |
| Smoothness (glass) | 0.95 | |
| Day darkening | 0.35 | glass albedo reduction |
| Night window emission | HDR (2.6, 1.75, 0.95) | colour/brightness of lit windows |
| Share of lit windows | 0.55 | fraction of windows lit at night |

### Material `Stud`
Smoothness 0.75, Clear coat 0.35, Clear coat smoothness 0.92, Metal smoothness 0.6,
Occlusion at stud base 0.35, Night emission of glass studs, Emissive intensity 4,
Emissive share by day 0.15 (keep these equal to BrickBody so studs match their bricks).

### `StudRenderer` (on `World`)
| Field | Default | Effect |
|---|---|---|
| Near Distance | 45 m | 16-segment bevelled studs closer than this |
| Mid Distance | 130 m | 8-segment studs closer than this; beyond: faked in the shader |
| Fake Fade Start | 0.8 | fake studs fade in from 0.8 x Mid Distance to Mid Distance |
| Near / Mid Capacity | 400 k / 1.2 M | maximum studs drawn per frame per LOD |
| Near / Mid Casts Shadows | on / off | |
| Culling Camera | Camera.main | |

### `WorldLoader` (on `World`)
| Field | Default | Effect |
|---|---|---|
| World Directory | `../build/testscene` | pipeline output folder |
| Lod: Full / Lod2 / Lod4 Distance | 260 / 600 / 1200 m | HLOD thresholds (factor 8 beyond) |
| Lod: Hysteresis | 0.1 | 10 % margin before switching |
| Max Distance | 4000 m | chunks farther away are not shown |
| Max Schedules Per Frame | 4 | mesh jobs started per frame |
| Max Jobs In Flight | 16 | |
| Verify Sha1 | off | check chunk files against the manifest |

### `TimeOfDayController` (on `Sun`)
Clock (RealTime / Manual / Accelerated), Offset Hours, Manual Year / Day Of Year / Local
Hour (CET/CEST), Time Scale (Accelerated, default 600x), Latitude / Longitude (Vrijthof),
Sun Max Intensity 2.2, Moon Intensity 0.12, Horizon Kelvin 1900, Noon Kelvin 5900, Moon
Kelvin 8500, Moon Elevation 38 deg, Min Light Elevation 4 deg (the shadow light never
grazes lower), Night Start / Full Elevation 4 / -6 deg (`_BloxNight` ramp), Drive Ambient,
and the ambient trilight colours for day, dusk and night.

### `ShadowDistanceController` (on `Main Camera`)
Ground Height (set to the world's median ground by the scene builder), Distance Per Metre
4 (shadow range = 30 m + 4 x altitude), Min / Max Distance 60 / 1500 m, Split Lambda 0.85
(0 uniform .. 1 logarithmic cascades), Tolerance 0.05.

### `MapCameraRig` (on `Main Camera`)
Target, Ground Height, Bounds Min / Max; Distance, Min / Max Distance 4 / 3200 m, Zoom
Ratio Per Notch 0.8, Zoom Sharpness 12; Yaw, Near Tilt 66 deg at Near Tilt Distance 20 m,
Far Tilt 6 deg at Far Tilt Distance 2000 m (log interpolation), Tilt Offset, Max Tilt 82,
Orbit / Tilt Degrees Per Pixel 0.25 / 0.2, Rotate Sharpness 14; Key Pan Speed 0.8
distances/s, Key Rotate Speed 90 deg/s, Key Zoom Notches Per Second 4; **tilt-shift**:
Post Volume, Tilt Shift on, Focal Length At 100m 190 mm (scaled with sqrt(distance) so the
miniature blur looks alike at every zoom, clamped to 300 mm), Aperture f/2.2 (lower =
stronger blur).

### Post-processing profile (`Blox_PostProcess.asset`)
Bloom threshold 1.05, intensity 0.32, scatter 0.55, HQ filtering; Tonemapping ACES (try
Neutral for less contrast); Color Adjustments post-exposure +0.15, contrast 10,
saturation 12, colour filter (1, 0.965, 0.92) warm; Depth of Field Bokeh (focus, focal
length and aperture driven by the rig), 6 blades; Vignette 0.18, smoothness 0.45.

### URP asset / renderer (`Blox_URP.asset`, `Blox_URP_Renderer.asset`)
HDR on, MSAA 4x, render scale 1, depth texture on, main light shadows 4096 px, soft
shadows High, 4 cascades (runtime-driven), depth bias 0.8, normal bias 0.5, per-pixel
additional lights with shadows, HDR grading, SRP Batcher, GPU Resident Drawer
(Instanced Drawing), Forward+. SSAO feature: DepthNormals source, High normals, full
resolution, intensity 2.4, direct lighting strength 0.35, radius 0.12 m, falloff 180 m,
High samples, High blur.

### Scene (`Create Look Test Scene`)
Fog exponential squared 0.0006 (haze colour (0.70, 0.76, 0.84)), procedural sky (sun size
0.035, atmosphere 0.85, exposure driven by time of day), camera FOV 40.

## Tests

The engine-free logic (solar position, daylight curves, Dutch civil time, LOD policy,
shadow cascade maths, stud mesh geometry, stud-top buffer layout, camera maths) is in the
`Core/` folders and tested with dotnet (the folder ends in `~`, so Unity ignores it):
```
dotnet test unity/Assets/Blox/Editor/PureTests~/Blox.LookTests.csproj
```
Edit-mode tests that check the same maths against Unity's own conventions (camera and sun
rotations vs `Quaternion.Euler`, stud mesh dimensions, `StudInstance` stride, LOD planning)
are in `Assets/Blox/Editor/Tests`: *Window > General > Test Runner > EditMode > Run All*.

## Known limits

- Unity was not available where this was written. The C# was type-checked against the
  Unity 2021.3 engine reference assemblies plus stubs of the URP / Input System / editor
  APIs used (whose names were checked against the URP 17.0.4 sources); the shaders were
  compiled with DXC against the URP 17.0.4 / Core ShaderLibrary for every keyword used
  (non-instanced variants; instanced variants need Unity's own compiler environment).
  Expect to fix the odd API rename on first open; every setting without a public URP
  setter is applied by serialized field name and logs a warning (with what to set by
  hand) if the field is missing.
- `RealTime` mode uses the PC clock; the sun is correct for Maastricht whatever the PC's
  time zone.
- Studs are culled against the main camera only (the Scene view shows the main camera's
  stud set). The `World` object must stay at the origin (stud positions are absolute).
- Camera picking uses the horizontal plane through the orbit target, not the bricks.
- Shaders declare both `_FORWARD_PLUS` (URP 17.0) and `_CLUSTER_LIGHT_LOOP` (URP 17.1+)
  so they work across Unity 6 minor versions; the unused one only costs compile time.

Not affiliated with, endorsed or sponsored by the LEGO Group. Data credits: see
`../CONTRACT.md` section 9.
