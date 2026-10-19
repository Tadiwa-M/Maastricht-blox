#nullable enable
using System.Collections.Generic;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Managed <see cref="IChunkMeshSink"/> collecting into Lists: used on the main thread for
    /// brick models (built once, not in Burst) and by tests. Create with <see cref="Create"/>.
    /// </summary>
    public struct ListMeshSink : IChunkMeshSink
    {
        public List<BrickVertex> Vertices;
        /// <summary>[0] = opaque submesh, [1] = transparent (trans/glass) submesh.</summary>
        public List<int>[] Indices;
        public List<StudInstance> Studs;

        public static ListMeshSink Create() => new ListMeshSink
        {
            Vertices = new List<BrickVertex>(),
            Indices = new[] { new List<int>(), new List<int>() },
            Studs = new List<StudInstance>(),
        };

        public int VertexCount => Vertices.Count;
        public void AddVertex(in BrickVertex v) => Vertices.Add(v);
        public void AddTriangle(int submesh, int a, int b, int c) { Indices[submesh].Add(a); Indices[submesh].Add(b); Indices[submesh].Add(c); }
        public void AddStud(in StudInstance s) => Studs.Add(s);
        public int TriangleCount(int submesh) => Indices[submesh].Count / 3;
    }
}
