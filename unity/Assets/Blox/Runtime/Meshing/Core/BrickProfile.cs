#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Brick body geometry in the brick-local rot-0 frame (x along +i in studs, z along +j in
    /// studs, y up in plates). Every non-round kind is an extrusion along x of a top profile
    /// y = Height(z):
    /// <list type="bullet">
    /// <item>brick / plate / tile: flat at h.</item>
    /// <item>slope: flat at h over the studded back rows z in [0, studRows], then straight down
    ///       to a front lip of <see cref="LipPlates"/> (0.05 m, CONTRACT v2) at z = d (low edge
    ///       faces +z = +j). studRows 0 (slope30) slopes all the way from the back edge.</item>
    /// <item>slope_double: lip at z = 0 and z = d, ridge at z = d / 2 with height h.</item>
    /// </list>
    /// Round bricks and round tiles are a <see cref="RoundSegments"/>-sided prism of radius
    /// <see cref="RoundRadius"/> studs centred in their cell; they never fully cover a
    /// neighbouring cell face. Jumpers use the plain plate profile. Detail pieces (arch,
    /// window, door, fence, grille) have their own geometry (<see cref="DetailMesher"/>) and
    /// cover rules (<see cref="DetailShapes.CoversLocal"/>).
    ///
    /// <b>Cover</b>: <see cref="CoversLocal"/> says whether the brick's surface on side
    /// <c>dir</c> fully closes the boundary face of its local cell (a, b, p). A face of a
    /// neighbouring brick that lies on that boundary is hidden when it is fully covered there.
    /// </summary>
    public static class BrickProfile
    {
        /// <summary>Height of the vertical front lip of slopes, in plates (CONTRACT v2: 0.25 plate = 0.05 m).</summary>
        public const float LipPlates = 0.25f;
        public const int RoundSegments = 12;
        public const float RoundRadius = 0.48f;

        public static float Lip(in BrickTypeInfo t) => Math.Min(LipPlates, t.H);

        /// <summary>Top surface height (plates) at local depth z in [0, d].</summary>
        public static float Height(in BrickTypeInfo t, float z)
        {
            switch (t.Kind)
            {
                case BrickKind.Slope:
                {
                    float sr = t.StudRows;
                    if (z <= sr) return t.H;
                    float lip = Lip(t);
                    return t.H - (t.H - lip) * (z - sr) / (t.D - sr);
                }
                case BrickKind.SlopeDouble:
                {
                    float half = t.D * 0.5f, lip = Lip(t);
                    return t.H - (t.H - lip) * Math.Abs(z - half) / half;
                }
                default:
                    return t.H;
            }
        }

        /// <summary>Profile breakpoints (z values, ascending, including 0 and d). Returns the count (2..3).</summary>
        public static int Breakpoints(in BrickTypeInfo t, out float z0, out float z1, out float z2)
        {
            z0 = 0; z2 = t.D;
            switch (t.Kind)
            {
                case BrickKind.Slope: z1 = t.StudRows; return 3;
                case BrickKind.SlopeDouble: z1 = t.D * 0.5f; return 3;
                default: z1 = t.D; z2 = t.D; return 2;
            }
        }

        public static float MinOverRow(in BrickTypeInfo t, int b) => Math.Min(Height(t, b), Height(t, b + 1));

        public static float MaxOverRow(in BrickTypeInfo t, int b)
        {
            float m = Math.Max(Height(t, b), Height(t, b + 1));
            Breakpoints(t, out _, out float z1, out _);
            if (z1 > b && z1 < b + 1) m = Math.Max(m, Height(t, z1));
            return m;
        }

        /// <summary>
        /// Whether the brick fully closes the face on side <paramref name="dir"/> (local frame)
        /// of its local cell (a, b, p). Only meaningful for cells on that side's boundary.
        /// </summary>
        public static bool CoversLocal(in BrickTypeInfo t, int dir, int a, int b, int p)
        {
            if (t.IsRound) return false;
            if (t.IsDetail) return DetailShapes.CoversLocal(t, dir, a, b, p);
            switch (dir)
            {
                case Dir.NegY: return true;
                case Dir.PosY: return MinOverRow(t, b) >= t.H;
                case Dir.PosX:
                case Dir.NegX: return p + 1 <= MinOverRow(t, b);
                case Dir.NegZ: return p + 1 <= Height(t, 0);
                case Dir.PosZ: return p + 1 <= Height(t, t.D);
                default: return false;
            }
        }

        /// <summary>
        /// Whether the brick's own axis-aligned face on side <paramref name="dir"/> has area
        /// inside the boundary face of local cell (a, b, p).
        /// </summary>
        public static bool TouchesLocal(in BrickTypeInfo t, int dir, int a, int b, int p)
        {
            switch (dir)
            {
                case Dir.NegY: return p == 0;
                case Dir.PosY: return p == t.H - 1 && MinOverRow(t, b) >= t.H;
                case Dir.PosX:
                case Dir.NegX: return p < MaxOverRow(t, b);
                case Dir.NegZ: return b == 0 && p < Height(t, 0);
                case Dir.PosZ: return b == t.D - 1 && p < Height(t, t.D);
                default: return false;
            }
        }

        /// <summary>6-bit mask of world directions the brick covers at local cell (a, b, p) for rotation rot.</summary>
        public static int CoverMaskWorld(in BrickTypeInfo t, int rot, int a, int b, int p)
        {
            int mask = 0;
            for (int wd = 0; wd < 6; wd++)
                if (CoversLocal(t, Dir.WorldToLocal(wd, rot), a, b, p)) mask |= 1 << wd;
            return mask;
        }
    }
}
