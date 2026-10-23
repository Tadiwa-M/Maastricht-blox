# Blox.Gameplay: camera, brick models and locomotion

How things that *move* work (CONTRACT section 7.1). Read top to bottom; each step names
the file that does it.

## 1. A model is a small set of bricks

`contract/models/<name>.json` (bus, boat, character) lists bricks in the model's own
cells, always facing **+j**, plus optional **parts** (`leg_l`, `arm_r`, `wheel_fl`, ...)
with a pivot each. `Blox.Data.BrickModel` reads and validates it (every brick must fit in
`size`, types must exist).

## 2. Meshing: one mesh per part

`Blox.Meshing.Core.ModelMesherCore` uses the same brick geometry as the city, with two
twists: faces are only culled against bricks of the *same* part (a swinging leg must not
leave a hole in the hip), and visible studs become real geometry (`StudMesher`) because
the model moves. Vertices are relative to the part's pivot.
`Blox.Meshing.ModelMeshFactory` turns that into Unity meshes (same vertex layout and
shaders as chunks).

## 3. On screen: `BrickModelRenderer`

```
Bus (BrickModelRenderer)     <- model origin = the pose position, ground centre
  body                       <- bricks without a part
  wheel_fl, wheel_fr, ...    <- one child per part, sitting on the part's pivot
```
- `ApplyPose(pose)` places and turns the whole model.
- `SetPartPitch(part, deg)` turns a part about its local x (i) axis. Positive tips the
  top forward (a wheel rolling forward); a limb's foot then swings *back*, so walkers
  pass the negative of the walk-cycle angle.

## 4. Where it is: a `Pose` from a path

`Blox.Data.Pose` = position (Unity metres) + yaw (degrees clockwise from north; 0 = the
model's front points north, 90 = east). `Blox.Data.PathMover` turns a polyline plus a
distance into a pose:

- straight segments: exactly on the path, heading = segment direction;
- corners (`turnRadiusM` > 0): "two axles" rule. A rear point r metres behind and a front
  point r metres ahead on the path; heading = rear -> front, position = their midpoint.
  The heading turns smoothly over 2r metres, like a real vehicle (same rule as the
  browser viewer, so both look alike);
- loops wrap the distance, open paths clamp it.

Pose and PathMover live in `Blox.Data` (not here) because `Blox.Live` uses them too and
must not depend on gameplay: live buses go `VehicleTrack -> ShapePolyline (a PathMover)
-> VehiclePose.ToPose(groundY)`.

## 5. Who moves it

| Component | What drives the distance | Animation |
|---|---|---|
| `PathFollower` | `distance += speed * dt` along its points (loop or open) | wheels roll (`angle = distance / radius`, radius = wheel pivot height); figures walk |
| `CharacterWalker` | keyboard: WASD/arrows relative to the camera, Shift runs | `WalkCycle` legs/arms |
| live bus (via `LiveClient.SamplePoses`) | proxy `distAlongShapeM`, motion rule of CONTRACT 8 | apply `VehiclePose.ToPose(roadY)` |

Pure maths, tested with dotnet (`Editor/PureTests~`):

- `Core/WalkCycle`: phase advances with *distance* (feet never slide), swing grows with
  speed and fades out when stopping; legs opposite, arms opposite their leg.
- `Core/CharacterMotion`: input -> world direction relative to the camera yaw
  (W = away from the camera, diagonal not faster), turn toward it the short way at a
  limited rate.
- `Core/GroundProbe`: where to stand in a grid column (climbs kerbs up to N plates, walls
  block, open air keeps height). The walker feeds it `WorldIndex.IsSolid`, reached through
  `Blox.Data.IWorldSource` (implemented by the Rendering `WorldLoader`), so this assembly
  never references `Blox.Rendering`.

## 6. The look-test scene

`Blox/Create Look Test Scene` (Editor `LookTestActors`) finds the road from the world data
(longest run of asphalt tops), puts the bus on a loop (east on the south lane, back west
on the north lane, turning round beyond the edge) and drops a walker on open ground near
the centre. Press **C** in Play mode to walk it; the `MapCameraRig` follows it
(`FollowTarget`) and leaves WASD to the walker (`KeyboardPanEnabled`).

## Files

| File | What |
|---|---|
| `MapCameraRig.cs`, `Core/MapCameraMath.cs` | Google-Maps-style camera (pan/orbit/zoom, tilt-shift), optional follow target |
| `Models/BrickModelLibrary.cs` | loads catalogue, palette and models from `../contract` (cached) |
| `Models/BrickModelRenderer.cs` | builds the part hierarchy, `ApplyPose`, `SetPartPitch` |
| `Locomotion/PathFollower.cs` | constant-speed path following with wheel/limb animation |
| `Locomotion/CharacterWalker.cs` | third-person keyboard walking on the brick world |
| `Core/WalkCycle.cs`, `Core/CharacterMotion.cs`, `Core/GroundProbe.cs` | engine-free maths (tested) |

Not verified here: the MonoBehaviours were compile-checked against UnityEngine 2021.3
reference assemblies plus small Input System / URP stubs, not run in a Unity 6 editor.
