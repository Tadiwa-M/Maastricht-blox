#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Grid ray cast (Amanatides &amp; Woo DDA) through loaded chunks in Unity world metres.
    /// Bricks count as their full bounding box (slopes are hit as boxes); good enough for
    /// picking features and placing the camera, not for exact sloped-surface hits.
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
            // Work in cell units: x/z in studs, y in plates.
            double px = ox / sx, py = oy / sy, pz = oz / sx;
            double vx = dx / sx, vy = dy / sy, vz = dz / sx;
            int ci = (int)Math.Floor(px), ck = (int)Math.Floor(py), cj = (int)Math.Floor(pz);
            int stepI = Math.Sign(vx), stepK = Math.Sign(vy), stepJ = Math.Sign(vz);
            if (stepI == 0 && stepK == 0 && stepJ == 0) return false;
            double tDeltaI = stepI != 0 ? Math.Abs(1.0 / vx) : double.PositiveInfinity;
            double tDeltaK = stepK != 0 ? Math.Abs(1.0 / vy) : double.PositiveInfinity;
            double tDeltaJ = stepJ != 0 ? Math.Abs(1.0 / vz) : double.PositiveInfinity;
            double tMaxI = stepI != 0 ? ((stepI > 0 ? ci + 1 - px : px - ci) * tDeltaI) : double.PositiveInfinity;
            double tMaxK = stepK != 0 ? ((stepK > 0 ? ck + 1 - py : py - ck) * tDeltaK) : double.PositiveInfinity;
            double tMaxJ = stepJ != 0 ? ((stepJ > 0 ? cj + 1 - pz : pz - cj) * tDeltaJ) : double.PositiveInfinity;
            double t = 0;
            int guard = 0;
            while (t <= maxDistance && guard++ < 1_000_000)
            {
                if (world.TryGetBrick(ci, cj, ck, out hit)) { distance = t; return true; }
                if (tMaxI <= tMaxJ && tMaxI <= tMaxK) { ci += stepI; t = tMaxI; tMaxI += tDeltaI; faceAxis = 0; }
                else if (tMaxJ <= tMaxK) { cj += stepJ; t = tMaxJ; tMaxJ += tDeltaJ; faceAxis = 2; }
                else { ck += stepK; t = tMaxK; tMaxK += tDeltaK; faceAxis = 1; }
                if (ck < -1 && stepK <= 0) break; // fell below the world
            }
            hit = default;
            faceAxis = -1;
            return false;
        }
    }
}
