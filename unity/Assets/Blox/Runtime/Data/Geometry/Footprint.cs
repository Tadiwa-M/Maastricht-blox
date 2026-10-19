#nullable enable
namespace Blox.Data
{
    /// <summary>
    /// Which footprint cells of a brick type carry a stud (CONTRACT section 2, <c>studs</c>).
    /// Cells are in the brick's own rot-0 frame (a along w, b along d); turn them into grid
    /// offsets with <see cref="Rotation.FootprintCell"/>. Rotation rules live in
    /// <see cref="Rotation"/> only.
    /// </summary>
    public static class Footprint
    {
        /// <summary>
        /// True when brick-local cell (a, b) carries a stud on its own. <see cref="StudPattern.Center"/>
        /// (jumper plates) has no per-cell studs: its single stud sits at the footprint centre,
        /// see <see cref="HasCenterStud"/>.
        /// </summary>
        public static bool HasStud(in BrickTypeInfo t, int a, int b)
        {
            switch (t.Studs)
            {
                case StudPattern.All: return true;
                // Back rows lie at the -j side at rot 0 (the low edge, the front, faces +j).
                // studRows 0 (slope30) means no studs at all.
                case StudPattern.BackRows: return b < t.StudRows;
                default: return false;
            }
        }

        /// <summary>True for types with one stud centred on the whole footprint (jumper plates).</summary>
        public static bool HasCenterStud(in BrickTypeInfo t) => t.Studs == StudPattern.Center;

        /// <summary>Number of footprint cells.</summary>
        public static int CellCount(in BrickTypeInfo t) => t.W * t.D;
    }
}
