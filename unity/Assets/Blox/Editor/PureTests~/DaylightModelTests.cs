using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class DaylightModelTests
    {
        private static readonly DaylightTuning K = DaylightTuning.Default;

        [Fact]
        public void NightFactorIsZeroByDayOneByNightAndMonotonic()
        {
            Assert.Equal(0f, DaylightModel.Evaluate(30, K).Night);
            Assert.Equal(0f, DaylightModel.Evaluate(4.5, K).Night);
            Assert.Equal(1f, DaylightModel.Evaluate(-10, K).Night);
            float prev = -1;
            for (double e = 10; e >= -10; e -= 0.5)
            {
                float n = DaylightModel.Evaluate(e, K).Night;
                Assert.True(n >= prev - 1e-6f, $"night factor decreased at {e}");
                prev = n;
            }
        }

        [Fact]
        public void SunIsWarmAtHorizonAndNeutralHigh()
        {
            Assert.Equal(K.HorizonKelvin, DaylightModel.SunKelvin(0, K), 1);
            Assert.Equal(K.HorizonKelvin, DaylightModel.SunKelvin(-5, K), 1);
            Assert.InRange(DaylightModel.SunKelvin(60, K), 5700, K.NoonKelvin);
            Assert.True(DaylightModel.SunKelvin(10, K) < DaylightModel.SunKelvin(20, K));
        }

        [Fact]
        public void SunOffAtNightMoonOffByDay()
        {
            var night = DaylightModel.Evaluate(-15, K);
            var day = DaylightModel.Evaluate(45, K);
            Assert.Equal(0f, night.SunIntensity);
            Assert.Equal(K.MoonIntensity, night.MoonIntensity, 4);
            Assert.Equal(K.SunMaxIntensity, day.SunIntensity, 4);
            Assert.Equal(0f, day.MoonIntensity);
        }

        [Fact]
        public void SunAndMoonAreBothZeroAtTheSwapElevation()
        {
            var s = DaylightModel.Evaluate(DaylightModel.SwapElevationDeg, K);
            Assert.Equal(0f, s.SunIntensity);
            Assert.Equal(0f, s.MoonIntensity);
        }

        [Fact]
        public void AmbientIsDarkerAtNight()
        {
            var night = DaylightModel.Evaluate(-15, K);
            var day = DaylightModel.Evaluate(45, K);
            Assert.True(night.AmbientSky.B < day.AmbientSky.B * 0.3f);
            Assert.True(night.ReflectionIntensity < day.ReflectionIntensity);
            Assert.True(night.SkyExposure < day.SkyExposure);
        }

        [Fact]
        public void SmoothStepHandlesReversedEdges()
        {
            Assert.Equal(0f, DaylightModel.SmoothStep(4, -6, 10));
            Assert.Equal(1f, DaylightModel.SmoothStep(4, -6, -7));
            Assert.Equal(0.5f, DaylightModel.SmoothStep(4, -6, -1), 4);
        }
    }
}
