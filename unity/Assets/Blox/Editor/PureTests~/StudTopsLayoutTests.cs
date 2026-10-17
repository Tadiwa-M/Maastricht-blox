using System;
using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class StudTopsLayoutTests
    {
        [Fact]
        public void BufferCoversTheWholeSlice()
        {
            Assert.Equal(64 * 64 * 2048, StudTopsLayout.TotalWords);
            Assert.Equal(0, StudTopsLayout.WordOffset(0, 0));
            Assert.Equal(2048, StudTopsLayout.WordOffset(1, 0));
            Assert.Equal(64 * 2048, StudTopsLayout.WordOffset(0, 1));
            Assert.Equal(StudTopsLayout.TotalWords - 2048, StudTopsLayout.WordOffset(63, 63));
            Assert.Throws<ArgumentOutOfRangeException>(() => StudTopsLayout.WordOffset(64, 0));
        }

        [Fact]
        public void ColumnIndexMatchesChunkMajorWordOffset()
        {
            // Global column (I, J) = (70, 130) lies in chunk (1, 2) at local (6, 2).
            int col = StudTopsLayout.ColumnIndex(70, 130);
            Assert.Equal(StudTopsLayout.WordOffset(1, 2) * 2 + 2 * 64 + 6, col);
        }

        [Fact]
        public void AccumulateKeepsHighestStudPerColumnAndIgnoresOtherChunks()
        {
            var tops = new ushort[4096];
            int cx = 3, cy = 5;
            // Stud base centres as Blox.Meshing writes them: ((I + 0.5) * 0.5, K * 0.2, (J + 0.5) * 0.5).
            float X(int li) => (cx * 64 + li + 0.5f) * 0.5f;
            float Z(int lj) => (cy * 64 + lj + 0.5f) * 0.5f;
            StudTopsLayout.Accumulate(tops, cx, cy, X(4), 120 * 0.2f, Z(9));
            StudTopsLayout.Accumulate(tops, cx, cy, X(4), 90 * 0.2f, Z(9));    // lower: ignored
            StudTopsLayout.Accumulate(tops, cx, cy, X(63), 75 * 0.2f, Z(0));
            StudTopsLayout.Accumulate(tops, cx, cy, X(64), 80 * 0.2f, Z(0));   // next chunk: ignored
            Assert.Equal(120, tops[9 * 64 + 4]);
            Assert.Equal(75, tops[0 * 64 + 63]);
            Assert.Equal(2, CountNonZero(tops));
        }

        [Fact]
        public void PackAndDecodeRoundTrip()
        {
            var tops = new ushort[4096];
            var rnd = new Random(7);
            for (int n = 0; n < tops.Length; n++) tops[n] = (ushort)rnd.Next(0, 65536);
            var words = new uint[2048];
            StudTopsLayout.Pack(tops, words);
            for (int lj = 0; lj < 64; lj++)
                for (int li = 0; li < 64; li++)
                    Assert.Equal(tops[lj * 64 + li], StudTopsLayout.Decode(words, li, lj));
            Assert.Equal(tops[0] | ((uint)tops[1] << 16), words[0]);
        }

        [Fact]
        public void RejectsWrongTableSizes()
        {
            Assert.Throws<ArgumentException>(() => StudTopsLayout.Accumulate(new ushort[10], 0, 0, 0, 0, 0));
            Assert.Throws<ArgumentException>(() => StudTopsLayout.Pack(new ushort[4096], new uint[10]));
        }

        private static int CountNonZero(ushort[] a) { int c = 0; foreach (var v in a) if (v != 0) c++; return c; }
    }
}
