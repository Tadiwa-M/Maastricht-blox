#nullable enable
using System;

namespace Blox.Live
{
    /// <summary>
    /// A route shape in Unity world metres with cumulative distances (CONTRACT section 8,
    /// <c>/v1/shapes</c>). Evaluates position and heading at a distance along the shape.
    /// Distances outside [Start, End] clamp to the ends.
    /// </summary>
    public sealed class ShapePolyline
    {
        private readonly float[] _x, _z, _d;

        public string ShapeId { get; }
        public int Count => _x.Length;
        public float StartM => _d[0];
        public float EndM => _d[_d.Length - 1];

        public ShapePolyline(string shapeId, float[] x, float[] z, float[] cumDistM)
        {
            if (x.Length != z.Length || x.Length != cumDistM.Length) throw new ArgumentException("point arrays differ in length");
            if (x.Length < 1) throw new ArgumentException("shape needs at least one point");
            for (int i = 1; i < cumDistM.Length; i++)
                if (cumDistM[i] < cumDistM[i - 1]) throw new ArgumentException($"shape {shapeId}: cumDistM decreases at point {i}");
            ShapeId = shapeId; _x = x; _z = z; _d = cumDistM;
        }

        public static ShapePolyline From(ShapeDto dto) => new ShapePolyline(dto.ShapeId, dto.X, dto.Z, dto.CumDistM);

        /// <summary>Position at distance <paramref name="distM"/>, and heading in degrees (0 = +z north, 90 = +x east).</summary>
        public void Evaluate(double distM, out float x, out float z, out float headingDeg)
        {
            int n = _d.Length;
            if (n == 1) { x = _x[0]; z = _z[0]; headingDeg = 0; return; }
            int seg = Segment(distM);
            float d0 = _d[seg], d1 = _d[seg + 1];
            float t = d1 > d0 ? (float)((Math.Max(d0, Math.Min(d1, distM)) - d0) / (d1 - d0)) : 0f;
            x = _x[seg] + (_x[seg + 1] - _x[seg]) * t;
            z = _z[seg] + (_z[seg + 1] - _z[seg]) * t;
            headingDeg = Heading(_x[seg + 1] - _x[seg], _z[seg + 1] - _z[seg]);
        }

        /// <summary>Index s of the segment [s, s+1] containing distM (clamped), skipping zero-length segments when possible.</summary>
        private int Segment(double distM)
        {
            int lo = 0, hi = _d.Length - 2;
            if (distM <= _d[0]) return FirstNonDegenerate(0);
            if (distM >= _d[_d.Length - 1]) return LastNonDegenerate(hi);
            while (lo < hi) // last s with d[s] <= distM
            {
                int mid = (lo + hi + 1) >> 1;
                if (_d[mid] <= distM) lo = mid; else hi = mid - 1;
            }
            return FirstNonDegenerate(lo);
        }

        private int FirstNonDegenerate(int s)
        {
            int k = s;
            while (k < _d.Length - 2 && _d[k + 1] <= _d[k]) k++;
            return k;
        }

        private int LastNonDegenerate(int s)
        {
            int k = s;
            while (k > 0 && _d[k + 1] <= _d[k]) k--;
            return k;
        }

        /// <summary>Compass heading of a world-space direction: 0 = +z (north), 90 = +x (east).</summary>
        public static float Heading(float dx, float dz)
        {
            if (dx == 0 && dz == 0) return 0;
            double deg = Math.Atan2(dx, dz) * 180.0 / Math.PI;
            return (float)(deg < 0 ? deg + 360.0 : deg);
        }
    }
}
