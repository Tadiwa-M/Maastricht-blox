using System;
using System.Collections.Generic;
using System.Linq;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    /// <summary>Geometric checks shared by mesher tests.</summary>
    public static class MeshAssert
    {
        public static (long, long, long) Key(Float3 p) =>
            ((long)Math.Round(p.X * 10000), (long)Math.Round(p.Y * 10000), (long)Math.Round(p.Z * 10000));

        /// <summary>Every triangle's winding agrees with its vertex normals (Unity front face = cross(b - a, c - a)).</summary>
        public static void WindingMatchesNormals(ListSink s)
        {
            foreach (var (a, b, c, _) in s.Triangles())
            {
                var n = Float3.Cross(b.Position - a.Position, c.Position - a.Position);
                Assert.True(n.Length > 1e-9f, "degenerate triangle");
                var avg = a.Normal + b.Normal + c.Normal;
                Assert.True(Float3.Dot(n, avg) > 0, $"triangle {a.Position} {b.Position} {c.Position} is wound against its normal {avg}");
            }
        }

        /// <summary>Closed, consistently oriented surface: each directed edge has exactly one reverse partner.</summary>
        public static void IsClosedManifold(ListSink s)
        {
            var edges = new Dictionary<((long, long, long), (long, long, long)), int>();
            foreach (var (a, b, c, _) in s.Triangles())
            {
                Add(edges, a.Position, b.Position);
                Add(edges, b.Position, c.Position);
                Add(edges, c.Position, a.Position);
            }
            foreach (var kv in edges)
            {
                Assert.Equal(1, kv.Value);
                Assert.True(edges.TryGetValue((kv.Key.Item2, kv.Key.Item1), out int back) && back == 1,
                    $"edge {kv.Key} has no reverse partner (open or inconsistently wound surface)");
            }
        }

        private static void Add(Dictionary<((long, long, long), (long, long, long)), int> e, Float3 a, Float3 b)
        {
            var k = (Key(a), Key(b));
            e[k] = e.TryGetValue(k, out int n) ? n + 1 : 1;
        }

        /// <summary>Signed volume (m^3) by the divergence theorem; positive for outward-facing closed meshes.</summary>
        public static double Volume(ListSink s)
        {
            // Double precision, relative to the first vertex to avoid float cancellation far from the origin.
            if (s.Vertices.Count == 0) return 0;
            var o = s.Vertices[0].Position;
            double sum = 0;
            foreach (var (a, b, c, _) in s.Triangles())
            {
                double ax = a.Position.X - o.X, ay = a.Position.Y - o.Y, az = a.Position.Z - o.Z;
                double bx = b.Position.X - o.X, by = b.Position.Y - o.Y, bz = b.Position.Z - o.Z;
                double cx = c.Position.X - o.X, cy = c.Position.Y - o.Y, cz = c.Position.Z - o.Z;
                sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
            }
            return sum / 6.0;
        }

        public static int FacesWithNormal(ListSink s, Float3 n, float tol = 1e-4f)
        {
            // Counts distinct triangles whose (flat) normal equals n.
            return s.Triangles().Count(t =>
                Math.Abs(t.a.Normal.X - n.X) < tol && Math.Abs(t.a.Normal.Y - n.Y) < tol && Math.Abs(t.a.Normal.Z - n.Z) < tol);
        }
    }
}
