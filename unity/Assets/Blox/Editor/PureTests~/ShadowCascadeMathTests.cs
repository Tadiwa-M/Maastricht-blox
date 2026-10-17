using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class ShadowCascadeMathTests
    {
        [Fact]
        public void ShadowDistanceGrowsWithAltitudeWithinLimits()
        {
            Assert.Equal(60f, ShadowCascadeMath.ShadowDistance(0, 4, 60, 1500));
            Assert.Equal(430f, ShadowCascadeMath.ShadowDistance(100, 4, 60, 1500));
            Assert.Equal(1500f, ShadowCascadeMath.ShadowDistance(10000, 4, 60, 1500));
            Assert.True(ShadowCascadeMath.ShadowDistance(50, 4, 60, 1500) < ShadowCascadeMath.ShadowDistance(80, 4, 60, 1500));
        }

        [Fact]
        public void SplitsAreIncreasingFractions()
        {
            ShadowCascadeMath.PracticalSplits(5, 400, 0.8f, out float a, out float b, out float c);
            Assert.True(0 < a && a < b && b < c && c < 1);
        }

        [Fact]
        public void LambdaZeroIsUniformAndOneIsLogarithmic()
        {
            ShadowCascadeMath.PracticalSplits(1, 100, 0f, out float u1, out float u2, out float u3);
            Assert.Equal((1 + 99 * 0.25f) / 100f, u1, 4);
            Assert.Equal((1 + 99 * 0.5f) / 100f, u2, 4);
            Assert.Equal((1 + 99 * 0.75f) / 100f, u3, 4);
            ShadowCascadeMath.PracticalSplits(1, 100, 1f, out float l1, out float l2, out _);
            Assert.Equal(System.MathF.Pow(100, 0.25f) / 100f, l1, 4);
            Assert.Equal(0.1f, l2, 4);
        }

        [Fact]
        public void ChangedUsesRelativeTolerance()
        {
            Assert.False(ShadowCascadeMath.Changed(100, 103, 0.05f));
            Assert.True(ShadowCascadeMath.Changed(100, 106, 0.05f));
        }
    }
}
