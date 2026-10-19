#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Where an island's own grid sits in the world (CONTRACT 5.1): the Unity position of its
    /// local cell (0, 0) min corner and a yaw in degrees <b>clockwise from north</b>, seen from
    /// above (the same convention as <see cref="Pose"/> for brick models).
    ///
    /// <para><b>Why islands exist.</b> Most Maastricht streets are not aligned with the world grid.
    /// A wall at 20 degrees rasterised onto the world grid becomes a staircase, and a staircase
    /// can't carry windows and doors. So the pipeline builds such a building on a grid turned to
    /// match its main wall, and the renderer turns the whole island back as one rigid object.</para>
    ///
    /// <para><b>The maths.</b> Local axes in world (east, north) components:
    /// local +i = (cos yaw, -sin yaw), local +j = (sin yaw, cos yaw). A local point (u, v) in
    /// metres (u along +i, v along +j) lands at
    /// <c>x = originX + u cos(yaw) + v sin(yaw)</c>, <c>z = originZ - u sin(yaw) + v cos(yaw)</c>.
    /// Heights are not touched: islands use global k, so y = K * 0.2 as in chunks.</para>
    ///
    /// <para><b>Unity.</b> Unity is left-handed with Y up, +Z north and +X east, and a positive
    /// rotation about Y turns +Z toward +X, i.e. clockwise seen from above. So the island's
    /// GameObject gets <c>position = (OriginX, 0, OriginZ)</c> and
    /// <c>rotation = Quaternion.Euler(0, YawDeg, 0)</c>, with no sign flip:
    /// <c>Quaternion.Euler(0, a, 0) * (1, 0, 0) = (cos a, 0, -sin a)</c> = local +i above.
    /// <see cref="UnityEulerY"/> spells that matrix out so tests can check it against the
    /// contract vectors (contract/test_vectors/islands.json).</para>
    /// </summary>
    public readonly struct IslandPose : IEquatable<IslandPose>
    {
        /// <summary>|yawDeg| limit: the pipeline picks the wall direction nearest to north (CONTRACT 5.1).</summary>
        public const float MaxAbsYawDeg = 45f;

        public readonly double OriginX, OriginZ;
        public readonly double YawDeg;
        private readonly double _sin, _cos;

        public IslandPose(double originX, double originZ, double yawDeg)
        {
            OriginX = originX; OriginZ = originZ; YawDeg = yawDeg;
            double r = yawDeg * Math.PI / 180.0;
            _sin = Math.Sin(r);
            _cos = Math.Cos(r);
        }

        public double Sin => _sin;
        public double Cos => _cos;

        /// <summary>Local point (u along +i, v along +j, metres) -> world (x east, z north, Unity metres).</summary>
        public void LocalToWorld(double u, double v, out double x, out double z)
        {
            x = OriginX + u * _cos + v * _sin;
            z = OriginZ - u * _sin + v * _cos;
        }

        /// <summary>Inverse of <see cref="LocalToWorld"/>: world (x, z) -> local (u, v) metres.</summary>
        public void WorldToLocal(double x, double z, out double u, out double v)
        {
            double dx = x - OriginX, dz = z - OriginZ;
            u = dx * _cos - dz * _sin;
            v = dx * _sin + dz * _cos;
        }

        /// <summary>A local direction (du along +i, dv along +j) in world (x, z) components.</summary>
        public void LocalDirToWorld(double du, double dv, out double dx, out double dz)
        {
            dx = du * _cos + dv * _sin;
            dz = -du * _sin + dv * _cos;
        }

        /// <summary>A world direction (x, z) in local (du along +i, dv along +j) components.</summary>
        public void WorldDirToLocal(double dx, double dz, out double du, out double dv)
        {
            du = dx * _cos - dz * _sin;
            dv = dx * _sin + dz * _cos;
        }

        /// <summary>World position of local cell (i, j)'s min corner (cell = 0.5 m stud).</summary>
        public void CellToWorld(double i, double j, out double x, out double z) =>
            LocalToWorld(i * StudM, j * StudM, out x, out z);

        private const double StudM = 0.5;

        /// <summary>
        /// The rotation Unity applies for <c>Quaternion.Euler(0, yawDeg, 0)</c> to a vector (x, z) on
        /// the ground plane (left-handed, Y up). Spelled out so engine-free code and tests can prove
        /// that the island GameObject transform equals <see cref="LocalToWorld"/>.
        /// </summary>
        public static void UnityEulerY(double yawDeg, double x, double z, out double rx, out double rz)
        {
            double r = yawDeg * Math.PI / 180.0, s = Math.Sin(r), c = Math.Cos(r);
            rx = x * c + z * s;
            rz = -x * s + z * c;
        }

        public bool Equals(IslandPose o) => OriginX == o.OriginX && OriginZ == o.OriginZ && YawDeg == o.YawDeg;
        public override bool Equals(object? obj) => obj is IslandPose o && Equals(o);
        public override int GetHashCode() => OriginX.GetHashCode() ^ (OriginZ.GetHashCode() * 7) ^ (YawDeg.GetHashCode() * 13);
        public override string ToString() => $"IslandPose(origin ({OriginX:0.###}, {OriginZ:0.###}), yaw {YawDeg:0.###} deg)";
    }
}
