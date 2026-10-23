using System;

namespace Blox.Gameplay
{
    /// <summary>Result of <see cref="GroundProbe.Find"/>.</summary>
    public enum GroundResult
    {
        /// <summary>A standable level was found (top of a brick with free headroom).</summary>
        Ground,
        /// <summary>Something solid is in the way and no level within step range: do not walk here.</summary>
        Blocked,
        /// <summary>Nothing solid nearby (open air or an unloaded chunk): keep the current height.</summary>
        NoGround,
    }

    /// <summary>
    /// Where can a walker stand in a grid column? Works on any "is this cell solid?" function
    /// (in the game: <c>WorldIndex.IsSolid</c>), so it is pure and testable.
    ///
    /// Starting from the walker's feet level <c>k</c>, it looks from <c>k + maxUp</c> down to
    /// <c>k - maxDown</c> for the highest level whose cell below is solid and whose
    /// <c>headroom</c> cells are free. Kerbs and steps up to maxUp plates are climbed; walls
    /// are reported as <see cref="GroundResult.Blocked"/>.
    /// </summary>
    public static class GroundProbe
    {
        public static GroundResult Find(Func<int, int, int, bool> solid, int i, int j, int k,
                                        int maxUp, int maxDown, int headroom, out int groundK)
        {
            groundK = k;
            bool anySolid = false;
            for (int level = k + maxUp; level >= k - maxDown; level--)
            {
                if (!solid(i, j, level - 1)) continue;
                anySolid = true;
                bool free = true;
                for (int h = 0; h < headroom && free; h++) free = !solid(i, j, level + h);
                if (free) { groundK = level; return GroundResult.Ground; }
            }
            if (anySolid) return GroundResult.Blocked;
            for (int level = k; level < k + maxUp + headroom; level++)
                if (solid(i, j, level)) return GroundResult.Blocked;
            return GroundResult.NoGround;
        }
    }
}
