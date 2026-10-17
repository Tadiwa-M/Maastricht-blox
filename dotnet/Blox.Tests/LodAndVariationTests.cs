using System;
using System.Collections.Generic;
using System.Linq;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;
using static Blox.Tests.MeshRunner;

namespace Blox.Tests
{
    public class LodTests
    {
        private static ListSink RunLod(int factor, PlacedBrick[] own, int cx = 0, int cy = 0)
        {
            var types = Repo.Types.AsSpan();
            var dims = LodMesherCore.ComputeDims(own, types, cx * 64, cy * 64, factor);
            var sink = ListSink.Create();
            if (dims.NK == 0) return sink;
            var color = new byte[dims.Length];
            var topK = new int[dims.Length];
            var mask = new byte[LodMesherCore.MaskSize(dims)];
            LodMesherCore.Downsample(own, types, dims, color, topK);
            LodMesherCore.Build(ref sink, dims, color, Repo.Colors, mask, cx * 32f, cy * 32f);
            return sink;
        }

        [Theory]
        [InlineData(2)]
        [InlineData(4)]
        [InlineData(8)]
        public void SingleBrickBecomesOneCoarseBox(int factor)
        {
            var s = RunLod(factor, new[] { Brick("brick_1x1", 3, 3, 52) });
            Assert.Equal(12, s.TriangleCount(0));
            Assert.Empty(s.Studs);
            MeshAssert.WindingMatchesNormals(s);
            MeshAssert.IsClosedManifold(s);
            int fk = factor * 5 / 2;
            double edge = factor * 0.5, height = fk * 0.2;
            Assert.Equal(edge * edge * height, MeshAssert.Volume(s), 5);
            Assert.All(s.Vertices, v => Assert.Equal((0f, 0f), (v.U1, v.V1)));
        }

        [Fact]
        public void FlatLayerGreedyMergesToSixQuads()
        {
            var bricks = new List<PlacedBrick>();
            for (int j = 0; j < 64; j += 4)
                for (int i = 0; i < 64; i += 4)
                    bricks.Add(Brick("plate_4x4", i, j, 100, color: 26));
            var s = RunLod(8, bricks.ToArray());
            Assert.Equal(12, s.TriangleCount(0));
            MeshAssert.IsClosedManifold(s);
        }

        [Fact]
        public void CoarseCellTakesTopmostColourAndTransparentGoesToSubmeshOne()
        {
            var s = RunLod(2, new[] { Brick("plate_1x1", 0, 0, 0, color: 4), Brick("plate_1x1", 1, 1, 1, color: 13) });
            var expected = Repo.Colors[13];
            Assert.All(s.Vertices, v => Assert.Equal(expected.R, v.R));
            var w = RunLod(2, new[] { Brick("plate_1x1", 0, 0, 0, color: 32) });
            Assert.Equal(12, w.TriangleCount(1));
        }

        [Fact]
        public void HollowShellKeepsItsWalls()
        {
            // A 1-stud thick ring wall around an empty 6x6 courtyard survives factor 4 downsampling.
            var bricks = new List<PlacedBrick>();
            for (int n = 0; n < 8; n++)
            {
                bricks.Add(Brick("brick_1x1", n, 0, 0)); bricks.Add(Brick("brick_1x1", n, 7, 0));
                if (n > 0 && n < 7) { bricks.Add(Brick("brick_1x1", 0, n, 0)); bricks.Add(Brick("brick_1x1", 7, n, 0)); }
            }
            var s = RunLod(4, bricks.ToArray());
            Assert.True(s.TriangleCount(0) > 0);
            Assert.Equal(8 * 0.5 * 8 * 0.5 * 10 * 0.2, MeshAssert.Volume(s), 4); // 2x2 coarse cells of 2 m x 2 m x 2 m (any-occupied)
        }

        [Fact]
        public void RejectsUnsupportedFactor()
        {
            Assert.Throws<ArgumentException>(() => LodMesherCore.ComputeDims(Array.Empty<PlacedBrick>(), Repo.Types, 0, 0, 3));
        }
    }

    public class VariationTests
    {
        [Fact]
        public void SeedIsDeterministicAndPinned()
        {
            // Pinned values: the HLSL mirror must reproduce these exactly (see BrickVariation docs).
            Assert.Equal(BrickVariation.Seed(970, 2434, 100), BrickVariation.Seed(970, 2434, 100));
            Assert.Equal(PcgReference(unchecked(0x8DA6B343u * 1u ^ 0xD8163841u * 2u ^ 0xCB1AB31Fu * 3u)), BrickVariation.Seed(1, 2, 3));
            // Independently computed in Python (32-bit masked arithmetic).
            Assert.Equal(129708002u, BrickVariation.Pcg(0));
            Assert.Equal(438766412u, BrickVariation.Seed(1, 2, 3));
            Assert.Equal(3704521945u, BrickVariation.Seed(970, 2434, 100));
            Assert.Equal(4197473905u, BrickVariation.Seed(-1, 0, 0));
        }

        /// <summary>Independent re-implementation of PCG-RXS-M-XS 32 with 64-bit arithmetic masked to 32 bits.</summary>
        private static uint PcgReference(uint v)
        {
            ulong state = ((ulong)v * 747796405UL + 2891336453UL) & 0xFFFFFFFFUL;
            int shift = (int)((state >> 28) + 4);
            ulong word = (((state >> shift) ^ state) * 277803737UL) & 0xFFFFFFFFUL;
            return (uint)((word >> 22) ^ word);
        }

        [Fact]
        public void JitterStaysWithinAmplitudesAndIsSpread()
        {
            var values = new HashSet<int>();
            for (int i = 0; i < 64; i++)
                for (int j = 0; j < 64; j++)
                {
                    uint s = BrickVariation.Seed(i, j, 7);
                    Assert.InRange(BrickVariation.ValueJitter(s), -BrickVariation.ValueAmplitude, BrickVariation.ValueAmplitude);
                    Assert.InRange(BrickVariation.WarmthJitter(s), -BrickVariation.WarmthAmplitude, BrickVariation.WarmthAmplitude);
                    Assert.InRange(BrickVariation.StudAngleDeg(s), 0f, 360f);
                    Assert.InRange(BrickVariation.Seed01(s), 0f, 1f);
                    values.Add((int)(s & 0xFF));
                }
            Assert.True(values.Count > 200); // neighbouring cells do not collapse onto few values
        }

        [Fact]
        public void NoVariationKeepsExactColour()
        {
            float r = 0.3f, g = 0.4f, b = 0.5f;
            BrickVariation.Apply(BrickVariation.Seed(1, 1, 1), true, ref r, ref g, ref b);
            Assert.Equal((0.3f, 0.4f, 0.5f), (r, g, b));
        }
    }
}
