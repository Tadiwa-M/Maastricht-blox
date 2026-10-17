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

        public void Reverse()
        {
            for (int a = 0, b = Count - 1; a < b; a++, b--)
            {
                var t = Get(a);
                Set(a, Get(b));
                Set(b, t);
            }
        }
    }

    /// <summary>Per-brick placement: brick-local grid frame -> chunk-local metres.</summary>
    public struct BrickXform
    {
        public int I, J, K, W, D, Rot;
        public float OriginX, OriginZ;   // chunk SW corner in Unity metres

        public Float3 Point(float x, float y, float z)
        {
            Footprint.RotatePoint(x, z, W, D, Rot, out float oi, out float oj);
            return new Float3((I + oi) * Units.StudM - OriginX, (K + y) * Units.PlateM, (J + oj) * Units.StudM - OriginZ);
        }

        /// <summary>Rotates a local direction (metric) into world axes.</summary>
        public Float3 Direction(Float3 local)
        {
            Footprint.RotateDir(local.X, local.Z, Rot, out float di, out float dj);
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

    /// <summary>Turns polygons into sink vertices/triangles with consistent winding and face UVs.</summary>
    public static class FaceEmitter
    {
        /// <summary>
        /// Emits a convex polygon given in brick-local grid units. The polygon is re-wound so its
        /// geometric normal agrees with <paramref name="outwardHintLocal"/> (Unity: clockwise = front).
        /// </summary>
        public static void EmitLocal<TSink>(ref TSink sink, in BrickXform xf, Poly local, Float3 outwardHintLocal, in FaceStyle style)
            where TSink : struct, IChunkMeshSink
        {
            var world = new Poly();
            for (int n = 0; n < local.Count; n++)
            {
                var p = local.Get(n);
                world.Set(n, xf.Point(p.X, p.Y, p.Z));
            }
            world.Count = local.Count;
            EmitWorld(ref sink, world, xf.Direction(outwardHintLocal), style, true);
        }

        /// <summary>Emits a convex polygon already in chunk-local metres.</summary>
        public static void EmitWorld<TSink>(ref TSink sink, Poly poly, Float3 outwardHint, in FaceStyle style, bool edgeUv)
            where TSink : struct, IChunkMeshSink
        {
            if (poly.Count < 3) return;
            Float3 normal = NewellNormal(poly);
            if (Float3.Dot(normal, outwardHint) < 0) { poly.Reverse(); normal = normal * -1f; }
            normal = normal.Normalized;
            FaceAxes(normal, out Float3 u, out Float3 v);
            float minU = float.MaxValue, minV = float.MaxValue, maxU = float.MinValue, maxV = float.MinValue;
            for (int n = 0; n < poly.Count; n++)
            {
                var p = poly.Get(n);
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
