using System.Collections.Generic;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    public class FootprintTests
    {
        [Theory]
        [InlineData(0, 2, 4)]
        [InlineData(1, 4, 2)]
        [InlineData(2, 2, 4)]
        [InlineData(3, 4, 2)]
        public void ExtentSwapsOnOddRotations(int rot, int ei, int ej)
        {
            Footprint.Extent(2, 4, rot, out int a, out int b);
            Assert.Equal((ei, ej), (a, b));
        }

        [Theory]
        [InlineData(0, 0, 1)]
        [InlineData(1, 1, 0)]
        [InlineData(2, 0, -1)]
        [InlineData(3, -1, 0)]
        public void SlopeLowEdgeFollowsContract(int rot, int di, int dj)
        {
            Footprint.SlopeLowEdge(rot, out int a, out int b);
            Assert.Equal((di, dj), (a, b));
        }

        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(3)]
        public void RotateCellIsBijectionOntoRotatedBoxAndInvertible(int rot)
        {
            const int w = 2, d = 3;
            Footprint.Extent(w, d, rot, out int ei, out int ej);
            var seen = new HashSet<(int, int)>();
            for (int a = 0; a < w; a++)
                for (int b = 0; b < d; b++)
                {
                    Footprint.RotateCell(a, b, w, d, rot, out int ci, out int cj);
                    Assert.InRange(ci, 0, ei - 1);
                    Assert.InRange(cj, 0, ej - 1);
                    Assert.True(seen.Add((ci, cj)));
                    Footprint.UnrotateCell(ci, cj, w, d, rot, out int a2, out int b2);
                    Assert.Equal((a, b), (a2, b2));
                    // The cell map agrees with the point map applied to the cell centre.
                    Footprint.RotatePoint(a + 0.5f, b + 0.5f, w, d, rot, out float pi, out float pj);
                    Assert.Equal((ci + 0.5f, cj + 0.5f), (pi, pj));
                }
        }

        [Fact]
        public void RotationIsClockwiseSeenFromAbove()
        {
            // rot 1: local +z (north) becomes +i (east); local +x (east) becomes -j (south).
            Footprint.RotateDir(0, 1, 1, out float di, out float dj);
            Assert.Equal((1f, 0f), (di, dj));
            Footprint.RotateDir(1, 0, 1, out di, out dj);
            Assert.Equal((0f, -1f), (di, dj));
        }

        [Fact]
        public void SlopeBackRowStudsSitOppositeTheLowEdge()
        {
            var t = Repo.Types[Repo.TypeId("slope45_2x2")];
            Assert.True(Footprint.HasStud(t, 0, 0));
            Assert.True(Footprint.HasStud(t, 1, 0));
            Assert.False(Footprint.HasStud(t, 0, 1));
            // rot 1: low edge faces +i, so the studded back row is at i offset 0.
            Footprint.RotateCell(0, 0, t.W, t.D, 1, out int ci, out _);
            Assert.Equal(0, ci);
        }

        [Fact]
        public void DirectionRotationRoundTrips()
        {
            for (int rot = 0; rot < 4; rot++)
                for (int d = 0; d < 6; d++)
                    Assert.Equal(d, Dir.WorldToLocal(Dir.LocalToWorld(d, rot), rot));
            Assert.Equal(Dir.PosX, Dir.LocalToWorld(Dir.PosZ, 1));
            Assert.Equal(Dir.NegZ, Dir.LocalToWorld(Dir.PosZ, 2));
            Assert.Equal(Dir.NegX, Dir.LocalToWorld(Dir.PosZ, 3));
        }
    }
}
