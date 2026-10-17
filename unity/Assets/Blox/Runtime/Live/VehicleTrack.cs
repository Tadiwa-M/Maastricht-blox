#nullable enable
using System;
using System.Collections.Generic;

namespace Blox.Live
{
    /// <summary>One position report of a vehicle.</summary>
    public struct VehicleObservation
    {
        public double Ts;               // observedTs, Unix seconds
        public string? ShapeId;
        public double? DistM;           // distAlongShapeM
        public float X, Z;              // world metres
        public float? BearingDeg;
        public float? SpeedMps;

        public static VehicleObservation From(VehicleDto v) => new VehicleObservation
        {
            Ts = v.ObservedTs, ShapeId = v.ShapeId, DistM = v.DistAlongShapeM,
            X = v.WorldX, Z = v.WorldZ, BearingDeg = v.BearingDeg, SpeedMps = v.SpeedMps,
        };
    }

    /// <summary>Sampled render state of a vehicle.</summary>
    public struct VehiclePose
    {
        public bool Valid;
        public float X, Z;
        public float HeadingDeg;      // 0 = +z (north), 90 = +x (east)
        public bool OnShape;          // interpolated along the shape polyline (else world lerp)
        public bool Extrapolated;     // render time is past the newest observation
        public bool Discontinuity;    // the pose jumped (first sample, new trip, backward snap)
        public double DistM;          // distance along the shape when OnShape
    }

    /// <summary>
    /// Implements the client motion rule (CONTRACT section 8) as pure logic:
    /// <list type="bullet">
    /// <item>render at <c>now - RenderDelaySec</c> (60 s);</item>
    /// <item>interpolate <c>distAlongShapeM</c> between the two bracketing observations and place
    ///       the vehicle on the shape polyline; fall back to lerping <c>world</c>;</item>
    /// <item>past the newest observation, extrapolate along the shape with its speed for at most
    ///       <see cref="MaxExtrapolationSec"/> (30 s), then hold; never extrapolate before the oldest;</item>
    /// <item>never teleport forward: the shown position moves at most
    ///       <see cref="MaxCatchUpSpeedMps"/> per second toward the target;</item>
    /// <item>snap backward jumps: when the target is behind the shown position it is taken
    ///       immediately (flagged as <see cref="VehiclePose.Discontinuity"/>), never animated in reverse.</item>
    /// </list>
    /// Reported distances that go backwards by at most <see cref="BackwardJitterM"/> are clamped
    /// to the previous value (GPS/matching jitter); larger reversals, or a new shape, start a new trip.
    /// </summary>
    public sealed class VehicleTrack
    {
        public const double RenderDelaySec = 60.0;
        public const double MaxExtrapolationSec = 30.0;
        public const double MaxCatchUpSpeedMps = 40.0;
        public const double BackwardJitterM = 50.0;
        public const int MaxHistory = 32;

        private readonly List<VehicleObservation> _history = new List<VehicleObservation>();
        private VehiclePose _shown;
        private double _shownAt = double.NaN;
        private string? _shownShape;
        private bool _tripReset;

        public string Id { get; }
        public ShapePolyline? Shape { get; private set; }
        public IReadOnlyList<VehicleObservation> History => _history;
        public double LastObservedTs => _history.Count > 0 ? _history[_history.Count - 1].Ts : double.NegativeInfinity;

        public VehicleTrack(string id) { Id = id; }

        /// <summary>Adds an observation. Duplicates and out-of-order reports are ignored. Returns true when accepted.</summary>
        public bool AddObservation(VehicleObservation obs, ShapePolyline? shape)
        {
            if (_history.Count > 0)
            {
                var last = _history[_history.Count - 1];
                if (obs.Ts <= last.Ts) return false;
                if (!string.Equals(obs.ShapeId, last.ShapeId, StringComparison.Ordinal)) StartNewTrip();
                else if (obs.DistM.HasValue && last.DistM.HasValue && obs.DistM.Value < last.DistM.Value)
                {
                    if (last.DistM.Value - obs.DistM.Value <= BackwardJitterM) obs.DistM = last.DistM;
                    else StartNewTrip();
                }
            }
            if (obs.ShapeId == null) Shape = null;
            else if (shape != null && shape.ShapeId == obs.ShapeId) Shape = shape;
            else if (Shape != null && Shape.ShapeId != obs.ShapeId) Shape = null;
            _history.Add(obs);
            if (_history.Count > MaxHistory) _history.RemoveAt(0);
            return true;
        }

        private void StartNewTrip()
        {
            _history.Clear();
            _tripReset = true;
        }

