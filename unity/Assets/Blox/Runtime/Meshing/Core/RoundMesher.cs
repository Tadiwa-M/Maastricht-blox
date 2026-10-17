#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Round 1x1 bricks/plates: a <see cref="BrickProfile.RoundSegments"/>-sided prism with
    /// smooth side normals, centred in its cell. UV1 is 0 on the axes that have no brick edge
    /// (around the circumference, and on the top/bottom caps) so the bevel shader skips them.
    /// </summary>
    public static class RoundMesher
    {
        public static void Emit<TSink>(ref TSink sink, in BrickXform xf, in BrickTypeInfo t, in MeshContext ctx, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            const int n = BrickProfile.RoundSegments;
            int topK = xf.K + t.H - 1;
            bool topVisible = !CellGrid.FaceHidden(ctx.Cells, ctx.Dims, xf.I, xf.J, topK, Dir.PosY, style.Material);
            bool bottomVisible = !CellGrid.FaceHidden(ctx.Cells, ctx.Dims, xf.I, xf.J, xf.K, Dir.NegY, style.Material);
            bool sidesVisible = topVisible || bottomVisible;
            for (int p = 0; p < t.H && !sidesVisible; p++)
                for (int d = 0; d < 4 && !sidesVisible; d++)
                    if (!CellGrid.FaceHidden(ctx.Cells, ctx.Dims, xf.I, xf.J, xf.K + p, d, style.Material)) sidesVisible = true;

            float cx = (xf.I + 0.5f) * Units.StudM - xf.OriginX;
            float cz = (xf.J + 0.5f) * Units.StudM - xf.OriginZ;
            float y0 = xf.K * Units.PlateM, y1 = (xf.K + t.H) * Units.PlateM;
            float r = BrickProfile.RoundRadius * Units.StudM;
            float height = y1 - y0;
            float circumference = 2f * (float)Math.PI * r;

            if (sidesVisible)
            {
                for (int s = 0; s < n; s++)
                {
                    Angle(s, n, out float ca, out float sa);
                    Angle(s + 1, n, out float cb, out float sb);
                    int baseIndex = sink.VertexCount;
                    float ua = circumference * s / n, ub = circumference * (s + 1) / n;
                    // Going counter-clockwise in (x, z) seen from above; outward normals radial.
                    sink.AddVertex(Vertex(cx + ca * r, y0, cz + sa * r, ca, 0, sa, ua, 0, 0, height, style));
                    sink.AddVertex(Vertex(cx + cb * r, y0, cz + sb * r, cb, 0, sb, ub, 0, 0, height, style));
                    sink.AddVertex(Vertex(cx + cb * r, y1, cz + sb * r, cb, 0, sb, ub, height, 0, height, style));
                    sink.AddVertex(Vertex(cx + ca * r, y1, cz + sa * r, ca, 0, sa, ua, height, 0, height, style));
                    // Winding chosen so cross(b - a, c - a) points outward (Unity front face).
                    sink.AddTriangle(style.Submesh, baseIndex, baseIndex + 3, baseIndex + 2);
                    sink.AddTriangle(style.Submesh, baseIndex, baseIndex + 2, baseIndex + 1);
                }
            }
            if (topVisible) Cap(ref sink, cx, y1, cz, r, 1f, style);
            if (bottomVisible) Cap(ref sink, cx, y0, cz, r, -1f, style);
        }

        private static void Cap<TSink>(ref TSink sink, float cx, float y, float cz, float r, float ny, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            const int n = BrickProfile.RoundSegments;
            int centre = sink.VertexCount;
            sink.AddVertex(Vertex(cx, y, cz, 0, ny, 0, r, r, 0, 0, style));
            for (int s = 0; s < n; s++)
            {
                Angle(s, n, out float ca, out float sa);
                sink.AddVertex(Vertex(cx + ca * r, y, cz + sa * r, 0, ny, 0, r + ca * r, r + sa * r, 0, 0, style));
            }
            for (int s = 0; s < n; s++)
            {
                int a = centre + 1 + s, b = centre + 1 + (s + 1) % n;
                // Ring runs counter-clockwise seen from above: (centre, b, a) faces up.
                if (ny > 0) sink.AddTriangle(style.Submesh, centre, b, a);
                else sink.AddTriangle(style.Submesh, centre, a, b);
            }
        }

        private static void Angle(int s, int n, out float c, out float sn)
        {
            double a = 2.0 * Math.PI * s / n;
            c = (float)Math.Cos(a);
            sn = (float)Math.Sin(a);
        }

        private static BrickVertex Vertex(float x, float y, float z, float nx, float ny, float nz,
                                          float u0, float v0, float u1, float v1, in FaceStyle style) => new BrickVertex
        {
            Position = new Float3(x, y, z),
            Normal = new Float3(nx, ny, nz),
            R = style.R, G = style.G, B = style.B, A = 1f,
            U0 = u0, V0 = v0, U1 = u1, V1 = v1,
            U2 = (float)style.Material, V2 = style.Seed01,
        };
    }
}
