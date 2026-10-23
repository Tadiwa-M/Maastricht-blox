using System;

namespace Blox.Gameplay
{
    /// <summary>
    /// Third-person movement maths: turn WASD input into a direction on the ground, relative
    /// to where the camera looks, and turn the figure smoothly toward it. Yaw is degrees
    /// clockwise from north (+z), the same convention as <see cref="Blox.Data.Pose"/> and the
    /// map camera, so "W" always walks away from the camera.
    /// </summary>
    public static class CharacterMotion
    {
        /// <summary>
        /// Input (right, forward), each in [-1, 1], seen from a camera with yaw
        /// <paramref name="cameraYawDeg"/> -> world direction (dx east, dz north), length at most 1.
        /// </summary>
        public static void MoveDirection(float right, float forward, float cameraYawDeg, out float dx, out float dz)
        {
            double yaw = cameraYawDeg * Math.PI / 180.0;
            float s = (float)Math.Sin(yaw), c = (float)Math.Cos(yaw);
            // Camera forward = (sin, cos); camera right = (cos, -sin).
            dx = forward * s + right * c;
            dz = forward * c - right * s;
            float len = (float)Math.Sqrt(dx * dx + dz * dz);
            if (len > 1f) { dx /= len; dz /= len; }
        }

        /// <summary>
        /// Turns <paramref name="currentYawDeg"/> toward the direction (dx, dz) along the shortest
        /// way, at most <paramref name="maxDegPerSec"/> * dt degrees. Returns the current yaw if
        /// there is no direction.
        /// </summary>
        public static float TurnToward(float currentYawDeg, float dx, float dz, float maxDegPerSec, float dt)
        {
            if (dx * dx + dz * dz < 1e-8f) return currentYawDeg;
            float target = (float)(Math.Atan2(dx, dz) * 180.0 / Math.PI);
            float delta = MapCameraMath.DeltaAngle(currentYawDeg, target);
            float step = maxDegPerSec * Math.Max(0f, dt);
            float yaw = currentYawDeg + Math.Max(-step, Math.Min(step, delta));
            yaw %= 360f;
            return yaw < 0 ? yaw + 360f : yaw;
        }
    }
}
