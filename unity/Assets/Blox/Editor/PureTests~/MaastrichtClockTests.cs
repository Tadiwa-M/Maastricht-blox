using System;
using Blox.Rendering;
using Xunit;

namespace Blox.LookTests
{
    public class MaastrichtClockTests
    {
        [Theory]
        // 2026: DST from Sun 29 March 01:00 UTC to Sun 25 October 01:00 UTC.
        [InlineData(2026, 3, 29, 0, 59, false)]
        [InlineData(2026, 3, 29, 1, 0, true)]
        [InlineData(2026, 7, 1, 12, 0, true)]
        [InlineData(2026, 10, 25, 0, 59, true)]
        [InlineData(2026, 10, 25, 1, 0, false)]
        [InlineData(2026, 12, 24, 12, 0, false)]
        public void SummerTimeFollowsTheEuRule(int y, int mo, int d, int h, int mi, bool summer) =>
            Assert.Equal(summer, MaastrichtClock.IsSummerTime(new DateTime(y, mo, d, h, mi, 0, DateTimeKind.Utc)));

        [Fact]
        public void ToLocalAddsOffset()
        {
            Assert.Equal(new DateTime(2026, 7, 1, 14, 0, 0), MaastrichtClock.ToLocal(new DateTime(2026, 7, 1, 12, 0, 0, DateTimeKind.Utc)));
            Assert.Equal(new DateTime(2026, 1, 1, 13, 0, 0), MaastrichtClock.ToLocal(new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc)));
        }

        [Fact]
        public void LocalToUtcRoundTrips()
        {
            // 21 June 2026 is day 172; 14:30 CEST = 12:30 UTC.
            var utc = MaastrichtClock.LocalToUtc(2026, 172, 14.5);
            Assert.Equal(new DateTime(2026, 6, 21, 12, 30, 0, DateTimeKind.Utc), utc);
            // 15 January (day 15), 08:00 CET = 07:00 UTC.
            Assert.Equal(new DateTime(2026, 1, 15, 7, 0, 0, DateTimeKind.Utc), MaastrichtClock.LocalToUtc(2026, 15, 8));
        }
    }
}
