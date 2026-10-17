using System;

namespace Blox.Rendering
{
    /// <summary>
    /// Shadow range and cascade splits driven by the camera's height above the ground:
    /// close to the street the first cascade is a few metres deep (crisp stud shadows);
    /// from high up the range grows to cover what is on screen.
    /// </summary>
    public static class ShadowCascadeMath
    {
        /// <summary>Shadow distance (m) for a camera altitude above the ground (m).</summary>
        public static float ShadowDistance(float altitude, float perMetre, float min, float max)
        {
            float d = 30f + Math.Max(altitude, 0f) * perMetre;
            return Math.Max(min, Math.Min(max, d));
        }

        /// <summary>
        /// "Practical split scheme" (Zhang et al. 2006): blend of logarithmic and uniform splits.
        /// Returns the three inner split points of four cascades as fractions of
        /// <paramref name="far"/> (what UniversalRenderPipelineAsset.cascade4Split expects).
        /// </summary>
        public static void PracticalSplits(float near, float far, float lambda, out float s1, out float s2, out float s3)
        {
            if (far <= 0) throw new ArgumentOutOfRangeException(nameof(far));
            near = Math.Max(0.05f, Math.Min(near, far * 0.5f));
            lambda = Math.Max(0f, Math.Min(1f, lambda));
            s1 = Split(1); s2 = Split(2); s3 = Split(3);

            float Split(int i)
            {
                float p = i / 4f;
                float log = near * (float)Math.Pow(far / near, p);
                float uni = near + (far - near) * p;
                return (lambda * log + (1f - lambda) * uni) / far;
            }
        }

        /// <summary>True when a value changed by more than a relative tolerance (avoids asset churn).</summary>
        public static bool Changed(float current, float next, float relTolerance) =>
            Math.Abs(next - current) > Math.Abs(current) * relTolerance + 1e-4f;
    }
}
