using System;

namespace Blox.Rendering
{
    /// <summary>
    /// Distance-based HLOD choice per chunk. Level 0 = full detail (bricks, bevels, studs),
    /// 1/2/3 = Blox.Meshing HLOD boxes at factor 2/4/8. Switching uses hysteresis so a chunk
    /// does not flip back and forth (and get re-meshed) at a threshold.
    /// </summary>
    [Serializable]
    public struct ChunkLodPolicy
    {
        /// <summary>Upper distance (m) of level 0, 1 and 2; level 3 beyond.</summary>
        public float FullDistance;
        public float Lod2Distance;
        public float Lod4Distance;
        /// <summary>Fraction of a threshold a chunk must cross before it switches (0.1 = 10 %).</summary>
        public float Hysteresis;

        public static ChunkLodPolicy Default => new ChunkLodPolicy
        {
            FullDistance = 260f,
            Lod2Distance = 600f,
            Lod4Distance = 1200f,
            Hysteresis = 0.1f,
        };

        public const int LevelCount = 4;

        /// <summary>HLOD factor for a level (1 for full detail).</summary>
        public static int Factor(int level) => level <= 0 ? 1 : 1 << level;

        private float Threshold(int level) => level == 0 ? FullDistance : level == 1 ? Lod2Distance : Lod4Distance;

        /// <summary>Level for a distance without history.</summary>
        public int LevelFor(float distance)
        {
            if (distance < FullDistance) return 0;
            if (distance < Lod2Distance) return 1;
            if (distance < Lod4Distance) return 2;
            return 3;
        }

        /// <summary>
        /// Level for a distance given the current level (-1 = none yet). The chunk only moves
        /// to a coarser level once it is <see cref="Hysteresis"/> past the boundary, and back to
        /// a finer one once it is that far inside.
        /// </summary>
        public int Desired(float distance, int current)
        {
            int raw = LevelFor(distance);
            if (current < 0 || raw == current) return raw;
            if (raw > current)
            {
                // Coarser: require distance beyond the current level's upper bound * (1 + h).
                return distance > Threshold(current) * (1f + Hysteresis) ? raw : current;
            }
            // Finer: require distance inside the target level's upper bound * (1 - h).
            return distance < Threshold(raw) * (1f - Hysteresis) ? raw : current;
        }

        /// <summary>Distance from a point to an axis-aligned box (0 inside).</summary>
        public static float DistanceToBox(float px, float py, float pz,
                                          float minX, float minY, float minZ, float maxX, float maxY, float maxZ)
        {
            float dx = Math.Max(Math.Max(minX - px, 0f), px - maxX);
            float dy = Math.Max(Math.Max(minY - py, 0f), py - maxY);
            float dz = Math.Max(Math.Max(minZ - pz, 0f), pz - maxZ);
            return (float)Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
    }
}
