using System;
using System.Collections.Generic;

namespace Blox.Rendering
{
    /// <summary>
    /// Procedural stud mesh in stud-local metres: base centre at the origin, +Y up.
    /// A cylinder (stud diameter 0.6 stud pitch = 0.3 m, height 1.8/3.2 plate = 0.1125 m)
    /// with an optional chamfered top edge and a flat cap; no bottom (it sits on a brick).
    /// Triangles are wound so that cross(b - a, c - a) points outward, which is Unity's front face.
    /// </summary>
    public sealed class StudGeometry
    {
        public const float Radius = 0.15f;
        public const float Height = 0.1125f;

        public readonly List<float> Positions = new List<float>(); // xyz triples
        public readonly List<float> Normals = new List<float>();   // xyz triples
        public readonly List<int> Indices = new List<int>();

        public int VertexCount => Positions.Count / 3;

        /// <param name="segments">Sides around (16 near, 8 mid).</param>
        /// <param name="bevel">Chamfer size in metres (0 = sharp top edge).</param>
        public static StudGeometry Build(int segments, float bevel)
        {
            if (segments < 3) throw new ArgumentOutOfRangeException(nameof(segments));
            if (bevel < 0 || bevel > Radius * 0.5f || bevel > Height * 0.5f) throw new ArgumentOutOfRangeException(nameof(bevel));
            var g = new StudGeometry();
            float sideTop = Height - bevel;
            float capR = Radius - bevel;
            float diag = (float)(1.0 / Math.Sqrt(2.0));

            // Side wall: smooth normals around.
            int side0 = g.Ring(segments, Radius, 0f, 1f, 0f);
            int side1 = g.Ring(segments, Radius, sideTop, 1f, 0f);
            g.Band(segments, side0, side1);

            int capRing;
            if (bevel > 0)
            {
                // 45 degree chamfer, its own ring pair so the edge catches a highlight.
                int b0 = g.Ring(segments, Radius, sideTop, diag, diag);
                int b1 = g.Ring(segments, capR, Height, diag, diag);
                g.Band(segments, b0, b1);
            }
            capRing = g.Ring(segments, capR, Height, 0f, 1f);

            // Flat cap (fan around a centre vertex).
            int centre = g.Vertex(0, Height, 0, 0, 1, 0);
            for (int s = 0; s < segments; s++)
                g.Tri(centre, capRing + s, capRing + (s + 1) % segments, 0, 1, 0);
            return g;
        }

        // Ring of vertices; the normal is (radial * nr, ny) with radial pointing outward.
        private int Ring(int segments, float r, float y, float nr, float ny)
        {
            int first = VertexCount;
            for (int s = 0; s < segments; s++)
            {
                double a = 2 * Math.PI * s / segments;
                float cx = (float)Math.Cos(a), sz = (float)Math.Sin(a);
                Vertex(cx * r, y, sz * r, cx * nr, ny, sz * nr);
            }
            return first;
        }

        // Quads between two rings of equal segment count, wound outward.
        private void Band(int segments, int lower, int upper)
        {
            for (int s = 0; s < segments; s++)
            {
                int s1 = (s + 1) % segments;
                double a = 2 * Math.PI * (s + 0.5) / segments;
                float ox = (float)Math.Cos(a), oz = (float)Math.Sin(a);
                Tri(lower + s, upper + s, upper + s1, ox, 0.5f, oz);
                Tri(lower + s, upper + s1, lower + s1, ox, 0.5f, oz);
            }
        }

        private int Vertex(float x, float y, float z, float nx, float ny, float nz)
        {
            Positions.Add(x); Positions.Add(y); Positions.Add(z);
            float l = (float)Math.Sqrt(nx * nx + ny * ny + nz * nz);
            Normals.Add(nx / l); Normals.Add(ny / l); Normals.Add(nz / l);
            return VertexCount - 1;
        }

        // Adds a triangle, flipping it if needed so its geometric normal agrees with (ox, oy, oz).
        private void Tri(int a, int b, int c, float ox, float oy, float oz)
        {
            Cross(a, b, c, out float nx, out float ny, out float nz);
            if (nx * ox + ny * oy + nz * oz < 0) { int t = b; b = c; c = t; }
            Indices.Add(a); Indices.Add(b); Indices.Add(c);
        }

        /// <summary>cross(p[b] - p[a], p[c] - p[a]).</summary>
        public void Cross(int a, int b, int c, out float nx, out float ny, out float nz)
        {
            float ax = Positions[3 * a], ay = Positions[3 * a + 1], az = Positions[3 * a + 2];
            float ux = Positions[3 * b] - ax, uy = Positions[3 * b + 1] - ay, uz = Positions[3 * b + 2] - az;
            float vx = Positions[3 * c] - ax, vy = Positions[3 * c + 1] - ay, vz = Positions[3 * c + 2] - az;
            nx = uy * vz - uz * vy;
            ny = uz * vx - ux * vz;
            nz = ux * vy - uy * vx;
        }
    }
}
