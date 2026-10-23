using System.Collections.Generic;
using System.IO;
using Blox.Data;
using Blox.Data.Json;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    /// <summary>
    /// Rotation rules (CONTRACT section 2): Blox.Data.Rotation must reproduce the shared
    /// vectors in contract/test_vectors/rotation.json exactly, like every other language.
    /// </summary>
    public class RotationTests
    {
        private static JsonNode Vectors() =>
            JsonParser.Parse(File.ReadAllText(Repo.PathOf("contract", "test_vectors", "rotation.json")));

        [Fact]
        public void FacingTableMatchesContractVectors()
        {
            var facing = Vectors()["facing"];
            foreach (string name in facing.Keys)
                Assert.Equal(facing[name].AsInt, Rotation.FacingToRot(Rotation.ParseFacing(name)));
            Assert.Equal(4, facing.Count);
        }

        [Fact]
        public void FrontDirMatchesContractVectors()
        {
            var front = Vectors()["front_dir"];
            foreach (string rot in front.Keys)
            {
                Rotation.FrontDir(int.Parse(rot), out int di, out int dj);
                Assert.Equal((front[rot][0].AsInt, front[rot][1].AsInt), (di, dj));
            }
        }

        [Fact]
        public void EveryContractCaseMatches()
        {
            var cases = Vectors()["cases"].Items;
            Assert.NotEmpty(cases);
            foreach (var c in cases)
            {
                int w = c["w"].AsInt, d = c["d"].AsInt, rot = c["rot"].AsInt;
                Rotation.RotatedExtent(w, d, rot, out int ei, out int ej);
                Assert.Equal((c["extent"][0].AsInt, c["extent"][1].AsInt), (ei, ej));
                Assert.Equal(w * d, c["cells"].Count);
                foreach (var cell in c["cells"].Items)
                {
                    int a = cell[0].AsInt, b = cell[1].AsInt;
                    Rotation.FootprintCell(a, b, w, d, rot, out int di, out int dj);
                    Assert.True((cell[2].AsInt, cell[3].AsInt) == (di, dj), $"w={w} d={d} rot={rot} cell ({a}, {b}) -> ({di}, {dj})");
                    Rotation.UnrotateCell(di, dj, w, d, rot, out int a2, out int b2);
                    Assert.Equal((a, b), (a2, b2));
                }
            }
        }

        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(3)]
        public void CellMapIsPointMapOnCellCentresAndFillsTheBox(int rot)
        {
            const int w = 2, d = 3;
            Rotation.RotatedExtent(w, d, rot, out int ei, out int ej);
            var seen = new HashSet<(int, int)>();
            for (int a = 0; a < w; a++)
                for (int b = 0; b < d; b++)
                {
                    Rotation.FootprintCell(a, b, w, d, rot, out int ci, out int cj);
                    Assert.InRange(ci, 0, ei - 1);
                    Assert.InRange(cj, 0, ej - 1);
                    Assert.True(seen.Add((ci, cj)));
                    Rotation.RotatePoint(a + 0.5f, b + 0.5f, w, d, rot, out float pi, out float pj);
                    Assert.Equal((ci + 0.5f, cj + 0.5f), (pi, pj));
                }
        }

        [Fact]
        public void RotationIsClockwiseSeenFromAboveAndFrontFollowsIt()
        {
            // rot 1: local front (+z = north) becomes +i (east); local +x (east) becomes -j (south).
            Rotation.RotateDir(0, 1, 1, out float di, out float dj);
            Assert.Equal((1f, 0f), (di, dj));
            Rotation.RotateDir(1, 0, 1, out di, out dj);
            Assert.Equal((0f, -1f), (di, dj));
            for (int rot = 0; rot < 4; rot++)
            {
                Rotation.RotateDir(0, 1, rot, out float fx, out float fz);
                Rotation.FrontDir(rot, out int fi, out int fj);
                Assert.Equal(((float)fi, (float)fj), (fx, fz));
            }
        }

        [Fact]
        public void FacingYawRoundTrips()
        {
            Assert.Equal(Facing.E, Rotation.RotToFacing(1));
            Assert.Equal(270f, Rotation.FacingToYawDeg(Facing.W));
            Assert.Equal(Facing.N, Rotation.YawToFacing(-30f));
            Assert.Equal(Facing.E, Rotation.YawToFacing(100f));
            Assert.Equal(Facing.S, Rotation.YawToFacing(181f));
            Assert.Equal(Facing.N, Rotation.YawToFacing(359f));
            Assert.Equal(Facing.S, Rotation.ParseFacing("s"));
            Assert.Throws<System.FormatException>(() => Rotation.ParseFacing("NE"));
        }

        [Fact]
        public void PlacingByFacingSetsTheRot()
        {
            var r = BrickRecord.Place(1, 2, 3, 29, 4, Facing.W, hideStuds: true);
            Assert.Equal(3, r.Rot);
            Assert.Equal(Facing.W, r.Facing);
            Assert.True(r.HideStuds);
            Assert.False(r.NoVariation);
            var p = PlacedBrick.Place(10, 20, 30, 29, 4, Facing.E);
            Assert.Equal(1, p.Rot);
        }

        [Fact]
        public void SlopeBackRowStudsSitOppositeTheFront()
        {
            var t = Repo.Types[Repo.TypeId("slope45_2x2")];
            Assert.True(Footprint.HasStud(t, 0, 0));
            Assert.True(Footprint.HasStud(t, 1, 0));
            Assert.False(Footprint.HasStud(t, 0, 1));
            // Facing E: low edge (front) faces +i, so the studded back row is at i offset 0.
            Rotation.FootprintCell(0, 0, t.W, t.D, Rotation.FacingToRot(Facing.E), out int ci, out _);
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
