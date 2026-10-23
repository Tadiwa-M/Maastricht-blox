#nullable enable
using Blox.Data;
using Blox.Meshing.Core;
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;

namespace Blox.Meshing
{
    /// <summary>Burst job: full-detail chunk mesh + exposed studs (wraps <see cref="ChunkMesherCore"/>).</summary>
    [BurstCompile]
    public struct ChunkMeshJob : IJob
    {
        [ReadOnly] public NativeArray<PlacedBrick> Bricks;   // own bricks first, then neighbour bricks
        public int OwnCount;
        [ReadOnly] public NativeArray<BrickTypeInfo> Types;  // 256 entries
        [ReadOnly] public NativeArray<PaletteColor> Colors;  // 256 entries
        public int ChunkI0, ChunkJ0;
        public float OriginX, OriginZ;
        public NativeMeshSink Sink;

        public void Execute()
        {
            var all = SpanUtil.AsSpan(Bricks);
            var own = all.Slice(0, OwnCount);
            var types = SpanUtil.AsSpan(Types);
            var colors = SpanUtil.AsSpan(Colors);
            var dims = CellGrid.ComputeDims(own, types, ChunkI0, ChunkJ0);
            if (dims.SizeK == 0) return;
            var cells = new NativeArray<ushort>(dims.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            var cellSpan = SpanUtil.AsWritableSpan(cells);
            CellGrid.Fill(cellSpan, dims, all, types, colors);
            ChunkMesherCore.Build(ref Sink, own, cellSpan, dims, types, colors, OriginX, OriginZ);
            cells.Dispose();
        }
    }

    /// <summary>
    /// Burst job: full-detail mesh of one island (CONTRACT 5.1) in island-local space, plus its
    /// exposed studs (local). Wraps <see cref="IslandMesherCore"/>: the chunk mesher on the
    /// island's own grid, no neighbours (culling and stud exposure are within the island).
    /// </summary>
    [BurstCompile]
    public struct IslandMeshJob : IJob
    {
        [ReadOnly] public NativeArray<PlacedBrick> Bricks;   // island bricks, local cells
        [ReadOnly] public NativeArray<BrickTypeInfo> Types;
        [ReadOnly] public NativeArray<PaletteColor> Colors;
        public int ExtentI, ExtentJ;
        public NativeMeshSink Sink;

        public void Execute()
        {
            var own = SpanUtil.AsSpan(Bricks);
            var types = SpanUtil.AsSpan(Types);
            var colors = SpanUtil.AsSpan(Colors);
            var dims = CellGrid.ComputeDims(own, types, 0, 0, ExtentI, ExtentJ);
            if (dims.SizeK == 0) return;
            var cells = new NativeArray<ushort>(dims.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            IslandMesherCore.Build(ref Sink, own, SpanUtil.AsWritableSpan(cells), dims, types, colors);
            cells.Dispose();
        }
    }

    /// <summary>
    /// Burst job: HLOD box mesh at factor 2/4/8 (wraps <see cref="LodMesherCore"/>). Chunks leave
    /// SizeI/SizeJ at 0 (64 x 64); islands pass their local extent with ChunkI0/J0 = 0 and origin 0.
    /// </summary>
    [BurstCompile]
    public struct LodMeshJob : IJob
    {
        [ReadOnly] public NativeArray<PlacedBrick> Bricks;   // own bricks only
        [ReadOnly] public NativeArray<BrickTypeInfo> Types;
        [ReadOnly] public NativeArray<PaletteColor> Colors;
        public int ChunkI0, ChunkJ0, Factor;
        public int SizeI, SizeJ;  // 0 = one chunk (64 x 64)
        public float OriginX, OriginZ;
        public NativeMeshSink Sink;

        public void Execute()
        {
            var own = SpanUtil.AsSpan(Bricks);
            var types = SpanUtil.AsSpan(Types);
            var dims = SizeI > 0
                ? LodMesherCore.ComputeDims(own, types, ChunkI0, ChunkJ0, SizeI, SizeJ, Factor)
                : LodMesherCore.ComputeDims(own, types, ChunkI0, ChunkJ0, Factor);
            if (dims.NK == 0) return;
            var color = new NativeArray<byte>(dims.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            var topK = new NativeArray<int>(dims.Length, Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            var mask = new NativeArray<byte>(LodMesherCore.MaskSize(dims), Allocator.Temp, NativeArrayOptions.UninitializedMemory);
            var colorSpan = SpanUtil.AsWritableSpan(color);
            LodMesherCore.Downsample(own, types, dims, colorSpan, SpanUtil.AsWritableSpan(topK));
            LodMesherCore.Build(ref Sink, dims, colorSpan, SpanUtil.AsSpan(Colors), SpanUtil.AsWritableSpan(mask), OriginX, OriginZ);
            color.Dispose();
            topK.Dispose();
            mask.Dispose();
        }
    }
}
