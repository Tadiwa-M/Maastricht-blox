#nullable enable
using System;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Studs as real mesh geometry, for brick models (buses, characters) that move as one
    /// object and so cannot use the instanced chunk studs. A low-poly cylinder with a flat cap
    /// and no bottom, the same size as the instanced stud (Blox.Rendering StudGeometry:
    /// radius 0.15 m, height 0.1125 m). No bevel edges (UV1 = 0).
    /// </summary>
    public static class StudMesher
    {
        public const float Radius = 0.15f;
        public const float Height = 0.1125f;
        public const int Segments = 10;

        /// <summary>Emits a stud whose base centre is (x, y, z) in output metres.</summary>
        public static void Emit<TSink>(ref TSink sink, float x, float y, float z, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            const int n = Segments;
            float y1 = y + Height;
            for (int s = 0; s < n; s++)
            {
                Angle(s, out float ca, out float sa);
                Angle(s + 1, out float cb, out float sb);
                int i0 = sink.VertexCount;
                sink.AddVertex(V(x + ca * Radius, y, z + sa * Radius, ca, 0, sa, style));
                sink.AddVertex(V(x + cb * Radius, y, z + sb * Radius, cb, 0, sb, style));
                sink.AddVertex(V(x + cb * Radius, y1, z + sb * Radius, cb, 0, sb, style));
                sink.AddVertex(V(x + ca * Radius, y1, z + sa * Radius, ca, 0, sa, style));
                sink.AddTriangle(style.Submesh, i0, i0 + 3, i0 + 2);   // outward, as in RoundMesher
                sink.AddTriangle(style.Submesh, i0, i0 + 2, i0 + 1);
            }
            int centre = sink.VertexCount;
            sink.AddVertex(V(x, y1, z, 0, 1, 0, style));
            for (int s = 0; s < n; s++)
            {
                Angle(s, out float ca, out float sa);
                sink.AddVertex(V(x + ca * Radius, y1, z + sa * Radius, 0, 1, 0, style));
            }
            for (int s = 0; s < n; s++)
                sink.AddTriangle(style.Submesh, centre, centre + 1 + (s + 1) % n, centre + 1 + s);
        }

        private static void Angle(int s, out float c, out float sn)
        {
            double a = 2.0 * Math.PI * s / Segments;
            c = (float)Math.Cos(a);
            sn = (float)Math.Sin(a);
        }

        private static BrickVertex V(float x, float y, float z, float nx, float ny, float nz, in FaceStyle style) => new BrickVertex
        {
            Position = new Float3(x, y, z),
            Normal = new Float3(nx, ny, nz),
            R = style.R, G = style.G, B = style.B, A = 1f,
            U2 = (float)style.Material, V2 = style.Seed01,
        };
    }
}
