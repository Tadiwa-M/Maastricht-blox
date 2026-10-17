using System;
using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class StudGeometryTests
    {
        [Theory]
        [InlineData(16, 0.012f)]
        [InlineData(8, 0f)]
        public void AllTrianglesFaceOutward(int segments, float bevel)
        {
            var g = StudGeometry.Build(segments, bevel);
            Assert.Equal(0, g.Indices.Count % 3);
            for (int t = 0; t < g.Indices.Count; t += 3)
            {
                int a = g.Indices[t], b = g.Indices[t + 1], c = g.Indices[t + 2];
                g.Cross(a, b, c, out float nx, out float ny, out float nz);
                // Outward = away from the stud axis, or up for the cap.
                float cx = (g.Positions[3 * a] + g.Positions[3 * b] + g.Positions[3 * c]) / 3f;
                float cz = (g.Positions[3 * a + 2] + g.Positions[3 * b + 2] + g.Positions[3 * c + 2]) / 3f;
                float outward = nx * cx + nz * cz + ny * 1f;
                Assert.True(outward > 0, $"triangle {t / 3} faces inward");
            }
        }

        [Fact]
        public void DimensionsMatchTheBrickSystem()
        {
            var g = StudGeometry.Build(16, 0.012f);
            float maxR = 0, maxY = 0, minY = float.MaxValue;
            for (int v = 0; v < g.VertexCount; v++)
            {
                float x = g.Positions[3 * v], y = g.Positions[3 * v + 1], z = g.Positions[3 * v + 2];
                maxR = Math.Max(maxR, MathF.Sqrt(x * x + z * z));
                maxY = Math.Max(maxY, y);
                minY = Math.Min(minY, y);
            }
            Assert.Equal(0.15f, maxR, 4);        // 0.6 stud diameter * 0.5 m / 2
            Assert.Equal(0.1125f, maxY, 4);      // 1.8 / 3.2 plate * 0.2 m
            Assert.Equal(0f, minY, 4);
        }

        [Fact]
        public void NormalsAreUnitLength()
        {
            var g = StudGeometry.Build(16, 0.012f);
            for (int v = 0; v < g.VertexCount; v++)
            {
                float x = g.Normals[3 * v], y = g.Normals[3 * v + 1], z = g.Normals[3 * v + 2];
                Assert.Equal(1f, MathF.Sqrt(x * x + y * y + z * z), 4);
            }
        }

        [Fact]
        public void VertexAndTriangleCounts()
        {
            // 16 segments with bevel: side 2 rings + bevel 2 rings + cap ring + centre.
            var near = StudGeometry.Build(16, 0.012f);
            Assert.Equal(16 * 5 + 1, near.VertexCount);
            Assert.Equal((16 * 2 * 2 + 16) * 3, near.Indices.Count);
            var mid = StudGeometry.Build(8, 0f);
            Assert.Equal(8 * 3 + 1, mid.VertexCount);
            Assert.Equal((8 * 2 + 8) * 3, mid.Indices.Count);
        }

        [Fact]
        public void RejectsBadParameters()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => StudGeometry.Build(2, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() => StudGeometry.Build(8, 0.1f));
        }
    }
}
