using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Rendering
{
    /// <summary>Unity meshes for the stud LODs, generated from <see cref="StudGeometry"/>.</summary>
    public static class StudMeshes
    {
        public const int NearSegments = 16;
        public const float NearBevel = 0.012f;
        public const int MidSegments = 8;

        public static Mesh CreateNear() => ToMesh(StudGeometry.Build(NearSegments, NearBevel), "Blox Stud (near)");
        public static Mesh CreateMid() => ToMesh(StudGeometry.Build(MidSegments, 0f), "Blox Stud (mid)");

        public static Mesh ToMesh(StudGeometry g, string name)
        {
            int n = g.VertexCount;
            var positions = new Vector3[n];
            var normals = new Vector3[n];
            for (int v = 0; v < n; v++)
            {
                positions[v] = new Vector3(g.Positions[3 * v], g.Positions[3 * v + 1], g.Positions[3 * v + 2]);
                normals[v] = new Vector3(g.Normals[3 * v], g.Normals[3 * v + 1], g.Normals[3 * v + 2]);
            }
            var mesh = new Mesh { name = name, indexFormat = IndexFormat.UInt16 };
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetIndices(g.Indices.ToArray(), MeshTopology.Triangles, 0, true);
            mesh.UploadMeshData(true);
            return mesh;
        }
    }
}
