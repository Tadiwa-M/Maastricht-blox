#nullable enable
using System.Collections.Generic;

namespace Blox.Live
{
    // DTOs for the live proxy API (CONTRACT section 8). Positions are Unity world metres [x, z].
    // Times are Unix seconds (UTC), kept as double.

    public sealed class SourceStatus
    {
        public bool Ok { get; set; }
        public double? LastFetch { get; set; }
        public string? Error { get; set; }
    }

    public sealed class HealthDto
    {
        public bool Ok { get; set; }
        public Dictionary<string, SourceStatus> Sources { get; } = new Dictionary<string, SourceStatus>();
    }

    public sealed class VehicleDto
    {
        public string Id { get; set; } = "";
        public string Mode { get; set; } = "";
        public string? Operator { get; set; }
        public string? RouteShort { get; set; }
        public string? RouteId { get; set; }
        public string? TripId { get; set; }
        public string? Headsign { get; set; }
        public string? ShapeId { get; set; }
        public double? Lat { get; set; }
        public double? Lon { get; set; }
        public float WorldX { get; set; }
        public float WorldZ { get; set; }
        public float? BearingDeg { get; set; }
        public float? SpeedMps { get; set; }
        public double? DistAlongShapeM { get; set; }
        public int? DelaySec { get; set; }
        public double ObservedTs { get; set; }
    }

    public sealed class VehiclesDto
    {
        public double Ts { get; set; }
        public List<VehicleDto> Vehicles { get; } = new List<VehicleDto>();
    }

    public sealed class ShapeDto
    {
        public string ShapeId { get; set; } = "";
        public string? RouteShort { get; set; }
        public string? Mode { get; set; }
        public string? Color { get; set; }
        /// <summary>Points as parallel arrays: world x, world z, cumulative distance (m).</summary>
        public float[] X { get; set; } = System.Array.Empty<float>();
        public float[] Z { get; set; } = System.Array.Empty<float>();
        public float[] CumDistM { get; set; } = System.Array.Empty<float>();
    }

    public sealed class ShapesDto
    {
        public List<ShapeDto> Shapes { get; } = new List<ShapeDto>();
    }

    public sealed class StopDto
    {
        public string StopId { get; set; } = "";
        public string Name { get; set; } = "";
        public float WorldX { get; set; }
        public float WorldZ { get; set; }
    }

    public sealed class StopsDto
    {
        public List<StopDto> Stops { get; } = new List<StopDto>();
    }

    public enum WeatherCondition { Clear, PartlyCloudy, Cloudy, Rain, HeavyRain, Snow, Fog, Thunder, Unknown }

    public sealed class WeatherDto
    {
        public double Ts { get; set; }
        public float? TempC { get; set; }
        public float? PrecipMmH { get; set; }
        public float? CloudPct { get; set; }
        public float? WindMps { get; set; }
        public float? WindDirDeg { get; set; }
        public WeatherCondition Condition { get; set; } = WeatherCondition.Unknown;
        public double? Sunrise { get; set; }
        public double? Sunset { get; set; }
        public string? Source { get; set; }
    }

    public enum WaterTrend { Steady, Rising, Falling, Unknown }

    public sealed class WaterDto
    {
        public double Ts { get; set; }
        public string? Station { get; set; }
        public float? LevelMNap { get; set; }
        public WaterTrend Trend { get; set; } = WaterTrend.Unknown;
        public string? Source { get; set; }
    }
}
