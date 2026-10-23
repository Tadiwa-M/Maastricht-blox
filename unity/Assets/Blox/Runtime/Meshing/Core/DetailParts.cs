#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Everything a detail piece needs to emit its parts, in the piece's local metre frame
    /// (see <see cref="DetailShapes"/>): the brick, its transform, the chunk context and the
    /// two styles (record colour, and glass for panes).
    /// </summary>
    public ref struct DetailContext
    {
        public PlacedBrick Brick;
        public BrickTypeInfo Type;
        public BrickXform Xf;
        public MeshContext Mesh;
        public FaceStyle Body;
        public FaceStyle Glass;
    }

    /// <summary>
    /// Building blocks for detail pieces: axis-aligned boxes, single quads and round posts.
    /// A face that lies on the piece's bounding box is dropped when every cell face it touches
    /// is hidden by the neighbour (same rule as ordinary bricks, <see cref="CellGrid.FaceHidden"/>);
    /// faces inside the box (frame insides, glass, the arch hole) are always emitted.
    /// </summary>
    public static class DetailParts
    {
        /// <summary>Bit per local <see cref="Dir"/>: faces of a box to leave out (they touch another part).</summary>
        public static int Skip(int dir) => 1 << dir;

        /// <summary>Emits a closed box [x0,x1] x [y0,y1] x [z0,z1] (local metres), minus <paramref name="skipMask"/> faces.</summary>
        public static void Box<TSink>(ref TSink sink, in DetailContext c, in FaceStyle style,
                                      float x0, float x1, float y0, float y1, float z0, float z1, int skipMask = 0, bool edges = true)
            where TSink : struct, IChunkMeshSink
        {
            if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
            for (int dir = 0; dir < 6; dir++)
            {
                if ((skipMask & (1 << dir)) != 0) continue;
                if (OnBoundaryAndHidden(c, dir, x0, x1, y0, y1, z0, z1, style.Material)) continue;
                var p = new Poly();
                switch (dir)
                {
                    case Dir.NegX: p.Add(x0, y0, z0); p.Add(x0, y0, z1); p.Add(x0, y1, z1); p.Add(x0, y1, z0); break;
                    case Dir.PosX: p.Add(x1, y0, z0); p.Add(x1, y1, z0); p.Add(x1, y1, z1); p.Add(x1, y0, z1); break;
                    case Dir.NegZ: p.Add(x0, y0, z0); p.Add(x0, y1, z0); p.Add(x1, y1, z0); p.Add(x1, y0, z0); break;
                    case Dir.PosZ: p.Add(x0, y0, z1); p.Add(x1, y0, z1); p.Add(x1, y1, z1); p.Add(x0, y1, z1); break;
                    case Dir.NegY: p.Add(x0, y0, z0); p.Add(x1, y0, z0); p.Add(x1, y0, z1); p.Add(x0, y0, z1); break;
                    default: p.Add(x0, y1, z0); p.Add(x0, y1, z1); p.Add(x1, y1, z1); p.Add(x1, y1, z0); break;
                }
                Emit(ref sink, c, p, Normal(dir), style, edges);
            }
        }

        /// <summary>Emits one convex polygon given in local metres, facing <paramref name="outward"/>.</summary>
        public static void Emit<TSink>(ref TSink sink, in DetailContext c, Poly metres, Float3 outward, in FaceStyle style, bool edges = true)
            where TSink : struct, IChunkMeshSink
        {
            FaceEmitter.EmitLocal(ref sink, c.Xf, ToGrid(metres), outward, style, edges);
        }

        /// <summary>Emits one piece of a larger face; bevel edges are measured on <paramref name="frameMetres"/>.</summary>
        public static void EmitFramed<TSink>(ref TSink sink, in DetailContext c, Poly metres, Float3 outward, in FaceStyle style, Poly frameMetres)
            where TSink : struct, IChunkMeshSink
        {
            FaceEmitter.EmitLocalFramed(ref sink, c.Xf, ToGrid(metres), outward, style, ToGrid(frameMetres));
        }

        /// <summary>
        /// Vertical round post (low-poly prism with smooth side normals and flat caps) centred at
        /// (cx, cz), radius r, from y0 to y1, all local metres. No bevel edges (UV1 = 0). Leave the
        /// caps out when the ends are buried in other parts (fence spindles in their rails).
        /// </summary>
        public static void Post<TSink>(ref TSink sink, in DetailContext c, in FaceStyle style, float cx, float cz, float r, float y0, float y1, int segments, bool caps = true)
            where TSink : struct, IChunkMeshSink
        {
            float height = y1 - y0;
            for (int s = 0; s < segments; s++)
            {
                Angle(s, segments, out float ca, out float sa);
                Angle(s + 1, segments, out float cb, out float sb);
                var na = c.Xf.Direction(new Float3(ca, 0, sa));
                var nb = c.Xf.Direction(new Float3(cb, 0, sb));
                int i0 = sink.VertexCount;
                sink.AddVertex(Vertex(c.Xf.PointM(cx + ca * r, y0, cz + sa * r), na, 0, 0, style));
                sink.AddVertex(Vertex(c.Xf.PointM(cx + cb * r, y0, cz + sb * r), nb, 0, 0, style));
                sink.AddVertex(Vertex(c.Xf.PointM(cx + cb * r, y1, cz + sb * r), nb, 0, height, style));
                sink.AddVertex(Vertex(c.Xf.PointM(cx + ca * r, y1, cz + sa * r), na, 0, height, style));
                // Same winding as RoundMesher: outward for the rot-0 frame, and every rot is a proper
                // rotation about +y (no mirroring), so it stays outward after placing.
                sink.AddTriangle(style.Submesh, i0, i0 + 3, i0 + 2);
                sink.AddTriangle(style.Submesh, i0, i0 + 2, i0 + 1);
            }
            for (int end = 0; caps && end < 2; end++)
            {
                var cap = new Poly();
                float y = end == 0 ? y0 : y1;
                // A cap of 6 or fewer sides fits one Poly; larger posts would need a fan.
                int n = Math.Min(segments, Poly.Capacity);
                for (int s = 0; s < n; s++)
                {
                    Angle(s, n, out float ca, out float sa);
                    cap.Add(cx + ca * r, y, cz + sa * r);
                }
                Emit(ref sink, c, cap, new Float3(0, end == 0 ? -1 : 1, 0), style, false);
            }
        }

        // ---- helpers --------------------------------------------------------------------

        private static Poly ToGrid(in Poly m)
        {
            var g = new Poly();
            for (int n = 0; n < m.Count; n++)
            {
                var p = m.Get(n);
                g.Add(p.X / Units.StudM, p.Y / Units.PlateM, p.Z / Units.StudM);
            }
            return g;
        }

        public static Float3 Normal(int dir) => new Float3(Dir.Di(dir), Dir.Dk(dir), Dir.Dj(dir));

        /// <summary>
        /// True when the box face on local side <paramref name="dir"/> lies on the piece's bounding
        /// box and every boundary cell face it overlaps is hidden by the neighbouring cell.
        /// </summary>
        private static bool OnBoundaryAndHidden(in DetailContext c, int dir, float x0, float x1, float y0, float y1, float z0, float z1, MaterialClass self)
        {
            DetailShapes.SizeM(c.Type, out float w, out float h, out float d);
            const float eps = 1e-4f;
            bool onBoundary = dir switch
            {
                Dir.NegX => x0 <= eps, Dir.PosX => x1 >= w - eps,
                Dir.NegZ => z0 <= eps, Dir.PosZ => z1 >= d - eps,
                Dir.NegY => y0 <= eps, _ => y1 >= h - eps,
            };
            if (!onBoundary) return false;
            int a0 = Cell(x0, Units.StudM, c.Type.W, false), a1 = Cell(x1, Units.StudM, c.Type.W, true);
            int b0 = Cell(z0, Units.StudM, c.Type.D, false), b1 = Cell(z1, Units.StudM, c.Type.D, true);
            int p0 = Cell(y0, Units.PlateM, c.Type.H, false), p1 = Cell(y1, Units.PlateM, c.Type.H, true);
            switch (dir)
            {
                case Dir.NegX: a1 = 0; break;
                case Dir.PosX: a0 = c.Type.W - 1; break;
                case Dir.NegZ: b1 = 0; break;
                case Dir.PosZ: b0 = c.Type.D - 1; break;
                case Dir.NegY: p1 = 0; break;
                default: p0 = c.Type.H - 1; break;
            }
            int rot = c.Brick.Rot, worldDir = Dir.LocalToWorld(dir, rot);
            for (int p = p0; p <= p1; p++)
                for (int b = b0; b <= b1; b++)
                    for (int a = a0; a <= a1; a++)
                    {
                        Rotation.FootprintCell(a, b, c.Type.W, c.Type.D, rot, out int ci, out int cj);
                        if (!CellGrid.FaceHidden(c.Mesh.Cells, c.Mesh.Dims, c.Brick.I + ci, c.Brick.J + cj, c.Brick.K + p, worldDir, self))
                            return false;
                    }
            return true;
        }

        /// <summary>First (lo) or last (hi) cell index overlapped by a metre coordinate, clamped to [0, n-1].</summary>
        private static int Cell(float m, float unit, int n, bool hi)
        {
            float u = m / unit;
            int c = hi ? (int)Math.Ceiling(u - 1e-3f) - 1 : (int)Math.Floor(u + 1e-3f);
            return Math.Max(0, Math.Min(n - 1, c));
        }

        private static void Angle(int s, int n, out float c, out float sn)
        {
            double a = 2.0 * Math.PI * s / n;
            c = (float)Math.Cos(a);
            sn = (float)Math.Sin(a);
        }

        private static BrickVertex Vertex(Float3 p, Float3 n, float u0, float v0, in FaceStyle style) => new BrickVertex
        {
            Position = p,
            Normal = n,
            R = style.R, G = style.G, B = style.B, A = 1f,
            U0 = u0, V0 = v0, U1 = 0, V1 = 0,
            U2 = (float)style.Material, V2 = style.Seed01,
        };
    }
}
