# Blox.Data

Pure C# (`noEngineReferences: true`, netstandard2.1, C# 9). Reads everything the pipeline
writes (CONTRACT.md sections 1-6) and answers world queries. Compiled and tested outside
Unity by `dotnet/` (`dotnet test dotnet/Blox.sln`).

## Loading a world

```csharp
using Blox.Data;

WorldIndex world = WorldFiles.Open(worldDir, verifySha1: false); // manifest, palette, catalogue, features
foreach (ManifestChunk c in world.AvailableChunks) { /* only non-empty chunks exist */ }
ChunkData? chunk = world.Load(new ChunkCoord(22, 47));             // reads + validates chunks/c_22_47.bxc
world.Unload(new ChunkCoord(22, 47));
```

`WorldIndex` is not thread-safe for load/unload; read-only queries may run concurrently.
`WorldFiles` uses `System.IO` only (works for StreamingAssets on desktop; not on Android/WebGL,
where you would build a `WorldIndex` with your own loader delegate and `ChunkReader.Read(bytes)`).

## Types

| Type | What |
|---|---|
| `WorldSpec` | Contract constants + conversions: `RdToCell`, `RdToUnity`, `CellToUnityX/Y/Z`, `UnityXToI/YToK/ZToJ`, `ChunkOf(I, J)`, `ChunkOriginX/Z`. `ContractVersion` = 2 (`MinContractVersion` = 1); `FromManifest` checks the grid values. |
| `GridCell`, `ChunkCoord` | Integer cell (I, J, K) and chunk (cx, cy). `ChunkCoord.FileName` = `chunks/c_XX_YY.bxc`. |
| `Manifest` | `manifest.json` model; accepts `contractVersion` 1 and 2 (v2 only added things). |
| `Palette`, `PaletteEntry`, `MaterialClass` | `palette.json`. `ToTable()` -> `PaletteColor[256]` (linear RGB + class) for jobs. |
| `Catalogue`, `BrickType`, `BrickKind`, `StudPattern` | `brick_catalogue.json` incl. the v2 detail kinds (`arch`, `window`, `door`, `fence`, `round_tile`, `jumper`, `tile_grille`) and `studs: center`. `ToTable()` -> `BrickTypeInfo[256]` (blittable) for jobs; `IsDetail`, `IsRound`. |
| `FeatureSet`, `Feature` | `features.json`; `Get(id)`, `Search(text)` (name prefix > name substring > address). Unknown kinds load as `FeatureKind.Unknown`. |
| `BrickRecord` | 12-byte blittable record exactly as in the file: `i, j, k, type, color, rotFlags, featureId`; `.Rot`, `.Facing`, `.NoVariation`, `.HideStuds` (v2 bit 3). Create with `BrickRecord.Place(..., Facing.E)`. |
| `ChunkReader` / `ChunkWriter` | `.bxc` I/O (raw DEFLATE via `DeflateStream`). Reader validates header, sizes, reserved bits, sort order; with a type table also unknown ids, chunk-border crossing and minK/maxK. Errors throw `ChunkFormatException`. |
| `ChunkData` | Header + `Records` (file order, sorted by k, j, i). `GlobalI(n)`, `GlobalJ(n)`. |
| `ChunkOccupancy` | Per-chunk sparse column spans: `BrickAt(i, j, k)`, `ColumnTop(i, j)`. |
| `WorldIndex` | `TryGetBrick(I, J, K, out BrickHit)`, `IsSolid`, `ColumnTop`, `FeatureAt`, plus `TypeTable` / `ColorTable`. |
| `WorldRaycast.Cast` | DDA ray cast in Unity metres through loaded chunks (bricks as boxes) for picking. |
| `Rotation`, `Facing` | **the** rotation rules of CONTRACT section 2 (see below); nothing else does rot maths. |
| `Footprint` | which footprint cells carry studs (`HasStud`, `HasCenterStud`). |
| `Pose`, `PathMover` | CONTRACT 7.1 motion: a pose is position + yaw (clockwise from north); `PathMover` turns path + distance into a pose (shared by live buses and gameplay). |
| `BrickModel`, `ModelPart`, `ModelBrick` | `contract/models/*.json` (bus, boat, character): bricks in model cells, parts with pivots; `Parse(json, catalogue)` validates. |
| `IWorldSource` | "who has the loaded world": implemented by Rendering's `WorldLoader`, used by Gameplay without a Rendering reference. |
| `BrickVariation` | Deterministic per-position colour/stud variation (see below). |
| `Json.JsonParser` / `JsonNode` | Small strict JSON parser (System.Text.Json is unavailable in Unity). |

## Rotation (CONTRACT section 2), as implemented by `Rotation`

**Say which way the front faces.** Every directional piece (slope, window, door, arch,
model) has a front that faces +j (north) at rot 0. Code that places things passes a
`Facing` (`N`, `E`, `S`, `W`) and lets `Rotation.FacingToRot` pick the rot.

Brick-local frame at rot 0: x along +i in [0, w], z along +j in [0, d], front at z = d.
`rot` turns the footprint rot x 90 degrees clockwise seen from above (+j -> +i), then the
rotated box's min corner sits at the record's (i, j).

| facing | rot | front faces | point (x, z) -> box offset | unit cell (a, b) -> box cell (`FootprintCell`) |
|---|---|---|---|---|
| N | 0 | +j | (x, z) | (a, b) |
| E | 1 | +i | (z, w - x) | (b, w-1-a) |
| S | 2 | -j | (w - x, d - z) | (w-1-a, d-1-b) |
| W | 3 | -i | (d - z, x) | (d-1-b, a) |

Helpers: `FacingToRot`, `RotToFacing`, `FacingToYawDeg`, `YawToFacing`, `ParseFacing`,
`FrontDir`, `RotateDir`, `RotatedExtent`, `FootprintCell`, `UnrotateCell`, `RotatePoint`.
`dotnet/Blox.Tests/RotationTests.cs` checks every case of `contract/test_vectors/rotation.json`.
A slope's front is its low edge; its stud rows (`studs: backRows`) are local rows
b < studRows, i.e. the back (-z side at rot 0). `studRows: 0` (slope30) has no studs.

## Variation hash (mirror this in HLSL)

```
uint Pcg(uint v) { uint s = v * 747796405u + 2891336453u;
                   uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
uint Seed(int I, int J, int K) { return Pcg(uint(I) * 0x8DA6B343u ^ uint(J) * 0xD8163841u ^ uint(K) * 0xCB1AB31Fu); }
value  v = ((s & 0xFF) / 255 * 2 - 1) * 0.06      rgb *= 1 + v
warmth w = (((s >> 8) & 0xFF) / 255 * 2 - 1) * 0.02 r *= 1 + w; b *= 1 - w
stud angle = ((s >> 16) & 0xFFFF) / 65536 * 360 deg
seed01 = (s >> 8) / 16777216
```
Bricks hash their record min corner (I, J, K); studs hash their own cell (I, J, Ktop).
`no_variation` bricks skip v and w. Test vectors (from `VariationTests`): `Pcg(0) = 129708002`,
`Seed(1,2,3) = 438766412`, `Seed(970,2434,100) = 3704521945`, `Seed(-1,0,0) = 4197473905`.
The mesher already bakes v and w into vertex colours; the shader only needs the hash for extras.
