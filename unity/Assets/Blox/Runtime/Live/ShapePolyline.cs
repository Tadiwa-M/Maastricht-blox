#nullable enable
using System;
using Blox.Data;

namespace Blox.Live
{
    /// <summary>
    /// A route shape in Unity world metres with the proxy's cumulative distances (CONTRACT
    /// section 8, <c>/v1/shapes</c>). It is a thin wrapper over <see cref="PathMover"/>, the same
    /// mover characters and scripted vehicles use, so live buses turn corners the same way.
    /// Distances outside [Start, End] clamp to the ends.
    /// </summary>
    public sealed class ShapePolyline
    {
        private readonly PathMover _path;

        public string ShapeId { get; }
        public int Count => _path.PointCount;
        public float StartM => (float)_path.StartM;
        public float EndM => (float)_path.EndM;

        /// <summary>
        /// Corner smoothing in metres (see <see cref="PathMover"/>). 0 (default) = heading of the
        /// segment under the point, exactly as the proxy draws it.
        /// </summary>
        public float TurnRadiusM
        {
            get => _path.TurnRadiusM;
            set => _path.TurnRadiusM = Math.Max(0f, value);
        }

        public ShapePolyline(string shapeId, float[] x, float[] z, float[] cumDistM)
        {
            if (x.Length != z.Length || x.Length != cumDistM.Length) throw new ArgumentException("point arrays differ in length");
            if (x.Length < 1) throw new ArgumentException("shape needs at least one point");
            for (int i = 1; i < cumDistM.Length; i++)
                if (cumDistM[i] < cumDistM[i - 1]) throw new ArgumentException($"shape {shapeId}: cumDistM decreases at point {i}");
            ShapeId = shapeId;
            _path = new PathMover(x, null, z, loop: false, turnRadiusM: 0f, cumDistM: cumDistM);
        }

        public static ShapePolyline From(ShapeDto dto) => new ShapePolyline(dto.ShapeId, dto.X, dto.Z, dto.CumDistM);

        /// <summary>Pose (y = 0) at distance <paramref name="distM"/> along the shape.</summary>
        public Pose PoseAt(double distM) => _path.Evaluate(distM);

        /// <summary>Position at distance <paramref name="distM"/>, and heading in degrees (0 = +z north, 90 = +x east).</summary>
        public void Evaluate(double distM, out float x, out float z, out float headingDeg)
        {
            var p = _path.Evaluate(distM);
            x = p.X; z = p.Z; headingDeg = p.YawDeg;
        }

        /// <summary>Compass heading of a world-space direction: 0 = +z (north), 90 = +x (east).</summary>
        public static float Heading(float dx, float dz) => Pose.YawOf(dx, dz);
    }
}