        /// <summary>Drops observations no longer needed for render times at or after <paramref name="renderTime"/>.</summary>
        public void Prune(double renderTime)
        {
            while (_history.Count > 2 && _history[1].Ts <= renderTime) _history.RemoveAt(0);
        }

        /// <summary>Pose at wall-clock <paramref name="nowUnix"/> (the track renders at now - 60 s).</summary>
        public VehiclePose Sample(double nowUnix)
        {
            var target = Target(nowUnix - RenderDelaySec);
            if (!target.Valid) return target;
            bool first = double.IsNaN(_shownAt) || !_shown.Valid || _tripReset
                         || target.OnShape != _shown.OnShape
                         || (target.OnShape && !string.Equals(_shownShape, Shape?.ShapeId, StringComparison.Ordinal));
            VehiclePose result = first ? Place(target) : Follow(target, nowUnix - _shownAt);
            _tripReset = false;
            _shown = result;
            _shownAt = nowUnix;
            _shownShape = Shape?.ShapeId;
            return result;
        }

        private static VehiclePose Place(VehiclePose target)
        {
            target.Discontinuity = true;
            return target;
        }

        private VehiclePose Follow(VehiclePose target, double dt)
        {
            double maxStep = MaxCatchUpSpeedMps * Math.Max(0.0, dt);
            if (target.OnShape && Shape != null)
            {
                double delta = target.DistM - _shown.DistM;
                if (delta < 0) return Place(target);                  // snap backward jumps
                if (delta <= maxStep) return target;
                var p = target;
                p.DistM = _shown.DistM + maxStep;                     // catch up, never teleport
                Shape.Evaluate(p.DistM, out p.X, out p.Z, out p.HeadingDeg);
                return p;
            }
            float dx = target.X - _shown.X, dz = target.Z - _shown.Z;
            double dist = Math.Sqrt(dx * dx + dz * dz);
            if (dist <= maxStep) return target;
            var q = target;
            float f = (float)(maxStep / dist);
            q.X = _shown.X + dx * f;
            q.Z = _shown.Z + dz * f;
            return q;
        }

        /// <summary>Unsmoothed position at render time <paramref name="t"/> (Unix seconds).</summary>
        public VehiclePose Target(double t)
        {
            var pose = new VehiclePose();
            int n = _history.Count;
            if (n == 0) return pose;
            pose.Valid = true;
            var firstObs = _history[0];
            var lastObs = _history[n - 1];
            if (t <= firstObs.Ts) return At(firstObs, 0, false);
            if (t >= lastObs.Ts)
            {
                double dtx = Math.Min(t - lastObs.Ts, MaxExtrapolationSec);
                return At(lastObs, dtx, dtx > 0);
            }
            int i = n - 2;
            while (i > 0 && _history[i].Ts > t) i--;
            var a = _history[i];
            var b = _history[i + 1];
            double f = (t - a.Ts) / (b.Ts - a.Ts);
            if (Shape != null && a.DistM.HasValue && b.DistM.HasValue)
            {
                double d = a.DistM.Value + (b.DistM.Value - a.DistM.Value) * f;
                return OnShape(d, false);
            }
            pose.X = (float)(a.X + (b.X - a.X) * f);
            pose.Z = (float)(a.Z + (b.Z - a.Z) * f);
            float hx = b.X - a.X, hz = b.Z - a.Z;
            pose.HeadingDeg = hx != 0 || hz != 0 ? ShapePolyline.Heading(hx, hz) : (b.BearingDeg ?? a.BearingDeg ?? 0f);
            return pose;
        }

        private VehiclePose At(in VehicleObservation o, double extrapolateSec, bool extrapolated)
        {
            if (Shape != null && o.DistM.HasValue)
            {
                double d = o.DistM.Value + (o.SpeedMps.HasValue && o.SpeedMps.Value > 0 ? o.SpeedMps.Value * extrapolateSec : 0);
                d = Math.Min(d, Shape.EndM);
                return OnShape(d, extrapolated);
            }
            // Off-shape: hold the reported position (no dead reckoning without a path to follow).
            return new VehiclePose { Valid = true, X = o.X, Z = o.Z, HeadingDeg = o.BearingDeg ?? 0f, Extrapolated = false };
        }

        private VehiclePose OnShape(double d, bool extrapolated)
        {
            var p = new VehiclePose { Valid = true, OnShape = true, DistM = d, Extrapolated = extrapolated };
            Shape!.Evaluate(d, out p.X, out p.Z, out p.HeadingDeg);
            return p;
        }
    }
}
