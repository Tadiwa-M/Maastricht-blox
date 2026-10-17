#nullable enable
using System;
using Blox.Data.Json;

namespace Blox.Live
{
    /// <summary>Parses proxy API responses (CONTRACT section 8). Throws <see cref="JsonException"/> / <see cref="FormatException"/> on bad input.</summary>
    public static class LiveJson
    {
        public static HealthDto ParseHealth(string json)
        {
            var n = JsonParser.Parse(json);
            var h = new HealthDto { Ok = n["ok"].AsBool };
            var sources = n.Get("sources");
            if (!sources.IsNull)
                foreach (var key in sources.Keys)
                {
                    var s = sources[key];
                    h.Sources[key] = new SourceStatus { Ok = s["ok"].AsBool, LastFetch = s.OptDouble("lastFetch"), Error = s.OptString("error") };
                }
            return h;
        }

        public static VehiclesDto ParseVehicles(string json)
        {
            var n = JsonParser.Parse(json);
            var r = new VehiclesDto { Ts = n["ts"].AsDouble };
            foreach (var v in n["vehicles"].Items) r.Vehicles.Add(ParseVehicle(v));
            return r;
        }

        public static VehicleDto ParseVehicle(JsonNode v)
        {
            var world = v["world"];
            if (world.Count != 2) throw new FormatException("vehicle.world must be [x, z]");
            return new VehicleDto
            {
                Id = v["id"].AsString,
                Mode = v.OptString("mode") ?? "bus",
                Operator = v.OptString("operator"),
                RouteShort = v.OptString("routeShort"),
                RouteId = v.OptString("routeId"),
                TripId = v.OptString("tripId"),
                Headsign = v.OptString("headsign"),
                ShapeId = v.OptString("shapeId"),
                Lat = v.OptDouble("lat"),
                Lon = v.OptDouble("lon"),
                WorldX = world[0].AsFloat,
                WorldZ = world[1].AsFloat,
                BearingDeg = (float?)v.OptDouble("bearingDeg"),
                SpeedMps = (float?)v.OptDouble("speedMps"),
                DistAlongShapeM = v.OptDouble("distAlongShapeM"),
                DelaySec = v.OptInt("delaySec"),
                ObservedTs = v["observedTs"].AsDouble,
            };
        }

        public static ShapesDto ParseShapes(string json)
        {
            var n = JsonParser.Parse(json);
            var r = new ShapesDto();
            foreach (var s in n["shapes"].Items)
            {
                var pts = s["points"].Items;
                var dto = new ShapeDto
                {
                    ShapeId = s["shapeId"].AsString,
                    RouteShort = s.OptString("routeShort"),
                    Mode = s.OptString("mode"),
                    Color = s.OptString("color"),
                    X = new float[pts.Count],
                    Z = new float[pts.Count],
                    CumDistM = new float[pts.Count],
                };
                for (int i = 0; i < pts.Count; i++)
                {
                    var p = pts[i];
                    if (p.Count < 3) throw new FormatException($"shape {dto.ShapeId}: point {i} needs [x, z, cumDistM]");
                    dto.X[i] = p[0].AsFloat;
                    dto.Z[i] = p[1].AsFloat;
                    dto.CumDistM[i] = p[2].AsFloat;
                }
                r.Shapes.Add(dto);
            }
            return r;
        }

        public static StopsDto ParseStops(string json)
        {
            var n = JsonParser.Parse(json);
            var r = new StopsDto();
            foreach (var s in n["stops"].Items)
            {
                var w = s["world"];
                r.Stops.Add(new StopDto { StopId = s["stopId"].AsString, Name = s.OptString("name") ?? "", WorldX = w[0].AsFloat, WorldZ = w[1].AsFloat });
            }
            return r;
        }

        public static WeatherDto ParseWeather(string json)
        {
            var n = JsonParser.Parse(json);
            return new WeatherDto
            {
                Ts = n["ts"].AsDouble,
                TempC = (float?)n.OptDouble("tempC"),
                PrecipMmH = (float?)n.OptDouble("precipMmH"),
                CloudPct = (float?)n.OptDouble("cloudPct"),
                WindMps = (float?)n.OptDouble("windMps"),
                WindDirDeg = (float?)n.OptDouble("windDirDeg"),
                Condition = ParseCondition(n.OptString("condition")),
                Sunrise = n.OptDouble("sunrise"),
                Sunset = n.OptDouble("sunset"),
                Source = n.OptString("source"),
            };
        }

        public static WaterDto ParseWater(string json)
        {
            var n = JsonParser.Parse(json);
            return new WaterDto
            {
                Ts = n["ts"].AsDouble,
                Station = n.OptString("station"),
                LevelMNap = (float?)n.OptDouble("levelMNap"),
                Trend = n.OptString("trend") switch
                {
                    "rising" => WaterTrend.Rising,
                    "falling" => WaterTrend.Falling,
                    "steady" => WaterTrend.Steady,
                    _ => WaterTrend.Unknown,
                },
                Source = n.OptString("source"),
            };
        }

        public static WeatherCondition ParseCondition(string? s) => s switch
        {
            "clear" => WeatherCondition.Clear,
            "partly_cloudy" => WeatherCondition.PartlyCloudy,
            "cloudy" => WeatherCondition.Cloudy,
            "rain" => WeatherCondition.Rain,
            "heavy_rain" => WeatherCondition.HeavyRain,
            "snow" => WeatherCondition.Snow,
            "fog" => WeatherCondition.Fog,
            "thunder" => WeatherCondition.Thunder,
            _ => WeatherCondition.Unknown,
        };
    }
}
