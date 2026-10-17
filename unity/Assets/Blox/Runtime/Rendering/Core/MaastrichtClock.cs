using System;

namespace Blox.Rendering
{
    /// <summary>
    /// Netherlands civil time without relying on the OS time-zone database (whose ids differ
    /// between Windows and other platforms): CET (UTC+1), and CEST (UTC+2) from 01:00 UTC on
    /// the last Sunday of March to 01:00 UTC on the last Sunday of October (EU rule).
    /// </summary>
    public static class MaastrichtClock
    {
        public static bool IsSummerTime(DateTime utc)
        {
            utc = AsUtc(utc);
            var start = LastSunday(utc.Year, 3).AddHours(1);
            var end = LastSunday(utc.Year, 10).AddHours(1);
            return utc >= start && utc < end;
        }

        public static int UtcOffsetHours(DateTime utc) => IsSummerTime(utc) ? 2 : 1;

        public static DateTime ToLocal(DateTime utc)
        {
            utc = AsUtc(utc);
            return DateTime.SpecifyKind(utc.AddHours(UtcOffsetHours(utc)), DateTimeKind.Unspecified);
        }

        /// <summary>UTC instant of a local wall-clock time on a given date (hours may be fractional).</summary>
        public static DateTime LocalToUtc(int year, int dayOfYear, double localHours)
        {
            var date = new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddDays(Math.Max(1, dayOfYear) - 1);
            var guess = date.AddHours(localHours - 1);          // assume CET first
            int offset = UtcOffsetHours(guess);
            return date.AddHours(localHours - offset);
        }

        private static DateTime LastSunday(int year, int month)
        {
            var d = new DateTime(year, month, DateTime.DaysInMonth(year, month), 0, 0, 0, DateTimeKind.Utc);
            return d.AddDays(-(int)d.DayOfWeek);
        }

        private static DateTime AsUtc(DateTime t) =>
            t.Kind == DateTimeKind.Local ? t.ToUniversalTime() : DateTime.SpecifyKind(t, DateTimeKind.Utc);
    }
}
