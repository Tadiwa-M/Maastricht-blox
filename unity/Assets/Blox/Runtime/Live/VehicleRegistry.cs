#nullable enable
using System;
using System.Collections.Generic;

namespace Blox.Live
{
    /// <summary>
    /// All tracked vehicles. Feed it <c>/v1/shapes</c> once and every <c>/v1/vehicles</c>
    /// response; sample it each frame. Vehicles not reported for <see cref="StaleAfterSec"/>
    /// (measured against the render time) are removed. Pure logic: no Unity, no I/O.
    /// </summary>
    public sealed class VehicleRegistry
    {
        /// <summary>Removal age: render delay plus extrapolation limit plus a grace period.</summary>
        public const double StaleAfterSec = VehicleTrack.RenderDelaySec + VehicleTrack.MaxExtrapolationSec + 30.0;

        private readonly Dictionary<string, ShapePolyline> _shapes = new Dictionary<string, ShapePolyline>(StringComparer.Ordinal);
        private readonly Dictionary<string, VehicleTrack> _tracks = new Dictionary<string, VehicleTrack>(StringComparer.Ordinal);
        private readonly Dictionary<string, VehicleDto> _latest = new Dictionary<string, VehicleDto>(StringComparer.Ordinal);
        private readonly List<string> _scratch = new List<string>();

        public IReadOnlyDictionary<string, VehicleTrack> Tracks => _tracks;
        public IReadOnlyDictionary<string, ShapePolyline> Shapes => _shapes;

        /// <summary>Latest DTO per vehicle (route, headsign, delay, mode for labels).</summary>
        public VehicleDto? Latest(string id) => _latest.TryGetValue(id, out var v) ? v : null;

        public void SetShapes(ShapesDto shapes)
        {
            _shapes.Clear();
            foreach (var s in shapes.Shapes)
                if (s.X.Length > 0) _shapes[s.ShapeId] = ShapePolyline.From(s);
        }

        public ShapePolyline? ShapeFor(string? shapeId) =>
            shapeId != null && _shapes.TryGetValue(shapeId, out var s) ? s : null;

        /// <summary>Applies one <c>/v1/vehicles</c> response.</summary>
        public void Apply(VehiclesDto response)
        {
            foreach (var v in response.Vehicles)
            {
                if (string.IsNullOrEmpty(v.Id)) continue;
                if (!_tracks.TryGetValue(v.Id, out var track)) _tracks[v.Id] = track = new VehicleTrack(v.Id);
                track.AddObservation(VehicleObservation.From(v), ShapeFor(v.ShapeId));
                _latest[v.Id] = v;
            }
        }

        /// <summary>Removes stale vehicles and prunes histories. Returns the removed ids count.</summary>
        public int Prune(double nowUnix)
        {
            double renderTime = nowUnix - VehicleTrack.RenderDelaySec;
            _scratch.Clear();
            foreach (var kv in _tracks)
            {
                if (nowUnix - kv.Value.LastObservedTs > StaleAfterSec) _scratch.Add(kv.Key);
                else kv.Value.Prune(renderTime);
            }
            foreach (var id in _scratch) { _tracks.Remove(id); _latest.Remove(id); }
            return _scratch.Count;
        }

        /// <summary>Samples every vehicle at <paramref name="nowUnix"/> into <paramref name="output"/> (cleared first).</summary>
        public void SampleAll(double nowUnix, Dictionary<string, VehiclePose> output)
        {
            output.Clear();
            foreach (var kv in _tracks)
            {
                var pose = kv.Value.Sample(nowUnix);
                if (pose.Valid) output[kv.Key] = pose;
            }
        }
    }

    /// <summary>
    /// Estimates the proxy clock from response timestamps so render time follows upstream data
    /// even when the local clock is off. Offset = serverTs - localTs, smoothed; the first sample
    /// is taken as-is, and so is any sample more than <see cref="SnapThresholdSec"/> away from the
    /// current estimate (a restarted proxy or a corrected local clock). Non-positive timestamps
    /// are ignored. <see cref="Now"/> never goes backwards by less than the snap threshold, so
    /// smoothing corrections never make vehicles step back.
    /// </summary>
    public sealed class LiveClock
    {
        public const double SnapThresholdSec = 5.0;

        private bool _has;
        private double _lastNow = double.NegativeInfinity;
        public double OffsetSec { get; private set; }
        public double Smoothing { get; set; } = 0.2;

        public void Observe(double serverTs, double localTs)
        {
            if (!(serverTs > 0)) return;
            double o = serverTs - localTs;
            bool snap = !_has || Math.Abs(o - OffsetSec) > SnapThresholdSec;
            OffsetSec = snap ? o : OffsetSec + (o - OffsetSec) * Smoothing;
            if (snap) _lastNow = double.NegativeInfinity;
            _has = true;
        }

        public double Now(double localTs)
        {
            double t = localTs + OffsetSec;
            if (t < _lastNow && _lastNow - t < SnapThresholdSec) return _lastNow;
            _lastNow = t;
            return t;
        }

        public static double LocalUnixNow() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
    }
}
