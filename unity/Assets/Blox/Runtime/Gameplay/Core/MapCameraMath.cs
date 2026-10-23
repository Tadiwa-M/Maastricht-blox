using System;

namespace Blox.Gameplay
{
    /// <summary>
    /// Engine-free maths of the map camera (unit tested with dotnet). Conventions: yaw in
    /// degrees clockwise from north (+Z) seen from above, tilt in degrees from straight down
    /// (0 = top-down map, 90 = horizon), distances in metres.
    /// </summary>
    public static class MapCameraMath
    {
        /// <summary>Frame-rate independent exponential approach of <paramref name="target"/>.</summary>
        public static float Damp(float current, float target, float sharpness, float dt)
        {
            if (sharpness <= 0) return target;
            return current + (target - current) * (1f - (float)Math.Exp(-sharpness * dt));
        }

        /// <summary>Like <see cref="Damp"/> for angles, along the shortest way round.</summary>
        public static float DampAngle(float current, float target, float sharpness, float dt)
        {
            float delta = DeltaAngle(current, target);
            return Damp(current, current + delta, sharpness, dt);
        }

        public static float DeltaAngle(float from, float to)
        {
            float d = (to - from) % 360f;
            if (d > 180f) d -= 360f;
            if (d < -180f) d += 360f;
            return d;
        }

        /// <summary>Distance multiplier for a number of wheel notches (positive = zoom in).</summary>
        public static float ZoomFactor(float notches, float ratioPerNotch) => (float)Math.Pow(ratioPerNotch, notches);

        /// <summary>
        /// Automatic tilt for a camera distance: steep (map-like) when far, oblique (street-like)
        /// when close, interpolated on a log scale between the two reference distances.
        /// </summary>
        public static float TiltForDistance(float distance, float nearDistance, float nearTilt, float farDistance, float farTilt)
        {
            if (distance <= nearDistance) return nearTilt;
            if (distance >= farDistance) return farTilt;
            float t = (float)(Math.Log(distance / nearDistance) / Math.Log(farDistance / nearDistance));
            t = t * t * (3f - 2f * t);
            return nearTilt + (farTilt - nearTilt) * t;
        }

        /// <summary>
        /// Zoom about a ground pivot: scales the orbit target's offset from the pivot by the same
        /// factor as the distance, which keeps the pivot under the cursor (exact for a fixed tilt).
        /// </summary>
        public static void ZoomAbout(float targetX, float targetZ, float pivotX, float pivotZ, float factor,
                                     out float newX, out float newZ)
        {
            newX = pivotX + (targetX - pivotX) * factor;
            newZ = pivotZ + (targetZ - pivotZ) * factor;
        }

        /// <summary>Camera offset from the orbit target for yaw / tilt / distance.</summary>
        public static void OrbitOffset(float yawDeg, float tiltDeg, float distance, out float x, out float y, out float z)
        {
            double yaw = yawDeg * Math.PI / 180.0, tilt = tiltDeg * Math.PI / 180.0;
            double horiz = Math.Sin(tilt) * distance;
            x = (float)(-Math.Sin(yaw) * horiz);
            z = (float)(-Math.Cos(yaw) * horiz);
            y = (float)(Math.Cos(tilt) * distance);
        }

        /// <summary>
        /// Bokeh focal length (mm) giving a tilt-shift "miniature" blur of similar strength at
        /// every orbit distance: circle of confusion scales with f^2 / focus, so f grows with
        /// sqrt(focus). <paramref name="mmAt100m"/> is the focal length at 100 m focus.
        /// Clamped to URP's DepthOfField range.
        /// </summary>
        public static float TiltShiftFocalLength(float focusDistance, float mmAt100m, float minMm = 1f, float maxMm = 300f)
        {
            float f = mmAt100m * (float)Math.Sqrt(Math.Max(focusDistance, 0.01f) / 100f);
            return Math.Max(minMm, Math.Min(maxMm, f));
        }

        /// <summary>Intersection of a ray with the horizontal plane y = h; false if parallel or behind.</summary>
        public static bool RayPlaneY(float ox, float oy, float oz, float dx, float dy, float dz, float h,
                                     out float hx, out float hz)
        {
            hx = hz = 0;
            if (Math.Abs(dy) < 1e-6f) return false;
            float t = (h - oy) / dy;
            if (t <= 0) return false;
            hx = ox + dx * t;
            hz = oz + dz * t;
            return true;
        }

        public static float Clamp(float v, float lo, float hi) => v < lo ? lo : v > hi ? hi : v;
    }
}
