#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Turns "a path plus a distance" into a <see cref="Pose"/> (CONTRACT section 7.1). Shared
    /// by everything that moves: live buses (Blox.Live), scripted path followers and the
    /// walking character (Blox.Gameplay). Pure C#, no Unity.
    ///
    /// <para><b>Path.</b> A polyline in Unity metres (x east, y up, z north). Distances run
    /// along the ground (x, z); y is interpolated. By default distances are measured from the
    /// first point; pass explicit cumulative distances to use someone else's numbering (the
    /// live proxy's <c>distAlongShapeM</c>). A <see cref="Loop"/> path closes back to its first
    /// point and wraps distances; an open path clamps them to its ends.</para>
    ///
    /// <para><b>Corners.</b> With <see cref="TurnRadiusM"/> = 0 the heading is the direction of
    /// the segment under the point (it snaps at corners). With r &gt; 0 we use the "two axles"
    /// rule, the same as the browser viewer: put a rear axle r metres behind and a front axle r
    /// metres ahead on the path; the heading is rear -> front and the position is their
    /// midpoint (on an open path the axles may run past the ends along the end segments). On straight stretches that is exactly the path; at a corner the heading turns
    /// smoothly over 2r metres and the position cuts the corner slightly, like a real vehicle.</para>
    /// </summary>
    public sealed class PathMover
    {
        private readonly float[] _x, _y, _z, _d;

        public bool Loop { get; }
        public float TurnRadiusM { get; set; }
        public int PointCount => _x.Length;
        /// <summary>Distance of the first point (0 unless explicit distances were given).</summary>
        public double StartM => _d[0];
        public double EndM => _d[_d.Length - 1];
        public double LengthM => EndM - StartM;

        /// <param name="x">East coordinates (Unity metres).</param>
        /// <param name="y">Heights, or null for all 0.</param>
        /// <param name="z">North coordinates.</param>
        /// <param name="loop">Close the path (last point joins the first) and wrap distances.</param>
        /// <param name="turnRadiusM">Corner smoothing (see class remarks); 0 = sharp.</param>
        /// <param name="cumDistM">Optional explicit cumulative distances (non-decreasing; not with loop).</param>
        public PathMover(float[] x, float[]? y, float[] z, bool loop = false, float turnRadiusM = 0f, float[]? cumDistM = null)
        {
            if (x.Length != z.Length || (y != null && y.Length != x.Length)) throw new ArgumentException("path coordinate arrays differ in length");
            if (x.Length < 1) throw new ArgumentException("a path needs at least one point");
            if (turnRadiusM < 0) throw new ArgumentException("turn radius must be >= 0");
            if (cumDistM != null && loop) throw new ArgumentException("explicit distances are only supported on open paths");
            y ??= new float[x.Length];
            bool close = loop && x.Length > 1 && (x[0] != x[x.Length - 1] || z[0] != z[z.Length - 1] || y[0] != y[y.Length - 1]);
            int n = x.Length + (close ? 1 : 0);
            _x = new float[n]; _y = new float[n]; _z = new float[n]; _d = new float[n];
            Array.Copy(x, _x, x.Length); Array.Copy(y, _y, y.Length); Array.Copy(z, _z, z.Length);
            if (close) { _x[n - 1] = x[0]; _y[n - 1] = y[0]; _z[n - 1] = z[0]; }
            if (cumDistM != null)
            {
                if (cumDistM.Length != x.Length) throw new ArgumentException("cumDistM differs in length from the points");
                for (int q = 0; q < n; q++)
                {
                    if (q > 0 && cumDistM[q] < cumDistM[q - 1]) throw new ArgumentException($"cumulative distance decreases at point {q}");
                    _d[q] = cumDistM[q];
                }
            }
            else
            {
                for (int q = 1; q < n; q++)
                {
                    double dx = _x[q] - _x[q - 1], dz = _z[q] - _z[q - 1];
                    _d[q] = _d[q - 1] + (float)Math.Sqrt(dx * dx + dz * dz);
                }
            }
            Loop = loop;
            TurnRadiusM = turnRadiusM;
        }

        /// <summary>Convenience: a flat path (y = 0) from (x, z) pairs.</summary>
        public static PathMover FromXZ(float[] x, float[] z, bool loop = false, float turnRadiusM = 0f) =>
            new PathMover(x, null, z, loop, turnRadiusM);

        /// <summary>Wraps (loop) or clamps (open) a distance into [StartM, EndM].</summary>
        public double Normalize(double distM)
        {
            double len = LengthM;
            if (Loop && len > 0)
            {
                double s = (distM - StartM) % len;
                if (s < 0) s += len;
                return StartM + s;
            }
            return Math.Max(StartM, Math.Min(EndM, distM));
        }

        /// <summary>Pose at a distance along the path (see class remarks for the corner rule).</summary>
        public Pose Evaluate(double distM)
        {
            double s = Normalize(distM);
            if (_x.Length == 1) return new Pose(_x[0], _y[0], _z[0], 0f);
            if (TurnRadiusM <= 0f)
            {
                int seg = Segment(s);
                PointOn(seg, s, out float px, out float py, out float pz);
                return new Pose(px, py, pz, Pose.YawOf(_x[seg + 1] - _x[seg], _z[seg + 1] - _z[seg]));
            }
            AxlePoint(s - TurnRadiusM, out float bx, out float by, out float bz);
            AxlePoint(s + TurnRadiusM, out float fx, out float fy, out float fz);
            float dx = fx - bx, dz = fz - bz;
            if (dx * dx + dz * dz < 1e-10f)
            {
                // Zero-length path (all points equal): use the segment under the point.
                int seg = Segment(s);
                dx = _x[seg + 1] - _x[seg];
                dz = _z[seg + 1] - _z[seg];
            }
            return new Pose((bx + fx) * 0.5f, (by + fy) * 0.5f, (bz + fz) * 0.5f, Pose.YawOf(dx, dz));
        }

        /// <summary>Point on the polyline itself at a distance (wrapped or clamped), no smoothing.</summary>
        public void Point(double distM, out float x, out float y, out float z)
        {
            double s = Normalize(distM);
            if (_x.Length == 1) { x = _x[0]; y = _y[0]; z = _z[0]; return; }
            PointOn(Segment(s), s, out x, out y, out z);
        }

        /// <summary>
        /// Like <see cref="Point"/>, but on an open path a distance past either end continues
        /// straight along the end segment. That keeps the two-axle rule exact on a straight
        /// path right up to its ends (no "pulled back" midpoint).
        /// </summary>
        private void AxlePoint(double distM, out float x, out float y, out float z)
        {
            if (Loop || _x.Length == 1 || (distM >= StartM && distM <= EndM)) { Point(distM, out x, out y, out z); return; }
            int seg = Segment(distM < StartM ? StartM : EndM);
            float d0 = _d[seg], d1 = _d[seg + 1];
            if (d1 <= d0) { Point(distM, out x, out y, out z); return; }
            float t = (float)((distM - d0) / (d1 - d0));
            x = _x[seg] + (_x[seg + 1] - _x[seg]) * t;
            y = _y[seg] + (_y[seg + 1] - _y[seg]) * t;
            z = _z[seg] + (_z[seg + 1] - _z[seg]) * t;
        }

        private void PointOn(int seg, double s, out float x, out float y, out float z)
        {
            float d0 = _d[seg], d1 = _d[seg + 1];
            float t = d1 > d0 ? (float)((Math.Max(d0, Math.Min(d1, s)) - d0) / (d1 - d0)) : 0f;
            x = _x[seg] + (_x[seg + 1] - _x[seg]) * t;
            y = _y[seg] + (_y[seg + 1] - _y[seg]) * t;
            z = _z[seg] + (_z[seg + 1] - _z[seg]) * t;
        }

        /// <summary>
        /// Index q of the segment [q, q+1] holding distance s, preferring a segment with
        /// non-zero length (repeated points are skipped).
        /// </summary>
        private int Segment(double s)
        {
            int last = _d.Length - 2;
            if (s >= EndM)
            {
                int k = last;
                while (k > 0 && _d[k + 1] <= _d[k]) k--;
                return k;
            }
            int lo = 0, hi = last;
            while (lo < hi) // last q with d[q] <= s
            {
                int mid = (lo + hi + 1) >> 1;
                if (_d[mid] <= s) lo = mid; else hi = mid - 1;
            }
            while (lo < last && _d[lo + 1] <= _d[lo]) lo++;
            return lo;
        }
    }
}
