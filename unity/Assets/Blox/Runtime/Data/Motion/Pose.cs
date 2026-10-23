#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Where a moving thing is and which way it faces (CONTRACT section 7.1): a position in
    /// Unity metres (x east, y up, z north) and a yaw in degrees clockwise from north, seen
    /// from above. Yaw 0 means the model's front (+j) points north; 90 means east.
    ///
    /// Buses (live data), path followers and the walking character all produce this one type,
    /// so a single "apply pose" step places any of them. In Unity the rotation is simply
    /// <c>Quaternion.Euler(0, YawDeg, 0)</c> (positive Y rotation turns +z toward +x).
    /// </summary>
    public readonly struct Pose : IEquatable<Pose>
    {
        public readonly float X, Y, Z;
        public readonly float YawDeg;

        public Pose(float x, float y, float z, float yawDeg)
        {
            X = x; Y = y; Z = z; YawDeg = yawDeg;
        }

        /// <summary>Unit vector of the facing direction on the ground plane (east, north components).</summary>
        public float ForwardX => (float)Math.Sin(YawDeg * Math.PI / 180.0);
        public float ForwardZ => (float)Math.Cos(YawDeg * Math.PI / 180.0);

        /// <summary>Same pose with another height (e.g. after a ground probe).</summary>
        public Pose WithY(float y) => new Pose(X, y, Z, YawDeg);

        /// <summary>Compass yaw (clockwise from north, in [0, 360)) of a direction on the ground plane; 0 for a zero vector.</summary>
        public static float YawOf(float dx, float dz)
        {
            if (dx == 0 && dz == 0) return 0;
            double deg = Math.Atan2(dx, dz) * 180.0 / Math.PI;
            return (float)(deg < 0 ? deg + 360.0 : deg);
        }

        public bool Equals(Pose o) => X == o.X && Y == o.Y && Z == o.Z && YawDeg == o.YawDeg;
        public override bool Equals(object? obj) => obj is Pose o && Equals(o);
        public override int GetHashCode() => X.GetHashCode() ^ (Y.GetHashCode() * 3) ^ (Z.GetHashCode() * 7) ^ (YawDeg.GetHashCode() * 13);
        public override string ToString() => $"Pose(({X:0.###}, {Y:0.###}, {Z:0.###}), yaw {YawDeg:0.#} deg)";
    }
}
