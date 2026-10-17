# Blox.Meshing

`Core/` (namespace `Blox.Meshing.Core`) is engine-free C# over spans and is compiled both here
and by `dotnet/` for tests. `Unity/` holds the thin Burst job wrappers and the main-thread
façade. Asmdef references: Blox.Data, Unity.Burst, Unity.Collections, Unity.Mathematics
(`allowUnsafeCode` for NativeArray -> Span). Requires the packages `com.unity.burst` and
`com.unity.collections` (and `com.unity.mathematics`) in `Packages/manifest.json`.

## Use from Rendering

```csharp
using Blox.Meshing;

var builder = new ChunkMeshBuilder(world);          // keeps type/colour tables as NativeArrays; Dispose() at shutdown
PendingChunkMesh? job = builder.Schedule(coord);     // full detail (+ studs); chunk must be loaded
PendingChunkMesh? lod = builder.ScheduleLod(coord, 4); // HLOD, factor 2/4/8, no studs
// later (poll job.IsCompleted or just call):
ChunkMeshResult r = job.Complete(mesh);              // writes the Mesh, disposes job memory; call exactly once
StudInstance[] studs = r.Studs;                      // draw instanced (absolute world positions)
```

Place the chunk GameObject at `(world.Spec.ChunkOriginX(coord), 0, world.Spec.ChunkOriginZ(coord))`:
mesh positions are chunk-local in x/z and absolute in y. Bounds are set from the chunk's k range.
Border faces are culled against neighbour chunks that are loaded at schedule time; re-mesh a
chunk after a neighbour loads if exact border culling matters (otherwise a few hidden faces remain).

## Mesh format

Index format UInt32. Two submeshes: **0 = opaque** (solid, emissive, metal),
**1 = transparent** (trans, glass). One vertex stream, 64 bytes per vertex (`Core.BrickVertex`):

| Attribute | Format | Meaning |
|---|---|---|
| Position | Float32 x3 | chunk-local metres (x, z from chunk SW corner; y = K * 0.2) |
| Normal | Float32 x3 | flat face normal (round bricks: smooth radial normals on the sides) |
| Color | Float32 x4 | **linear** RGB, palette sRGB decoded, per-brick variation already applied; a = 1 |
| TexCoord0 | Float32 x2 | face-local position in **metres** from the face's min corner (u horizontal, v up the face; on horizontal faces u = +x, v = +z) |
| TexCoord1 | Float32 x2 | face size in metres (same axes). **0 means "no edge on this axis"** (round sides around the circumference, round caps, all HLOD faces): skip the bevel there |
| TexCoord2 | Float32 x2 | x = `MaterialClass` (0 solid, 1 trans, 2 glass, 3 emissive, 4 metal), y = brick seed01 in [0,1) |

Edge distance for the analytic bevel/seam: `min(uv0, uv1 - uv0)` per axis (ignore an axis
whose uv1 is 0). Metres were chosen over studs/plates because sloped faces have no single
grid unit; divide by 0.5 (stud) or 0.2 (plate) if a grid unit is needed. Every face is one
polygon per brick face, so the bevel outlines exactly one brick.

## Geometry rules (Core)

* One polygon per brick face: bottom, flat top (over full-height rows), each sloped segment,
  back/front, two side profiles. Slopes: back rows flat at h, straight slope to a 1-plate lip
  at the low edge (`BrickProfile.LipPlates`); `slope45` rises 2 plates over 1 stud, `slope33`
  2 plates over 2 studs. Ridges: lip at both ends, ridge line at d/2, no top face.
  Round bricks: 12-sided prism, radius 0.48 stud, smooth sides.
* Culling: an axis-aligned face is dropped when every cell face it touches is fully covered
  by the neighbouring brick (`BrickProfile.CoversLocal`, e.g. a slope covers only its lip at
  the front) **and** that neighbour is opaque, or both are see-through with the same material
  class (no internal water/glass walls). Sloped faces are never culled; opaque faces next to
  glass/water are kept (visible through them).
* Winding: Unity front face (`cross(b - a, c - a)` points outward); isolated bricks are closed
  2-manifolds (tested for every type x rotation).
* Studs (`Core.StudInstance`, 32 bytes, `StructuredBuffer`-friendly): one per stud cell whose
  cell directly above (at the brick top) is empty - any brick, including glass, covers it.
  Fields: X, Y, Z (absolute world metres, centre of the stud base on the brick top), R, G, B
  (linear, same as the body), AngleDeg (variation, about +Y), Material (class as float).
* HLOD (`LodMesherCore`): coarse cells of f x f studs x (f * 5 / 2) plates (near-cubic), solid
  when any fine cell is occupied (keeps hollow 1-stud walls), coloured by the highest brick in
  the cell, greedy-merged quads, same culling rule inside the chunk, no culling at chunk borders.

## Not verified here

The Burst wrappers (`Unity/`) were compile-checked only against API-shaped stubs, not in a
Unity editor; Burst compatibility of `Span<T>` / `ref struct` use is per Burst 1.8 docs but untested.
