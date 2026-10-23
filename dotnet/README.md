# dotnet test harness

Compiles the engine-free Unity sources by **linking** them (nothing is copied):

* `Blox.Pure/` - netstandard2.1, C# 9, warnings as errors: `Runtime/Data/**`, `Runtime/Meshing/Core/**`,
  `Runtime/Live/**` except `Live/Unity/**`. This mirrors Unity's compiler profile.
* `Blox.Tests/` - xUnit tests (net8.0).

Run (Windows or Linux, .NET 8 SDK):

```
dotnet test dotnet/Blox.sln
```

Optional data-driven tests are reported as *skipped* when their inputs are absent:
`pipeline/tests/fixtures/golden/` (pipeline golden chunk and island), `build/testscene/` (pipeline look-test world),
`build/fixture_world/` (synthetic town with islands) and `samples/markt/` (real-data sample).

What the tests cover (`Blox.Tests/`):

| File | Checks |
|---|---|
| `RotationTests` | every case of `contract/test_vectors/rotation.json` (facing table, front directions, extents, footprint cells), plus facing/yaw helpers |
| `ContractModelTests` | palette, catalogue (incl. v2 detail kinds), manifest v1/v2, world spec, features |
| `ChunkIoTests`, `WorldIndexTests` | `.bxc` reader/writer, occupancy, ray cast, the generated test scene if present |
| `IslandTests` | v3 islands: pose vs `contract/test_vectors/islands.json` (and Unity's Euler-Y rotation), `.bxi` reader/writer and header layout, manifest islands, island occupancy, meshing on the island grid (culling, studs, studs to world, HLOD), ray casts through rotated islands, `WorldFiles` with islands; data-driven: pipeline golden island, `build/fixture_world`, `samples/markt` |
| `MesherTests` | profile bricks: closed, outward, exact volume for every type x rotation; culling; studs; slope lip |
| `DetailMesherTests` | arch/window/door/fence/grille in every rotation; panes are seamless glass 0.1 m behind the front; jumper centre stud; slope30; hide_studs |
| `BrickModelTests` | model JSON parsing/validation, per-part meshes around pivots, real `contract/models/*.json` |
| `PathMoverTests` | poses along paths, corner smoothing, loops, live buses using the same `Pose` |
| `LiveTests`, `LodAndVariationTests`, `JsonParserTests` | live proxy client, HLOD, colour variation, JSON |

Gameplay/rendering maths (walk cycle, ground probe, camera, sun) is tested by
`dotnet test unity/Assets/Blox/Editor/PureTests~/Blox.LookTests.csproj`.
