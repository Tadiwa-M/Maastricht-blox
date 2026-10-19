#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// A loaded island with its occupancy: "which brick sits at local cell (i, j, k)". CONTRACT 5.1
    /// says stud exposure and hidden-face culling are computed <b>within the island</b>, because
    /// the world grid can't describe cells of a rotated grid. So everything that asks "is there a
    /// brick next to / on top of this one" for island bricks asks this index (and the mesher's
    /// cell grid built from the same records), never the chunks.
    ///
    /// <para>Coordinates: (i, j) are island-local cells (0..255), k is global (same as chunks).
    /// <see cref="Pose"/> maps local metres to Unity world metres.</para>
    /// </summary>
    public sealed class IslandIndex
    {
        private readonly ColumnOccupancy _columns;

        public IslandData Data { get; }
        public uint Id => Data.Id;
        public ChunkCoord Owner => Data.Owner;
        public IslandPose Pose { get; }

        /// <summary>Local extent of the bricks: cells [0, ExtentI) x [0, ExtentJ), levels [MinK, MaxK).</summary>
        public int ExtentI { get; }
        public int ExtentJ { get; }
        public int MinK { get; }
        public int MaxK { get; }

        public IslandIndex(IslandData data, BrickTypeInfo[] catalogue)
        {
            Data = data;
            Pose = data.Pose;
            _columns = new ColumnOccupancy(data.Records, catalogue, IslandReader.MaxStuds, "island");
            int ei0 = 0, ej0 = 0, k0 = int.MaxValue, k1 = int.MinValue;
            foreach (var r in data.Records)
            {
                var t = catalogue[r.type];
                Rotation.RotatedExtent(t, r.Rot, out int ei, out int ej);
                ei0 = Math.Max(ei0, r.i + ei);
                ej0 = Math.Max(ej0, r.j + ej);
                k0 = Math.Min(k0, r.k);
                k1 = Math.Max(k1, r.k + t.H);
            }
            ExtentI = ei0; ExtentJ = ej0;
            MinK = k0 == int.MaxValue ? 0 : k0;
            MaxK = k1 == int.MinValue ? 0 : k1;
        }

        /// <summary>Index of the brick at local cell (i, j, k), or -1.</summary>
        public int BrickAt(int i, int j, int k) => _columns.BrickAt(i, j, k);

        public bool IsSolid(int i, int j, int k) => _columns.BrickAt(i, j, k) >= 0;

        /// <summary>Exclusive top K of the highest brick in local column (i, j), or -1.</summary>
        public int ColumnTop(int i, int j) => _columns.ColumnTop(i, j);

        /// <summary>Local cell (i, j) containing world point (x, z) (Unity metres); may be outside the island.</summary>
        public void WorldToCell(double x, double z, out int i, out int j)
        {
            Pose.WorldToLocal(x, z, out double u, out double v);
            i = (int)Math.Floor(u / 0.5);
            j = (int)Math.Floor(v / 0.5);
        }

        /// <summary>Brick hit at local cell (i, j, k) with island-local coordinates, if any.</summary>
        public bool TryGetBrick(int i, int j, int k, out BrickHit hit)
        {
            hit = default;
            int idx = _columns.BrickAt(i, j, k);
            if (idx < 0) return false;
            var r = Data.Records[idx];
            hit = new BrickHit(Owner, idx, r, r.i, r.j, r.k, Id);
            return true;
        }

        /// <summary>
        /// Approximate world-space box (Unity metres) of the island: the rotated rectangle
        /// [0, ExtentI] x [0, ExtentJ] studs, enclosed axis-aligned. Used for distance and
        /// culling, not for exact tests.
        /// </summary>
        public void WorldBounds(out double minX, out double minZ, out double maxX, out double maxZ)
        {
            minX = minZ = double.MaxValue; maxX = maxZ = double.MinValue;
            for (int c = 0; c < 4; c++)
            {
                double u = (c & 1) != 0 ? ExtentI * 0.5 : 0, v = (c & 2) != 0 ? ExtentJ * 0.5 : 0;
                Pose.LocalToWorld(u, v, out double x, out double z);
                minX = Math.Min(minX, x); maxX = Math.Max(maxX, x);
                minZ = Math.Min(minZ, z); maxZ = Math.Max(maxZ, z);
            }
        }
    }
}
