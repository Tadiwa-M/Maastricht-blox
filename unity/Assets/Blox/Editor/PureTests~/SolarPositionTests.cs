using System;
using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class SolarPositionTests
    {
        private const double Lat = SolarPosition.MaastrichtLatDeg, Lon = SolarPosition.MaastrichtLonDeg;

        private static SunAngles At(int y, int mo, int d, int h, int mi) =>
            SolarPosition.Compute(new DateTime(y, mo, d, h, mi, 0, DateTimeKind.Utc), Lat, Lon);

        /// <summary>Highest elevation of a day, scanning in 1-minute steps.</summary>
        private static (double elev, double az, DateTime when) DayMax(int y, int mo, int d)
        {
            var best = (elev: double.MinValue, az: 0.0, when: DateTime.MinValue);
            for (int m = 0; m < 24 * 60; m++)
            {
                var t = new DateTime(y, mo, d, 0, 0, 0, DateTimeKind.Utc).AddMinutes(m);
                var a = SolarPosition.Compute(t, Lat, Lon);
                if (a.ElevationDeg > best.elev) best = (a.ElevationDeg, a.AzimuthDeg, t);
            }
            return best;
        }

        [Theory]
        // Noon elevation = 90 - lat + declination (+ ~0.01..0.05 deg refraction).
        [InlineData(2026, 6, 21, 62.59)]   // declination +23.44
        [InlineData(2026, 12, 21, 15.73)]  // declination -23.44
        [InlineData(2026, 3, 20, 39.15)]   // equinox, declination ~0
        public void NoonElevationMatchesDeclination(int y, int mo, int d, double expected)
        {
            var max = DayMax(y, mo, d);
            Assert.InRange(max.elev, expected - 0.35, expected + 0.35);
            Assert.InRange(max.az, 179.0, 181.0);
        }

        [Fact]
        public void SolarNoonIsAroundTwentyToTwelveUtc()
        {
            // Longitude 5.69 E puts mean solar noon 22.8 min before 12:00 UTC; the equation of
            // time on 21 June is about -1.8 min, so the true solar noon is ~11:39 UTC.
            var max = DayMax(2026, 6, 21);
            Assert.InRange(max.when.TimeOfDay.TotalMinutes, 11 * 60 + 35, 11 * 60 + 43);
        }

        [Fact]
        public void MidsummerMidnightIsBelowHorizonBySameMargin()
        {
            // Lower culmination: -(90 - lat - decl) = -(90 - 50.85 - 23.44) = -15.71.
            var a = At(2026, 6, 21, 23, 39);
            Assert.InRange(a.ElevationDeg, -16.1, -15.3);
            Assert.InRange(System.Math.Min(a.AzimuthDeg, 360.0 - a.AzimuthDeg), 0.0, 5.0); // due north
        }

        [Fact]
        public void MorningSunIsInTheEastAndEveningInTheWest()
        {
            var morning = At(2026, 6, 21, 6, 0);
            var evening = At(2026, 6, 21, 17, 0);
            Assert.InRange(morning.AzimuthDeg, 60.0, 120.0);
            Assert.InRange(evening.AzimuthDeg, 240.0, 300.0);
            Assert.True(morning.ElevationDeg > 0 && evening.ElevationDeg > 0);
        }

        [Fact]
        public void SunriseOnMidsummerIsAroundHalfPastThreeUtc()
        {
            // Published sunrise for Maastricht on 21 June: ~05:28 CEST = 03:28 UTC, defined by
            // the upper limb at the horizon (apparent centre elevation ~ -0.27 deg).
            DateTime? rise = null;
            for (int m = 0; m < 12 * 60; m++)
            {
                var t = new DateTime(2026, 6, 21, 0, 0, 0, DateTimeKind.Utc).AddMinutes(m);
                if (SolarPosition.Compute(t, Lat, Lon).ElevationDeg > -0.27) { rise = t; break; }
            }
            Assert.NotNull(rise);
            Assert.InRange(rise!.Value.TimeOfDay.TotalMinutes, 3 * 60 + 22, 3 * 60 + 34);
        }

        [Fact]
        public void DirectionToSunIsUnitAndPointsUpAtNoon()
        {
            var max = DayMax(2026, 6, 21);
            SolarPosition.DirectionToSun(new SunAngles(max.elev, max.az), out float x, out float y, out float z);
            Assert.InRange(Math.Sqrt(x * x + y * y + z * z), 0.9999, 1.0001);
            Assert.True(y > 0.85f);   // sin(62.6)
            Assert.True(z < -0.4f);   // sun due south (-Z)
            Assert.InRange(x, -0.02f, 0.02f);
        }

        [Fact]
        public void LocalTimesAreConvertedToUtc()
        {
            var utc = new DateTime(2026, 6, 21, 12, 0, 0, DateTimeKind.Utc);
            var a = SolarPosition.Compute(utc, Lat, Lon);
            var b = SolarPosition.Compute(utc.ToLocalTime(), Lat, Lon);
            Assert.Equal(a.ElevationDeg, b.ElevationDeg, 6);
        }

        [Fact]
        public void RefractionIsSmallAndPositiveNearHorizon()
        {
            Assert.InRange(SolarPosition.Refraction(0), 0.45, 0.62);
            Assert.InRange(SolarPosition.Refraction(45), 0.0, 0.02);
            Assert.Equal(0, SolarPosition.Refraction(-5));
        }
    }
}
