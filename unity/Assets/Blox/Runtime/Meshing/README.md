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
  back/front, two side profiles. Slopes: back rows flat at h, straight slope to a
  **0.25-plate (0.05 m) lip** at the low edge (`BrickProfile.LipPlates`, CONTRACT v2);
  `slope30` (studRows 0) slopes from the back edge. Ridges: lip at both ends, ridge line at
  d/2, no top face. Round bricks and round tiles: 12-sided prism, radius 0.48 stud, smooth
  sides. Jumpers: a plate with one stud on the footprint centre.
* **Detail pieces** (CONTRACT 2.1, `DetailMesher`, sizes in `DetailShapes`, building blocks
  in `DetailParts`), drawn in the piece's rot-0 metre frame with the front at z = d:
  - arch: two piers, an opening (w - 2 studs) with straight sides and a half-elliptic top,
    lintel max(0.1 m, h/6); front/back built from convex strips but bevelled only on the
    outer outline (`FaceEmitter.EmitLocalFramed`);
  - window: full-depth frame (0.06 m bars, sill), mullion + transom at 2/3 height just in
    front of a **glass pane set 0.1 m back**;
  - door: frame, fanlight bar, leaf 0.06 m back with 4 raised panels and a handle, glass
    fanlight in the top 2 plates;
  - fence: 0.1 m rails top (with studs) and bottom, 6-sided round spindles every 0.25 m;
  - grille tile: a tile with 3 grooves (0.04 m) along w on top.
  Panes always use the **glass material class and submesh 1**, whatever the record colour
  (the record colour is the frame), coloured by the palette's first glass entry and carrying
  the brick's seed so each window glows on its own at night. Faces on the piece's bounding
  box are culled against neighbours like any brick face (`DetailShapes.CoversLocal` says
  which sides a piece closes: e.g. a window closes its sides and top, not its front).
* **No seams on glass:** `FaceEmitter` writes UV1 = 0 for every face of material class glass
  (and for panes, spindles, studs, arch undersides). The shader's edge code skips an axis
  whose UV1 is 0, so glass gets no bevel, seam or crevice line: no horizontal brick seams
  across windows.
* Culling: an axis-aligned face is dropped when every cell face it touches is fully covered
  by the neighbouring brick (`BrickProfile.CoversLocal`, e.g. a slope covers only its lip at
  the front) **and** that neighbour is opaque, or both are see-through with the same material
  class (no internal water/glass walls). Sloped faces are never culled; opaque faces next to
  glass/water are kept (visible through them).
* Winding: Unity front face (`cross(b - a, c - a)` points outward); isolated bricks are closed
  2-manifolds (tested for every type x rotation).
* Studs (`Core.StudInstance`, 32 bytes, `StructuredBuffer`-friendly; `StudExtractor`): one per
  stud cell whose cell directly above (at the brick top) is empty - any brick, including glass,
  covers it; jumpers have one centred stud (hidden if either cell above is occupied). Records
  with the v2 **hide_studs** flag (rotFlags bit 3: tops buried under culled interiors) emit none.
  Fields: X, Y, Z (absolute world metres, centre of the stud base on the brick top), R, G, B
  (linear, same as the body), AngleDeg (variation, about +Y), Material (class as float).
* HLOD (`LodMesherCore`): coarse cells of f x f studs x (f * 5 / 2) plates (near-cubic), solid
  when any fine cell is occupied (keeps hollow 1-stud walls), coloured by the highest brick in
  the cell, greedy-merged quads, same culling rule inside the chunk, no culling at chunk borders.

## Brick models (CONTRACT 7.1)

`ModelMesherCore.BuildPart` meshes one part of a `BrickModel` (part -1 = body) relative to
the part pivot; faces are culled only within the part and exposed studs become geometry
(`StudMesher`). `ModelMeshFactory` (Unity) wraps that into a `Mesh` with the same vertex
layout (`BrickVertexLayout`) and two submeshes. See `../Gameplay/README.md`.

## Not verified here

The Burst wrappers (`Unity/`) were compile-checked only against API-shaped stubs, not in a
Unity editor; Burst compatibility of `Span<T>` / `ref struct` use is per Burst 1.8 docs but untested.
