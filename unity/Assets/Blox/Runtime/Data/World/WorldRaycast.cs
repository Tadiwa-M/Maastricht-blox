#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Grid ray cast (Amanatides &amp; Woo DDA) through loaded chunks and loaded islands, in Unity
    /// world metres. Bricks count as their full bounding box (slopes are hit as boxes); good
    /// enough for picking features and placing the camera, not for exact sloped-surface hits.
    ///
    /// <para><b>Islands (v3).</b> An island is a grid turned by its yaw, so a straight ray in the
    /// world is still a straight ray on the island grid: the ray origin and direction are turned
    /// into island-local metres (<see cref="IslandPose.WorldToLocal"/>; y is untouched because
    /// islands use global k) and the same DDA walks the island's cells. A rotation keeps lengths,
    /// so distances along the ray are the same in both frames and the nearest hit of all grids
    /// wins. Island hits carry <see cref="BrickHit.IslandId"/> and island-local I/J, and their
    /// <c>faceAxis</c> is in the island frame (0 = local i, 2 = local j).</para>
    /// </summary>
    public static class WorldRaycast
    {
        /// <param name="ox">Ray origin, Unity metres (x east, y up, z north).</param>
        /// <param name="dx">Ray direction (need not be normalised; distance is in its units).</param>
        /// <param name="maxDistance">Maximum travel in units of the direction length.</param>
        /// <param name="faceAxis">Axis of the entered face: 0 = x, 1 = y, 2 = z; -1 when starting inside.</param>
        public static bool Cast(WorldIndex world, double ox, double oy, double oz, double dx, double dy, double dz,
                                double maxDistance, out BrickHit hit, out double distance, out int faceAxis)
        {
            hit = default; distance = 0; faceAxis = -1;
            double sx = world.Spec.StudM, sy = world.Spec.PlateM;
            if (dx == 0 && dy == 0 && dz == 0) return false;
            bool found = false;

            // 1. Chunks: world grid, cells in studs (x/z) and plates (y).
            if (Dda(ox / sx, oy / sy, oz / sx, dx / sx, dy / sy, dz / sx, maxDistance, Box.Unbounded,
                    (i, j, k) => world.TryGetBrick(i, j, k, out _), out int ci, out int cj, out int ck, out double t, out int axis))
            {
                world.TryGetBrick(ci, cj, ck, out hit);
                distance = t; faceAxis = axis; found = true;
            }

            // 2. Islands: same DDA on each island's own grid.
            foreach (var island in world.LoadedIslands)
            {
                double limit = found ? distance : maxDistance;
                island.Pose.WorldToLocal(ox, oz, out double u, out double v);
                island.Pose.WorldDirToLocal(dx, dz, out double du, out double dv);
                var box = new Box(0, 0, island.MinK, island.ExtentI, island.ExtentJ, island.MaxK);
                // Skip to where the ray enters the island's box (cheap reject for far islands).
                if (!box.Clip(u / sx, oy / sy, v / sx, du / sx, dy / sy, dv / sx, out double t0, out _) || t0 > limit) continue;
                t0 = Math.Max(0, t0 - 1e-6);
                if (!Dda((u + du * t0) / sx, (oy + dy * t0) / sy, (v + dv * t0) / sx, du / sx, dy / sy, dv / sx, limit - t0, box,
                         (i, j, k) => island.IsSolid(i, j, k), out ci, out cj, out ck, out t, out axis))
                    continue;
                t += t0;
                if (found && t >= distance) continue;
                island.TryGetBrick(ci, cj, ck, out hit);
                distance = t; faceAxis = t0 > 0 && axis < 0 ? AxisOfEntry(box, (u + du * t0) / sx, (oy + dy * t0) / sy, (v + dv * t0) / sx) : axis;
                found = true;
            }
            if (!found) { hit = default; faceAxis = -1; distance = 0; }
            return found;
        }

        /// <summary>Integer cell box [I0, I1) x [J0, J1) x [K0, K1) a walk may not leave.</summary>
        private readonly struct Box
        {
            public readonly int I0, J0, K0, I1, J1, K1;
            public Box(int i0, int j0, int k0, int i1, int j1, int k1) { I0 = i0; J0 = j0; K0 = k0; I1 = i1; J1 = j1; K1 = k1; }
            public static readonly Box Unbounded = new Box(int.MinValue, int.MinValue, int.MinValue, int.MaxValue, int.MaxValue, int.MaxValue);
            public bool IsUnbounded => I0 == int.MinValue;

            /// <summary>Slab test in cell units: parameter range where the ray is inside the box.</summary>
            public bool Clip(double px, double py, double pz, double vx, double vy, double vz, out double tEnter, out double tExit)
            {
                tEnter = 0; tExit = double.PositiveInfinity;
                return Slab(px, vx, I0, I1, ref tEnter, ref tExit) && Slab(py, vy, K0, K1, ref tEnter, ref tExit)
                       && Slab(pz, vz, J0, J1, ref tEnter, ref tExit);
            }

            private static bool Slab(double p, double v, double lo, double hi, ref double t0, ref double t1)
            {
                if (v == 0) return p >= lo && p <= hi;
                double a = (lo - p) / v, b = (hi - p) / v;
                if (a > b) { double s = a; a = b; b = s; }
                t0 = Math.Max(t0, a); t1 = Math.Min(t1, b);
                return t0 <= t1;
            }
        }

        /// <summary>When a walk starts on the box surface, the entered face is the one the point lies on.</summary>
        private static int AxisOfEntry(in Box b, double px, double py, double pz)
        {
            double di = Math.Min(Math.Abs(px - b.I0), Math.Abs(px - b.I1));
            double dk = Math.Min(Math.Abs(py - b.K0), Math.Abs(py - b.K1));
            double dj = Math.Min(Math.Abs(pz - b.J0), Math.Abs(pz - b.J1));
            return di <= dk && di <= dj ? 0 : dj <= dk ? 2 : 1;
        }

        /// <summary>
        /// The DDA itself, in cell units (x = i, y = k, z = j; velocity in cells per unit of t).
        /// Returns the first solid cell and the parameter t where the ray entered it.
        /// </summary>
        private static bool Dda(double px, double py, double pz, double vx, double vy, double vz, double maxT, in Box box,
                                Func<int, int, int, bool> solid, out int ci, out int cj, out int ck, out double t, out int faceAxis)
        {
            ci = (int)Math.Floor(px); ck = (int)Math.Floor(py); cj = (int)Math.Floor(pz);
            t = 0; faceAxis = -1;
            int stepI = Math.Sign(vx), stepK = Math.Sign(vy), stepJ = Math.Sign(vz);
            if (stepI == 0 && stepK == 0 && stepJ == 0) return false;
            double tDeltaI = stepI != 0 ? Math.Abs(1.0 / vx) : double.PositiveInfinity;
            double tDeltaK = stepK != 0 ? Math.Abs(1.0 / vy) : double.PositiveInfinity;
            double tDeltaJ = stepJ != 0 ? Math.Abs(1.0 / vz) : double.PositiveInfinity;
            double tMaxI = stepI != 0 ? ((stepI > 0 ? ci + 1 - px : px - ci) * tDeltaI) : double.PositiveInfinity;
            double tMaxK = stepK != 0 ? ((stepK > 0 ? ck + 1 - py : py - ck) * tDeltaK) : double.PositiveInfinity;
            double tMaxJ = stepJ != 0 ? ((stepJ > 0 ? cj + 1 - pz : pz - cj) * tDeltaJ) : double.PositiveInfinity;
            int guard = 0;
            bool bounded = !box.IsUnbounded;
            while (t <= maxT && guard++ < 1_000_000)
            {
                if (bounded && (ci < box.I0 - 1 || ci > box.I1 || cj < box.J0 - 1 || cj > box.J1 || ck < box.K0 - 1 || ck > box.K1))
                    break; // walked out of the island (one cell of slack for the entry nudge)
                if (solid(ci, cj, ck)) return true;
                if (tMaxI <= tMaxJ && tMaxI <= tMaxK) { ci += stepI; t = tMaxI; tMaxI += tDeltaI; faceAxis = 0; }
                else if (tMaxJ <= tMaxK) { cj += stepJ; t = tMaxJ; tMaxJ += tDeltaJ; faceAxis = 2; }
                else { ck += stepK; t = tMaxK; tMaxK += tDeltaK; faceAxis = 1; }
                if (!bounded && ck < -1 && stepK <= 0) break; // fell below the world
            }
            faceAxis = -1;
            return false;
        }
    }
}
