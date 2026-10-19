#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data;
using Blox.Meshing.Core;
using Unity.Collections;
using Unity.Jobs;
using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Meshing
{
    /// <summary>
    /// Main-thread façade over the Burst mesh jobs. Typical use:
    /// <code>
    /// using var builder = new ChunkMeshBuilder(world);
    /// var pending = builder.Schedule(coord);          // or ScheduleLod(coord, 4)
    /// ... later (same or next frame) ...
    /// var result = pending.Complete(mesh);            // fills mesh, returns studs
    /// </code>
    /// Neighbour chunks that are loaded in the <see cref="WorldIndex"/> are used to cull faces on
    /// chunk borders; re-mesh a chunk when a neighbour loads if exact border culling matters.
    /// </summary>
    public sealed class ChunkMeshBuilder : IDisposable
    {
        private readonly WorldIndex _world;
        private NativeArray<BrickTypeInfo> _types;
        private NativeArray<PaletteColor> _colors;

        public ChunkMeshBuilder(WorldIndex world)
        {
            _world = world;
            _types = new NativeArray<BrickTypeInfo>(world.TypeTable, Allocator.Persistent);
            _colors = new NativeArray<PaletteColor>(world.ColorTable, Allocator.Persistent);
        }

        public void Dispose()
        {
            if (_types.IsCreated) _types.Dispose();
            if (_colors.IsCreated) _colors.Dispose();
        }

        /// <summary>Schedules the full-detail mesh of a loaded chunk. Returns null if the chunk is not loaded.</summary>
        public PendingChunkMesh? Schedule(ChunkCoord c, JobHandle dependsOn = default)
        {
            var data = _world.GetLoaded(c);
            if (data == null) return null;
            var bricks = GatherWithNeighbours(c, data, out int ownCount);
            var sink = new NativeMeshSink(Allocator.TempJob, Math.Max(64, ownCount * 12));
            var job = new ChunkMeshJob
            {
                Bricks = bricks, OwnCount = ownCount, Types = _types, Colors = _colors,
                ChunkI0 = c.X * Units.ChunkStuds, ChunkJ0 = c.Y * Units.ChunkStuds,
                OriginX = (float)_world.Spec.ChunkOriginX(c), OriginZ = (float)_world.Spec.ChunkOriginZ(c),
                Sink = sink,
            };
            return new PendingChunkMesh(c, job.Schedule(dependsOn), sink, bricks, KRange(data));
        }

        /// <summary>Schedules an HLOD box mesh (factor 2, 4 or 8). Studs are never produced.</summary>
        public PendingChunkMesh? ScheduleLod(ChunkCoord c, int factor, JobHandle dependsOn = default)
        {
            var data = _world.GetLoaded(c);
            if (data == null) return null;
            var bricks = new NativeArray<PlacedBrick>(data.Count, Allocator.TempJob, NativeArrayOptions.UninitializedMemory);
            for (int n = 0; n < data.Count; n++) bricks[n] = PlacedBrick.From(data.Records[n], c.X, c.Y);
            var sink = new NativeMeshSink(Allocator.TempJob, 1024);
            var job = new LodMeshJob
            {
                Bricks = bricks, Types = _types, Colors = _colors, Factor = factor,
                ChunkI0 = c.X * Units.ChunkStuds, ChunkJ0 = c.Y * Units.ChunkStuds,
                OriginX = (float)_world.Spec.ChunkOriginX(c), OriginZ = (float)_world.Spec.ChunkOriginZ(c),
                Sink = sink,
            };
            var range = KRange(data);
            // LOD cells snap to multiples of FactorK plates; widen the bounds accordingly.
            int fk = factor * 5 / 2;
            range = new Vector2Int(WorldSpec.FloorDiv(range.x, fk) * fk, (WorldSpec.FloorDiv(range.y - 1, fk) + 1) * fk);
            return new PendingChunkMesh(c, job.Schedule(dependsOn), sink, bricks, range);
        }

        private Vector2Int KRange(ChunkData data)
        {
            int lo = int.MaxValue, hi = int.MinValue;
            foreach (var r in data.Records)
            {
                var t = _world.TypeTable[r.type];
                if (t.Defined == 0) continue;
                lo = Math.Min(lo, r.k);
                hi = Math.Max(hi, r.k + t.H);
            }
            return lo == int.MaxValue ? Vector2Int.zero : new Vector2Int(lo, hi);
        }

        /// <summary>Own bricks followed by neighbour bricks that touch the one-cell border ring.</summary>
        private NativeArray<PlacedBrick> GatherWithNeighbours(ChunkCoord c, ChunkData data, out int ownCount)
        {
            var list = new List<PlacedBrick>(data.Count + 256);
            foreach (var r in data.Records) list.Add(PlacedBrick.From(r, c.X, c.Y));
            ownCount = list.Count;
            int i0 = c.X * Units.ChunkStuds - 1, i1 = (c.X + 1) * Units.ChunkStuds; // inclusive ring box
            int j0 = c.Y * Units.ChunkStuds - 1, j1 = (c.Y + 1) * Units.ChunkStuds;
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    var nc = new ChunkCoord(c.X + dx, c.Y + dy);
                    var nd = _world.GetLoaded(nc);
                    if (nd == null) continue;
                    foreach (var r in nd.Records)
                    {
                        var p = PlacedBrick.From(r, nc.X, nc.Y);
                        var t = _world.TypeTable[r.type];
                        Rotation.RotatedExtent(t, r.Rot, out int ei, out int ej);
                        if (p.I + ei - 1 < i0 || p.I > i1 || p.J + ej - 1 < j0 || p.J > j1) continue;
                        list.Add(p);
                    }
                }
            var arr = new NativeArray<PlacedBrick>(list.Count, Allocator.TempJob, NativeArrayOptions.UninitializedMemory);
            for (int n = 0; n < list.Count; n++) arr[n] = list[n];
            return arr;
        }
    }

    /// <summary>Result of <see cref="PendingChunkMesh.Complete"/>.</summary>
    public readonly struct ChunkMeshResult
    {
        public readonly int VertexCount, OpaqueTriangles, TransparentTriangles;
        /// <summary>Exposed studs in absolute Unity world metres (empty for LOD meshes).</summary>
        public readonly StudInstance[] Studs;

        public ChunkMeshResult(int v, int o, int t, StudInstance[] studs)
        {
            VertexCount = v; OpaqueTriangles = o; TransparentTriangles = t; Studs = studs;
        }
    }

    /// <summary>A scheduled mesh job. Call <see cref="Complete"/> exactly once (it disposes all job memory).</summary>
    public sealed class PendingChunkMesh
    {
        private NativeMeshSink _sink;
        private readonly NativeArray<PlacedBrick> _bricks;
        private readonly Vector2Int _kRange;
        private bool _done;

        public ChunkCoord Coord { get; }
        public JobHandle Handle { get; }
        public bool IsCompleted => Handle.IsCompleted;

        internal PendingChunkMesh(ChunkCoord coord, JobHandle handle, NativeMeshSink sink, NativeArray<PlacedBrick> bricks, Vector2Int kRange)
        {
            Coord = coord; Handle = handle; _sink = sink; _bricks = bricks; _kRange = kRange;
        }

        /// <summary>
        /// Completes the job and writes the mesh: 32-bit indices, submesh 0 = opaque, 1 = trans/glass.
        /// Positions are chunk-local; place the GameObject at (chunkOriginX, 0, chunkOriginZ).
        /// </summary>
        public ChunkMeshResult Complete(Mesh target)
        {
            if (_done) throw new InvalidOperationException("PendingChunkMesh.Complete called twice");
            _done = true;
            Handle.Complete();
            try
            {
                int vCount = _sink.Vertices.Length, n0 = _sink.OpaqueIndices.Length, n1 = _sink.TransparentIndices.Length;
                var arr = Mesh.AllocateWritableMeshData(1);
                var md = arr[0];
                md.SetVertexBufferParams(vCount, BrickVertexLayout.Attributes);
                md.SetIndexBufferParams(n0 + n1, IndexFormat.UInt32);
                md.GetVertexData<BrickVertex>().CopyFrom(_sink.Vertices.AsArray());
                var idx = md.GetIndexData<int>();
                NativeArray<int>.Copy(_sink.OpaqueIndices.AsArray(), 0, idx, 0, n0);
                NativeArray<int>.Copy(_sink.TransparentIndices.AsArray(), 0, idx, n0, n1);
                md.subMeshCount = 2;
                const MeshUpdateFlags flags = MeshUpdateFlags.DontRecalculateBounds | MeshUpdateFlags.DontValidateIndices | MeshUpdateFlags.DontNotifyMeshUsers;
                var bounds = Bounds();
                md.SetSubMesh(0, new SubMeshDescriptor(0, n0) { bounds = bounds, vertexCount = vCount }, flags);
                md.SetSubMesh(1, new SubMeshDescriptor(n0, n1) { bounds = bounds, vertexCount = vCount }, flags);
                target.Clear();
                Mesh.ApplyAndDisposeWritableMeshData(arr, target, flags);
                target.bounds = bounds;
                var studs = _sink.Studs.Length > 0 ? _sink.Studs.AsArray().ToArray() : Array.Empty<StudInstance>();
                return new ChunkMeshResult(vCount, n0 / 3, n1 / 3, studs);
            }
            finally
            {
                _sink.Dispose();
                if (_bricks.IsCreated) _bricks.Dispose();
            }
        }

        private Bounds Bounds()
        {
            float size = Units.ChunkStuds * Units.StudM;
            float y0 = _kRange.x * Units.PlateM, y1 = _kRange.y * Units.PlateM;
            var b = new Bounds();
            b.SetMinMax(new Vector3(0, y0, 0), new Vector3(size, Mathf.Max(y1, y0 + 0.01f), size));
            return b;
        }
    }
}
