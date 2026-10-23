#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>Small fixed-capacity convex polygon (no arrays: Burst- and allocation-friendly).</summary>
    public struct Poly
    {
        public const int Capacity = 6;
        public Float3 P0, P1, P2, P3, P4, P5;
        public int Count;

        public void Add(float x, float y, float z) => Set(Count++, new Float3(x, y, z));

        public Float3 Get(int n) => n switch { 0 => P0, 1 => P1, 2 => P2, 3 => P3, 4 => P4, _ => P5 };

        public void Set(int n, Float3 v)
        {
            switch (n)
            {
                case 0: P0 = v; break;
                case 1: P1 = v; break;
                case 2: P2 = v; break;
                case 3: P3 = v; break;
                case 4: P4 = v; break;
                default: P5 = v; break;
            }
        }

        /// <summary>
        /// Flips the winding but keeps vertex 0 first (reverses 1..n-1), so the triangle fan
        /// still starts at the same corner: a polygon written to avoid a fan through three
        /// collinear points stays valid when flipped.
        /// </summary>
        public void Reverse()
        {
            for (int a = 1, b = Count - 1; a < b; a++, b--)
            {
                var t = Get(a);
                Set(a, Get(b));
                Set(b, t);
            }
        }
    }

    /// <summary>
    /// Per-brick placement: brick-local grid frame (x studs along local +i, y plates up, z studs
    /// along local +j, front at z = d) -> output metres. Chunks pass their SW corner as
    /// OriginX/OriginZ (y stays absolute); models pass a part pivot as OriginX/Y/Z.
    /// </summary>
    public struct BrickXform
    {
        public int I, J, K, W, D, Rot;
        public float OriginX, OriginY, OriginZ;

        public Float3 Point(float x, float y, float z)
        {
            Rotation.RotatePoint(x, z, W, D, Rot, out float oi, out float oj);
            return new Float3((I + oi) * Units.StudM - OriginX, (K + y) * Units.PlateM - OriginY, (J + oj) * Units.StudM - OriginZ);
        }

        /// <summary>Same as <see cref="Point"/> but from brick-local metres (x, y, z), front at z = d * 0.5 m.</summary>
        public Float3 PointM(float xm, float ym, float zm) => Point(xm / Units.StudM, ym / Units.PlateM, zm / Units.StudM);

        /// <summary>Rotates a local direction (metric) into world axes.</summary>
        public Float3 Direction(Float3 local)
        {
            Rotation.RotateDir(local.X, local.Z, Rot, out float di, out float dj);
            return new Float3(di, local.Y, dj);
        }
    }

    /// <summary>Vertex attributes shared by all faces of one brick.</summary>
    public struct FaceStyle
    {
        public float R, G, B;
        public MaterialClass Material;
        public float Seed01;
        public int Submesh => Material.IsTransparent() ? 1 : 0;
    }

    /// <summary>
    /// Turns polygons into sink vertices/triangles with consistent winding and face UVs.
    ///
    /// <para><b>Edge UVs (what the BrickBody shader bevels).</b> UV0 is the position on the face in
    /// metres and UV1 the face size; the shader draws a bevel, a dark seam and crevice shading
    /// near every edge where UV1 &gt; 0. Three ways to control that:</para>
    /// <list type="bullet">
    /// <item>default: the polygon's own bounds are the face, so its outline gets the bevel;</item>
    /// <item><c>frame</c>: a larger polygon (e.g. the whole front of an arch) defines the face, so a
    ///       face built from several convex pieces is bevelled only at the real brick edges;</item>
    /// <item><c>edges = false</c>: UV1 = 0, no bevel and no seam at all. Used for glass panes,
    ///       spindles, studs, and <b>every face whose material class is glass</b>, so window glass
    ///       never shows brick seams (a wall of stacked glass bricks reads as one sheet).</item>
    /// </list>
    /// </summary>
    public static class FaceEmitter
    {
        /// <summary>
        /// Emits a convex polygon given in brick-local grid units. The polygon is re-wound so its
        /// geometric normal agrees with <paramref name="outwardHintLocal"/> (Unity: clockwise = front).
        /// </summary>
        public static void EmitLocal<TSink>(ref TSink sink, in BrickXform xf, Poly local, Float3 outwardHintLocal, in FaceStyle style, bool edges = true)
            where TSink : struct, IChunkMeshSink
        {
            var world = ToWorld(xf, local);
            EmitWorld(ref sink, world, xf.Direction(outwardHintLocal), style, edges);
        }

        /// <summary>Like <see cref="EmitLocal"/>, with the face's edge UVs measured against <paramref name="frameLocal"/>.</summary>
        public static void EmitLocalFramed<TSink>(ref TSink sink, in BrickXform xf, Poly local, Float3 outwardHintLocal, in FaceStyle style, Poly frameLocal)
            where TSink : struct, IChunkMeshSink
        {
            var world = ToWorld(xf, local);
            var frame = ToWorld(xf, frameLocal);
            Emit(ref sink, world, xf.Direction(outwardHintLocal), style, true, true, frame);
        }

        private static Poly ToWorld(in BrickXform xf, in Poly local)
        {
            var world = new Poly();
            for (int n = 0; n < local.Count; n++)
            {
                var p = local.Get(n);
                world.Set(n, xf.Point(p.X, p.Y, p.Z));
            }
            world.Count = local.Count;
            return world;
        }

        /// <summary>Emits a convex polygon already in output metres.</summary>
        public static void EmitWorld<TSink>(ref TSink sink, Poly poly, Float3 outwardHint, in FaceStyle style, bool edgeUv)
            where TSink : struct, IChunkMeshSink => Emit(ref sink, poly, outwardHint, style, edgeUv, false, default);

        private static void Emit<TSink>(ref TSink sink, Poly poly, Float3 outwardHint, in FaceStyle style, bool edgeUv, bool hasFrame, in Poly frame)
            where TSink : struct, IChunkMeshSink
        {
            if (poly.Count < 3) return;
            if (style.Material == MaterialClass.Glass) edgeUv = false;
            Float3 normal = NewellNormal(poly);
            if (Float3.Dot(normal, outwardHint) < 0) { poly.Reverse(); normal = normal * -1f; }
            normal = normal.Normalized;
            FaceAxes(normal, out Float3 u, out Float3 v);
            float minU = float.MaxValue, minV = float.MaxValue, maxU = float.MinValue, maxV = float.MinValue;
            var bounds = hasFrame ? frame : poly;
            for (int n = 0; n < bounds.Count; n++)
            {
                var p = bounds.Get(n);
                float pu = Float3.Dot(p, u), pv = Float3.Dot(p, v);
                minU = Math.Min(minU, pu); maxU = Math.Max(maxU, pu);
                minV = Math.Min(minV, pv); maxV = Math.Max(maxV, pv);
            }
            int baseIndex = sink.VertexCount;
            for (int n = 0; n < poly.Count; n++)
            {
                var p = poly.Get(n);
                var vert = new BrickVertex
                {
                    Position = p,
                    Normal = normal,
                    R = style.R, G = style.G, B = style.B, A = 1f,
                    U0 = Float3.Dot(p, u) - minU,
                    V0 = Float3.Dot(p, v) - minV,
                    U1 = edgeUv ? maxU - minU : 0f,
                    V1 = edgeUv ? maxV - minV : 0f,
                    U2 = (float)style.Material,
                    V2 = style.Seed01,
                };
                sink.AddVertex(vert);
            }
            for (int n = 1; n + 1 < poly.Count; n++) sink.AddTriangle(style.Submesh, baseIndex, baseIndex + n, baseIndex + n + 1);
        }

        /// <summary>Polygon normal by Newell's method (robust to collinear leading vertices).</summary>
        public static Float3 NewellNormal(in Poly poly)
        {
            float nx = 0, ny = 0, nz = 0;
            for (int n = 0; n < poly.Count; n++)
            {
                var a = poly.Get(n);
                var b = poly.Get((n + 1) % poly.Count);
                nx += (a.Y - b.Y) * (a.Z + b.Z);
                ny += (a.Z - b.Z) * (a.X + b.X);
                nz += (a.X - b.X) * (a.Y + b.Y);
            }
            // Same direction as cross(p1 - p0, p2 - p0) for a convex polygon, which is the side
            // Unity treats as front (clockwise seen from the viewer in its left-handed space).
            return new Float3(nx, ny, nz);
        }

        /// <summary>Face tangent frame: u horizontal, v "up the face" (or +z on horizontal faces).</summary>
        public static void FaceAxes(Float3 n, out Float3 u, out Float3 v)
        {
            if (Math.Abs(n.Y) > 0.999f)
            {
                u = new Float3(1, 0, 0);
                v = new Float3(0, 0, 1);
                return;
            }
            u = Float3.Cross(new Float3(0, 1, 0), n).Normalized;
            v = Float3.Cross(n, u).Normalized;
        }
    }
}
