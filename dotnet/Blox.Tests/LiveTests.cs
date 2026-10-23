using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Blox.Live;
using Xunit;

namespace Blox.Tests
{
    public class LiveJsonTests
    {
        [Fact]
        public void ParsesContractVehiclesExample()
        {
            const string json = @"{ ""ts"": 1760700000, ""vehicles"": [
  { ""id"": ""ARR:1234"", ""mode"": ""bus"", ""operator"": ""ARR"", ""routeShort"": ""4"",
    ""routeId"": ""r"", ""tripId"": ""t"", ""headsign"": ""Station"", ""shapeId"": ""s1"",
    ""lat"": 50.85, ""lon"": 5.69, ""world"": [1234.5, 876.0], ""bearingDeg"": 90.0,
    ""speedMps"": 6.1, ""distAlongShapeM"": 1532.0, ""delaySec"": 45, ""observedTs"": 1760699990 },
  { ""id"": ""NS:1"", ""mode"": ""train"", ""world"": [1, 2], ""shapeId"": null, ""distAlongShapeM"": null,
    ""bearingDeg"": null, ""speedMps"": null, ""delaySec"": null, ""observedTs"": 1760699995 } ] }";
            var v = LiveJson.ParseVehicles(json);
            Assert.Equal(1760700000, v.Ts);
            Assert.Equal(2, v.Vehicles.Count);
            var a = v.Vehicles[0];
            Assert.Equal(("ARR:1234", "4", "s1"), (a.Id, a.RouteShort, a.ShapeId));
            Assert.Equal((1234.5f, 876f), (a.WorldX, a.WorldZ));
            Assert.Equal(1532.0, a.DistAlongShapeM);
            Assert.Equal(45, a.DelaySec);
            var b = v.Vehicles[1];
            Assert.Null(b.ShapeId);
            Assert.Null(b.DistAlongShapeM);
            Assert.Null(b.SpeedMps);
        }

        [Fact]
        public void ParsesShapesStopsWeatherWaterHealth()
        {
            var shapes = LiveJson.ParseShapes(@"{""shapes"":[{""shapeId"":""s1"",""routeShort"":""4"",""mode"":""bus"",""color"":""#ff0000"",
                ""points"":[[0,0,0],[10,0,10],[10,10,20]]}]}");
            Assert.Equal(new[] { 0f, 10f, 20f }, shapes.Shapes[0].CumDistM);
            var stops = LiveJson.ParseStops(@"{""stops"":[{""stopId"":""1"",""name"":""Vrijthof"",""world"":[485,1217]}]}");
            Assert.Equal((485f, 1217f), (stops.Stops[0].WorldX, stops.Stops[0].WorldZ));
            var w = LiveJson.ParseWeather(@"{""ts"":1,""tempC"":12.3,""precipMmH"":0.4,""cloudPct"":80,""windMps"":4.2,
                ""windDirDeg"":230,""condition"":""heavy_rain"",""sunrise"":2,""sunset"":3,""source"":""buienradar""}");
            Assert.Equal(WeatherCondition.HeavyRain, w.Condition);
            Assert.Equal(12.3f, w.TempC);
            Assert.Equal(WeatherCondition.Unknown, LiveJson.ParseCondition("hail"));
            var water = LiveJson.ParseWater(@"{""ts"":1,""station"":""Maastricht Sint Pieter"",""levelMNap"":44.1,""trend"":""rising"",""source"":""rws""}");
            Assert.Equal(WaterTrend.Rising, water.Trend);
            Assert.Equal(44.1f, water.LevelMNap);
            var h = LiveJson.ParseHealth(@"{""ok"":true,""sources"":{""ovapi"":{""ok"":false,""lastFetch"":0,""error"":""timeout""}}}");
            Assert.False(h.Sources["ovapi"].Ok);
            Assert.Equal("timeout", h.Sources["ovapi"].Error);
        }

        [Fact]
        public void RejectsMalformedPoints()
        {
            Assert.ThrowsAny<Exception>(() => LiveJson.ParseShapes(@"{""shapes"":[{""shapeId"":""s"",""points"":[[0,0]]}]}"));
            Assert.ThrowsAny<Exception>(() => LiveJson.ParseVehicles(@"{""ts"":1,""vehicles"":[{""id"":""x"",""world"":[1],""observedTs"":1}]}"));
        }
    }

    public class ShapePolylineTests
    {
        private static ShapePolyline LShape() =>
            new ShapePolyline("s", new[] { 0f, 100f, 100f }, new[] { 0f, 0f, 50f }, new[] { 1000f, 1100f, 1150f });

        [Fact]
        public void EvaluatesAlongSegmentsWithHeading()
        {
            var s = LShape();
            s.Evaluate(1050, out float x, out float z, out float h);
            Assert.Equal((50f, 0f, 90f), (x, z, h));
            s.Evaluate(1125, out x, out z, out h);
            Assert.Equal((100f, 25f, 0f), (x, z, h));
        }

        [Fact]
        public void ClampsOutsideRangeAndSkipsDuplicatePoints()
        {
            var s = new ShapePolyline("s", new[] { 0f, 0f, 10f }, new[] { 0f, 0f, 0f }, new[] { 0f, 0f, 10f });
            s.Evaluate(-5, out float x, out _, out float h);
            Assert.Equal((0f, 90f), (x, h));
            s.Evaluate(50, out x, out _, out _);
            Assert.Equal(10f, x);
            Assert.Throws<ArgumentException>(() => new ShapePolyline("s", new[] { 0f, 1f }, new[] { 0f, 0f }, new[] { 5f, 4f }));
        }
    }

    public class VehicleTrackTests
    {
        private const double T0 = 1_760_700_000;

        private static ShapePolyline Line() =>
            new ShapePolyline("s1", new[] { 0f, 10000f }, new[] { 0f, 0f }, new[] { 0f, 10000f });

        private static VehicleObservation Obs(double ts, double? dist, float speed = 10f, string? shape = "s1", float x = 0, float z = 0) =>
            new VehicleObservation { Ts = ts, DistM = dist, SpeedMps = speed, ShapeId = shape, X = x, Z = z };

        [Fact]
        public void RendersSixtySecondsBehindAndInterpolatesDistance()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 100), Line());
            t.AddObservation(Obs(T0 + 10, 200), Line());
            var p = t.Sample(T0 + 60 + 5);
            Assert.True(p.Valid && p.OnShape && !p.Extrapolated);
            Assert.Equal(150.0, p.DistM, 6);
            Assert.Equal(150f, p.X, 3);
            Assert.Equal(90f, p.HeadingDeg, 3);
        }

        [Fact]
        public void HoldsBeforeFirstObservation()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 100), Line());
            var p = t.Sample(T0 + 30); // render time T0 - 30
            Assert.Equal(100.0, p.DistM, 6);
            Assert.False(p.Extrapolated);
        }

        [Fact]
        public void ExtrapolatesAtMostThirtySeconds()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 100, speed: 10), Line());
            Assert.Equal(200.0, t.Target(T0 + 10).DistM, 6);
            Assert.True(t.Target(T0 + 10).Extrapolated);
            Assert.Equal(400.0, t.Target(T0 + 30).DistM, 6);
            Assert.Equal(400.0, t.Target(T0 + 300).DistM, 6);
        }

        [Fact]
        public void DoesNotExtrapolatePastShapeEnd()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 9990, speed: 10), Line());
            Assert.Equal(10000.0, t.Target(T0 + 30).DistM, 6);
        }

        [Fact]
        public void NeverTeleportsForward()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 100), Line());
            var first = t.Sample(T0 + 60);
            Assert.True(first.Discontinuity);
            // A late report puts the bus 2 km further along.
            t.AddObservation(Obs(T0 + 1, 2100), Line());
            var p = t.Sample(T0 + 61);
            Assert.False(p.Discontinuity);
            Assert.Equal(100 + VehicleTrack.MaxCatchUpSpeedMps * 1, p.DistM, 6);
        }

        [Fact]
        public void SnapsBackwardJumps()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 1000, speed: 20), Line());
            t.Sample(T0 + 60 + 20);                     // extrapolated to 1400
            t.AddObservation(Obs(T0 + 20, 1100), Line()); // the bus was actually slower
            var p = t.Sample(T0 + 60 + 20.5);
            Assert.True(p.Discontinuity);
            Assert.True(p.DistM < 1400 && p.DistM > 1000);
        }

        [Fact]
        public void ClampsSmallBackwardJitterAndResetsOnLargeReversal()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 500), Line());
            t.AddObservation(Obs(T0 + 5, 480), Line());   // 20 m jitter -> clamped
            Assert.Equal(500.0, t.History[1].DistM);
            t.AddObservation(Obs(T0 + 10, 50), Line());   // 430 m back -> new trip
            Assert.Single(t.History);
            Assert.True(t.Sample(T0 + 100).Discontinuity);
        }

        [Fact]
        public void IgnoresDuplicateAndOutOfOrderReports()
        {
            var t = new VehicleTrack("v");
            Assert.True(t.AddObservation(Obs(T0, 100), Line()));
            Assert.False(t.AddObservation(Obs(T0, 120), Line()));
            Assert.False(t.AddObservation(Obs(T0 - 5, 90), Line()));
            Assert.Single(t.History);
        }

        [Fact]
        public void FallsBackToWorldLerpWithoutShape()
        {
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, null, shape: null, x: 0, z: 0), null);
            t.AddObservation(Obs(T0 + 10, null, shape: null, x: 0, z: 100), null);
            var p = t.Target(T0 + 5);
            Assert.False(p.OnShape);
            Assert.Equal((0f, 50f, 0f), (p.X, p.Z, p.HeadingDeg));
            // Off-shape vehicles hold their last position instead of dead reckoning.
            var q = t.Target(T0 + 25);
            Assert.Equal(100f, q.Z);
            Assert.False(q.Extrapolated);
        }

        [Fact]
        public void ShapeChangeStartsNewTrip()
        {
            var other = new ShapePolyline("s2", new[] { 0f, 0f }, new[] { 0f, 1000f }, new[] { 0f, 1000f });
            var t = new VehicleTrack("v");
            t.AddObservation(Obs(T0, 100), Line());
            t.Sample(T0 + 60);
            t.AddObservation(Obs(T0 + 5, 10, shape: "s2"), other);
            Assert.Same(other, t.Shape);
            Assert.Single(t.History);
            var p = t.Sample(T0 + 65);
            Assert.True(p.Discontinuity);
            Assert.Equal((0f, 10f), (p.X, p.Z));
        }

        [Fact]
        public void PruneKeepsBracketingObservations()
        {
            var t = new VehicleTrack("v");
            for (int n = 0; n < 10; n++) t.AddObservation(Obs(T0 + n * 5, 100 + n * 50), Line());
            t.Prune(T0 + 22);
            Assert.Equal(T0 + 20, t.History[0].Ts);
            Assert.Equal(320.0, t.Target(T0 + 22).DistM, 6);
        }
    }

    public class VehicleRegistryTests
    {
        [Fact]
        public void AppliesResponsesSamplesAndDropsStaleVehicles()
        {
            var reg = new VehicleRegistry();
            var shapes = new ShapesDto();
            shapes.Shapes.Add(new ShapeDto { ShapeId = "s1", X = new[] { 0f, 1000f }, Z = new[] { 0f, 0f }, CumDistM = new[] { 0f, 1000f } });
            reg.SetShapes(shapes);
            const double t0 = 1_760_700_000;
            var r1 = new VehiclesDto { Ts = t0 };
            r1.Vehicles.Add(new VehicleDto { Id = "a", ShapeId = "s1", DistAlongShapeM = 100, ObservedTs = t0 - 10, WorldX = 100 });
            r1.Vehicles.Add(new VehicleDto { Id = "b", ShapeId = null, ObservedTs = t0 - 10, WorldX = 5, WorldZ = 6 });
            reg.Apply(r1);
            var poses = new Dictionary<string, VehiclePose>();
            reg.SampleAll(t0 + 60, poses);
            Assert.Equal(2, poses.Count);
            Assert.True(poses["a"].OnShape);
            Assert.False(poses["b"].OnShape);
            Assert.Equal("s1", reg.Latest("a")!.ShapeId);
            Assert.Equal(0, reg.Prune(t0 + 60));
            Assert.Equal(2, reg.Prune(t0 + VehicleRegistry.StaleAfterSec + 1));
            Assert.Empty(reg.Tracks);
        }

        [Fact]
        public void ClockTracksServerOffset()
        {
            var c = new LiveClock();
            c.Observe(1000, 990);
            Assert.Equal(10, c.OffsetSec, 6);
            c.Observe(1005, 1000);                    // 5 s off: smoothed (larger errors snap)
            Assert.Equal(9, c.OffsetSec, 6);
            Assert.Equal(1009, c.Now(1000), 6);
        }

        [Fact]
        public void ClockIgnoresZeroSnapsLargeErrorsAndNeverStepsBack()
        {
            var c = new LiveClock();
            c.Observe(0, 1000);                       // proxy without data must not poison the clock
            Assert.Equal(0, c.OffsetSec, 6);
            c.Observe(1_792_241_400, 1_792_241_000);
            Assert.Equal(400, c.OffsetSec, 6);
            c.Observe(1_792_241_500, 1_792_241_000);  // 100 s jump: snap, no slow convergence
            Assert.Equal(500, c.OffsetSec, 6);
            double before = c.Now(1_792_241_010);
            c.Observe(1_792_241_508, 1_792_241_010);  // offset 498: small correction backwards
            Assert.Equal(before, c.Now(1_792_241_010), 6); // held, not stepped back
            Assert.True(c.Now(1_792_241_020) > before);
        }
    }
    public class ProxySampleTests
    {
        private static string Sample(string name)
        {
            string path = Repo.PathOf("proxy", "tests", "fixtures", "api_samples", name + ".json");
            Skip.IfNot(File.Exists(path), "proxy API samples absent (run `uv run pytest` in proxy/)");
            return File.ReadAllText(path);
        }

        /// <summary>Cross-language check: the real proxy's responses (fixture upstreams) parse
        /// in the Unity client with the values the proxy test asserts.</summary>
        [SkippableFact]
        public void ParsesRealProxyResponses()
        {
            var h = LiveJson.ParseHealth(Sample("health"));
            Assert.True(h.Ok);
            Assert.True(h.Sources["ovapi"].Ok);

            var v = LiveJson.ParseVehicles(Sample("vehicles"));
            var bus = Assert.Single(v.Vehicles);
            Assert.Equal(("ARR:1234", "bus", "sh4", 45), (bus.Id, bus.Mode, bus.ShapeId, bus.DelaySec!.Value));
            Assert.Null(bus.SpeedMps);
            Assert.InRange(bus.DistAlongShapeM!.Value, 187.5, 191.5);

            var shapes = LiveJson.ParseShapes(Sample("shapes"));
            Assert.Equal(new[] { "sh1", "sh30", "sh4" }, shapes.Shapes.Select(s => s.ShapeId).OrderBy(x => x, StringComparer.Ordinal));
            foreach (var s in shapes.Shapes)
            {
                Assert.True(s.X.Length > 1 && s.X.Length == s.Z.Length && s.Z.Length == s.CumDistM.Length);
                for (int i = 1; i < s.CumDistM.Length; i++) Assert.True(s.CumDistM[i] >= s.CumDistM[i - 1]);
            }

            var sh4 = shapes.Shapes.Single(s => s.ShapeId == bus.ShapeId);
            ShapePolyline.From(sh4).Evaluate(bus.DistAlongShapeM.Value, out float px, out float pz, out _);
            Assert.InRange(Math.Sqrt(Math.Pow(px - bus.WorldX, 2) + Math.Pow(pz - bus.WorldZ, 2)), 0, 15);

            Assert.NotEmpty(LiveJson.ParseStops(Sample("stops")).Stops);
            var w = LiveJson.ParseWeather(Sample("weather"));
            Assert.Equal(WeatherCondition.HeavyRain, w.Condition);
            var water = LiveJson.ParseWater(Sample("water"));
            Assert.Equal((WaterTrend.Falling, 44.1f), (water.Trend, water.LevelMNap!.Value));
        }
    }
}
