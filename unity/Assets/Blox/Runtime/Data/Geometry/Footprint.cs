#nullable enable
namespace Blox.Data
{
    /// <summary>
    /// Footprint and rotation rules of CONTRACT section 2. All methods are static, allocation-free
    /// and Burst-compatible.
    ///
    /// Brick-local coordinates (rot 0): x along +i in [0, w], z along +j in [0, d].
    /// Rotation <c>rot</c> turns the footprint rot x 90 degrees clockwise seen from above
    /// (+j maps to +i), then translates it so its bounding box min corner is the record (i, j).
    /// Point map (x, z) -> (i, j) offset inside the rotated box:
    ///   rot 0: (x, z)    rot 1: (z, w - x)    rot 2: (w - x, d - z)    rot 3: (d - z, x)
    /// Matching cell map for the unit cell (a, b):
    ///   rot 0: (a, b)    rot 1: (b, w-1-a)    rot 2: (w-1-a, d-1-b)    rot 3: (d-1-b, a)
    /// Horizontal direction map (dx, dz) -> (di, dj): rot 1: (dz, -dx) etc. (clockwise).
    /// </summary>
    public static class Footprint
    {
        /// <summary>Rotated extent along (i, j): rot 0/2 -> (w, d), rot 1/3 -> (d, w).</summary>
        public static void Extent(int w, int d, int rot, out int ei, out int ej)
        {
            if ((rot & 1) == 0) { ei = w; ej = d; } else { ei = d; ej = w; }
        }

        public static void Extent(in BrickTypeInfo t, int rot, out int ei, out int ej) => Extent(t.W, t.D, rot, out ei, out ej);

        /// <summary>Brick-local point (rot 0 frame) -> offset in the rotated bounding box.</summary>
        public static void RotatePoint(float x, float z, int w, int d, int rot, out float oi, out float oj)
        {
            switch (rot & 3)
            {
                case 0: oi = x; oj = z; break;
                case 1: oi = z; oj = w - x; break;
                case 2: oi = w - x; oj = d - z; break;
                default: oi = d - z; oj = x; break;
            }
        }

        /// <summary>Brick-local unit cell (a, b) -> cell offset in the rotated bounding box.</summary>
        public static void RotateCell(int a, int b, int w, int d, int rot, out int ci, out int cj)
        {
            switch (rot & 3)
            {
                case 0: ci = a; cj = b; break;
                case 1: ci = b; cj = w - 1 - a; break;
                case 2: ci = w - 1 - a; cj = d - 1 - b; break;
                default: ci = d - 1 - b; cj = a; break;
            }
        }

        /// <summary>Inverse of <see cref="RotateCell"/>: rotated box cell offset -> brick-local cell.</summary>
        public static void UnrotateCell(int ci, int cj, int w, int d, int rot, out int a, out int b)
        {
            switch (rot & 3)
            {
                case 0: a = ci; b = cj; break;
                case 1: a = w - 1 - cj; b = ci; break;
                case 2: a = w - 1 - ci; b = d - 1 - cj; break;
                default: a = cj; b = d - 1 - ci; break;
            }
        }

        /// <summary>Rotates a horizontal direction / normal (dx along local x, dz along local z) clockwise rot times.</summary>
        public static void RotateDir(float dx, float dz, int rot, out float di, out float dj)
        {
            switch (rot & 3)
            {
                case 0: di = dx; dj = dz; break;
                case 1: di = dz; dj = -dx; break;
                case 2: di = -dx; dj = -dz; break;
                default: di = -dz; dj = dx; break;
            }
        }

        /// <summary>Direction the low edge of a slope faces: rot 0 +j, 1 +i, 2 -j, 3 -i.</summary>
        public static void SlopeLowEdge(int rot, out int di, out int dj)
        {
            RotateDir(0, 1, rot, out float fi, out float fj);
            di = (int)fi; dj = (int)fj;
        }

        /// <summary>True when brick-local cell (a, b) carries a stud for the given type.</summary>
        public static bool HasStud(in BrickTypeInfo t, int a, int b)
        {
            switch (t.Studs)
            {
                case StudPattern.All: return true;
                // Back rows lie at the -j side at rot 0 (low edge faces +j).
                case StudPattern.BackRows: return b < t.StudRows;
                default: return false;
            }
        }

        /// <summary>Number of footprint cells.</summary>
        public static int CellCount(in BrickTypeInfo t) => t.W * t.D;
    }
}
