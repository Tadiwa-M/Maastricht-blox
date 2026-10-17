using System;

namespace Blox.Rendering
{
    /// <summary>Sun direction in horizontal coordinates.</summary>
    public readonly struct SunAngles
    {
        /// <summary>Apparent elevation above the horizon in degrees (refraction included).</summary>
        public readonly double ElevationDeg;
        /// <summary>Azimuth in degrees clockwise from true north (90 = east).</summary>
        public readonly double AzimuthDeg;

        public SunAngles(double elevationDeg, double azimuthDeg)
        {
            ElevationDeg = elevationDeg;
            AzimuthDeg = azimuthDeg;
        }

        public override string ToString() => $"elev {ElevationDeg:0.00} deg, az {AzimuthDeg:0.00} deg";
    }

    /// <summary>
    /// Solar position from the NOAA solar calculator equations (Meeus, "Astronomical
    /// Algorithms"); accurate to well under 0.1 degree for years 1900-2100, which is far more
    /// than a shadow needs. Engine-free so it is unit tested with dotnet.
    /// </summary>
    public static class SolarPosition
    {
        /// <summary>Maastricht (Vrijthof), WGS84.</summary>
        public const double MaastrichtLatDeg = 50.8514;
        public const double MaastrichtLonDeg = 5.6910;

        private const double Deg = Math.PI / 180.0;

        /// <param name="utc">Instant (converted to UTC if it is not already).</param>
        /// <param name="latDeg">Latitude, north positive.</param>
        /// <param name="lonDeg">Longitude, east positive.</param>
        public static SunAngles Compute(DateTime utc, double latDeg, double lonDeg)
        {
            if (utc.Kind == DateTimeKind.Local) utc = utc.ToUniversalTime();
            double jd = utc.ToOADate() + 2415018.5;            // OLE automation date -> Julian day
            double t = (jd - 2451545.0) / 36525.0;             // Julian centuries since J2000

            double l0 = Mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
            double m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
            double e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
            double c = Math.Sin(m * Deg) * (1.914602 - t * (0.004817 + 0.000014 * t))
                     + Math.Sin(2 * m * Deg) * (0.019993 - 0.000101 * t)
                     + Math.Sin(3 * m * Deg) * 0.000289;
            double trueLong = l0 + c;
            double omega = 125.04 - 1934.136 * t;
            double lambda = trueLong - 0.00569 - 0.00478 * Math.Sin(omega * Deg);
            double eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
            double eps = eps0 + 0.00256 * Math.Cos(omega * Deg);
            double decl = Math.Asin(Math.Sin(eps * Deg) * Math.Sin(lambda * Deg));

            double y = Math.Tan(eps * Deg / 2);
            y *= y;
            double eqTimeMin = 4 / Deg * (y * Math.Sin(2 * l0 * Deg)
                                          - 2 * e * Math.Sin(m * Deg)
                                          + 4 * e * y * Math.Sin(m * Deg) * Math.Cos(2 * l0 * Deg)
                                          - 0.5 * y * y * Math.Sin(4 * l0 * Deg)
                                          - 1.25 * e * e * Math.Sin(2 * m * Deg));

            double minutesUtc = utc.TimeOfDay.TotalMinutes;
            double trueSolarMin = Mod(minutesUtc + eqTimeMin + 4 * lonDeg, 1440);
            double hourAngle = trueSolarMin / 4 - 180;          // degrees, negative before solar noon

            double lat = latDeg * Deg, ha = hourAngle * Deg;
            double cosZen = Math.Sin(lat) * Math.Sin(decl) + Math.Cos(lat) * Math.Cos(decl) * Math.Cos(ha);
            cosZen = Math.Max(-1, Math.Min(1, cosZen));
            double elevation = 90 - Math.Acos(cosZen) / Deg;

            double az = Math.Atan2(Math.Sin(ha), Math.Cos(ha) * Math.Sin(lat) - Math.Tan(decl) * Math.Cos(lat)) / Deg + 180;
            return new SunAngles(elevation + Refraction(elevation), Mod360(az));
        }

        /// <summary>Atmospheric refraction in degrees (Saemundsson/Bennett), 0 well below the horizon.</summary>
        public static double Refraction(double elevationDeg)
        {
            if (elevationDeg < -1.0) return 0;
            double h = Math.Max(elevationDeg, -0.9);
            return 1.02 / Math.Tan((h + 10.3 / (h + 5.11)) * Deg) / 60.0;
        }

        /// <summary>Unit vector pointing from the ground toward the sun in Unity axes (x east, y up, z north).</summary>
        public static void DirectionToSun(in SunAngles a, out float x, out float y, out float z)
        {
            double el = a.ElevationDeg * Deg, az = a.AzimuthDeg * Deg;
            x = (float)(Math.Sin(az) * Math.Cos(el));
            y = (float)Math.Sin(el);
            z = (float)(Math.Cos(az) * Math.Cos(el));
        }

        private static double Mod360(double v) => Mod(v, 360);
        private static double Mod(double v, double m) { double r = v % m; return r < 0 ? r + m : r; }
    }
}
