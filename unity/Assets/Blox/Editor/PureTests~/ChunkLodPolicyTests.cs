using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class ChunkLodPolicyTests
    {
        private static readonly ChunkLodPolicy P = ChunkLodPolicy.Default; // 260 / 600 / 1200, 10 %

        [Theory]
        [InlineData(0f, 0)]
        [InlineData(259f, 0)]
        [InlineData(261f, 1)]
        [InlineData(700f, 2)]
        [InlineData(5000f, 3)]
        public void LevelForDistance(float d, int level) => Assert.Equal(level, P.LevelFor(d));

        [Fact]
        public void FirstChoiceHasNoHysteresis() => Assert.Equal(1, P.Desired(270f, -1));

        [Fact]
        public void CoarseningNeedsToPassTheMargin()
        {
            Assert.Equal(0, P.Desired(270f, 0));   // < 260 * 1.1
            Assert.Equal(1, P.Desired(290f, 0));   // > 286
            Assert.Equal(3, P.Desired(5000f, 0));  // jumps straight to the right level
        }

        [Fact]
        public void RefiningNeedsToPassTheMargin()
        {
            Assert.Equal(1, P.Desired(250f, 1));   // > 260 * 0.9
            Assert.Equal(0, P.Desired(230f, 1));   // < 234
            Assert.Equal(0, P.Desired(10f, 3));
        }

        [Fact]
        public void FactorPerLevel()
        {
            Assert.Equal(1, ChunkLodPolicy.Factor(0));
            Assert.Equal(2, ChunkLodPolicy.Factor(1));
            Assert.Equal(4, ChunkLodPolicy.Factor(2));
            Assert.Equal(8, ChunkLodPolicy.Factor(3));
        }

        [Fact]
        public void DistanceToBox()
        {
            Assert.Equal(0f, ChunkLodPolicy.DistanceToBox(5, 5, 5, 0, 0, 0, 10, 10, 10));
            Assert.Equal(5f, ChunkLodPolicy.DistanceToBox(15, 5, 5, 0, 0, 0, 10, 10, 10), 4);
            Assert.Equal(5f, ChunkLodPolicy.DistanceToBox(13, 14, 5, 0, 0, 0, 10, 10, 10), 4);
        }
    }
}
