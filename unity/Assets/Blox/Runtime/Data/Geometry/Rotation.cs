#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Which way a piece's front points (CONTRACT section 2, "Facing"). Every directional piece
    /// (slope, window, door, arch, model) has a front, and at rot 0 it faces +j (north).
    /// The numeric value IS the rot: N = 0, E = 1, S = 2, W = 3.
    /// </summary>
    public enum Facing : byte { N = 0, E = 1, S = 2, W = 3 }

    /// <summary>
    /// The one place that knows the rotation rules of CONTRACT section 2. Everything else
    /// (chunk reader, occupancy, mesher, models) calls these helpers instead of doing its own
    /// rot maths, and the dotnet tests check them against contract/test_vectors/rotation.json.
    ///
    /// <para><b>How to think about it.</b> Describe a piece in its own "rot 0" frame: footprint
    /// <c>w</c> studs along +i, <c>d</c> studs along +j, front toward +j. Placing it with a
    /// <see cref="Facing"/> turns that frame clockwise (seen from above) until the front points
    /// the requested way, then slides it so its bounding box starts at the record's (i, j).
    /// Callers should say "front faces east" (<see cref="Facing.E"/>) and let
    /// <see cref="FacingToRot"/> pick the rot; they should never write rot maths themselves.</para>
    ///
    /// <code>
    /// rot  facing  front   unit cell (a, b) lands at   point (x, z) lands at
    ///  0     N      +j     (a, b)                       (x, z)
    ///  1     E      +i     (b, w-1-a)                   (z, w - x)
    ///  2     S      -j     (w-1-a, d-1-b)               (w - x, d - z)
    ///  3     W      -i     (d-1-b, a)                   (d - z, x)
    /// </code>
    /// All methods are static, allocation-free and Burst-compatible (no managed types).
    /// </summary>
    public static class Rotation
    {
        // ---- facing <-> rot <-> yaw ------------------------------------------------------

        /// <summary>The rot that makes a piece's front face <paramref name="facing"/>.</summary>
        public static int FacingToRot(Facing facing) => (int)facing & 3;

        /// <summary>Which way the front faces for a given rot (0..3; higher bits ignored).</summary>
        public static Facing RotToFacing(int rot) => (Facing)(rot & 3);

        /// <summary>Compass yaw of a facing in degrees clockwise from north: N 0, E 90, S 180, W 270.</summary>
        public static float FacingToYawDeg(Facing facing) => 90f * FacingToRot(facing);

        /// <summary>Nearest facing for a yaw in degrees clockwise from north (any range).</summary>
        public static Facing YawToFacing(float yawDeg)
        {
            int q = (int)Math.Floor((yawDeg + 45.0) / 90.0);
            return (Facing)(((q % 4) + 4) % 4);
        }

        /// <summary>Parses "N", "E", "S" or "W" (case-insensitive).</summary>
        public static Facing ParseFacing(string s) => s.Trim().ToUpperInvariant() switch
        {
            "N" => Facing.N,
            "E" => Facing.E,
            "S" => Facing.S,
            "W" => Facing.W,
            _ => throw new FormatException($"unknown facing '{s}' (expected N, E, S or W)"),
        };

        // ---- where things point -----------------------------------------------------------

        /// <summary>Grid direction (di, dj) the front faces for a rot: 0 +j, 1 +i, 2 -j, 3 -i.</summary>
        public static void FrontDir(int rot, out int di, out int dj)
        {
            switch (rot & 3)
            {
                case 0: di = 0; dj = 1; break;
                case 1: di = 1; dj = 0; break;
                case 2: di = 0; dj = -1; break;
                default: di = -1; dj = 0; break;
            }
        }

        public static void FrontDir(Facing facing, out int di, out int dj) => FrontDir(FacingToRot(facing), out di, out dj);

        /// <summary>
        /// Turns a horizontal direction given in the piece's rot-0 frame (dx along local x = +i,
        /// dz along local z = +j) into grid axes for <paramref name="rot"/> (clockwise).
        /// </summary>
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

        // ---- footprint ------------------------------------------------------------------

        /// <summary>Size of the rotated bounding box along (i, j): rot 0/2 -> (w, d), rot 1/3 -> (d, w).</summary>
        public static void RotatedExtent(int w, int d, int rot, out int ei, out int ej)
        {
            if ((rot & 1) == 0) { ei = w; ej = d; } else { ei = d; ej = w; }
        }

        public static void RotatedExtent(in BrickTypeInfo t, int rot, out int ei, out int ej) => RotatedExtent(t.W, t.D, rot, out ei, out ej);

        /// <summary>Unrotated footprint cell (a along w, b along d) -> offset (di, dj) from the record position.</summary>
        public static void FootprintCell(int a, int b, int w, int d, int rot, out int di, out int dj)
        {
            switch (rot & 3)
            {
                case 0: di = a; dj = b; break;
                case 1: di = b; dj = w - 1 - a; break;
                case 2: di = w - 1 - a; dj = d - 1 - b; break;
                default: di = d - 1 - b; dj = a; break;
            }
        }

        /// <summary>Inverse of <see cref="FootprintCell"/>: offset in the rotated box -> unrotated cell (a, b).</summary>
        public static void UnrotateCell(int di, int dj, int w, int d, int rot, out int a, out int b)
        {
            switch (rot & 3)
            {
                case 0: a = di; b = dj; break;
                case 1: a = w - 1 - dj; b = di; break;
                case 2: a = w - 1 - di; b = d - 1 - dj; break;
                default: a = dj; b = d - 1 - di; break;
            }
        }

        /// <summary>
        /// A point in the piece's rot-0 frame (x in [0, w], z in [0, d], in studs) -> offset in the
        /// rotated box. The cell map above is this map applied to cell centres.
        /// </summary>
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
    }
}
