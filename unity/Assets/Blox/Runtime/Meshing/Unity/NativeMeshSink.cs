#nullable enable
using Blox.Meshing.Core;
using Unity.Collections;
using Unity.Collections.LowLevel.Unsafe;

namespace Blox.Meshing
{
    /// <summary>Burst-side <see cref="IChunkMeshSink"/> writing into NativeLists (shared by copy).</summary>
    public struct NativeMeshSink : IChunkMeshSink
    {
        public NativeList<BrickVertex> Vertices;
        public NativeList<int> OpaqueIndices;
        public NativeList<int> TransparentIndices;
        public NativeList<StudInstance> Studs;

        public NativeMeshSink(Allocator allocator, int vertexCapacity = 4096)
        {
            Vertices = new NativeList<BrickVertex>(vertexCapacity, allocator);
            OpaqueIndices = new NativeList<int>(vertexCapacity * 3 / 2, allocator);
            TransparentIndices = new NativeList<int>(256, allocator);
            Studs = new NativeList<StudInstance>(1024, allocator);
        }

        public int VertexCount => Vertices.Length;

        public void AddVertex(in BrickVertex v) => Vertices.Add(v);

        public void AddTriangle(int submesh, int a, int b, int c)
        {
            if (submesh == 0) { OpaqueIndices.Add(a); OpaqueIndices.Add(b); OpaqueIndices.Add(c); }
            else { TransparentIndices.Add(a); TransparentIndices.Add(b); TransparentIndices.Add(c); }
        }

        public void AddStud(in StudInstance s) => Studs.Add(s);

        public void Dispose()
        {
            if (Vertices.IsCreated) Vertices.Dispose();
            if (OpaqueIndices.IsCreated) OpaqueIndices.Dispose();
            if (TransparentIndices.IsCreated) TransparentIndices.Dispose();
            if (Studs.IsCreated) Studs.Dispose();
        }
    }

    internal static unsafe class SpanUtil
    {
        public static System.ReadOnlySpan<T> AsSpan<T>(NativeArray<T> a) where T : unmanaged =>
            new System.ReadOnlySpan<T>(NativeArrayUnsafeUtility.GetUnsafeReadOnlyPtr(a), a.Length);

        public static System.Span<T> AsWritableSpan<T>(NativeArray<T> a) where T : unmanaged =>
            new System.Span<T>(NativeArrayUnsafeUtility.GetUnsafePtr(a), a.Length);
    }
}
