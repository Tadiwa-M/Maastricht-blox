#nullable enable
namespace Blox.Data
{
    /// <summary>
    /// Deterministic per-brick variation from the global cell (I, J, K) (CONTRACT section 4:
    /// variation is derived, never stored). The mesher bakes the result into the vertex
    /// colour (and UV2.y = Seed01, StudInstance.AngleDeg), so the shipped shaders never
    /// recompute it. Any future shader-side port must match this exactly; every operation is
    /// 32-bit unsigned integer math with wrap-around, so it ports to HLSL verbatim:
    ///
    /// <code>
    /// uint Seed(int I, int J, int K) {
    ///     uint v = (uint)I * 0x8DA6B343u ^ (uint)J * 0xD8163841u ^ (uint)K * 0xCB1AB31Fu;
    ///     return Pcg(v);
    /// }
    /// uint Pcg(uint v) {                      // PCG-RXS-M-XS 32 (Jarzynski &amp; Olano 2020)
    ///     uint state = v * 747796405u + 2891336453u;
    ///     uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    ///     return (word >> 22u) ^ word;
    /// }
    /// </code>
    /// Derived quantities (s = Seed):
    /// <list type="bullet">
    /// <item>value jitter  v = ((s &amp; 0xFF) / 255 * 2 - 1) * ValueAmplitude       (multiplies linear RGB by 1 + v)</item>
    /// <item>warmth jitter w = (((s >> 8) &amp; 0xFF) / 255 * 2 - 1) * WarmthAmplitude  (R *= 1 + w, B *= 1 - w)</item>
    /// <item>stud angle    a = ((s >> 16) &amp; 0xFFFF) / 65536 * 360 degrees about +Y</item>
    /// <item>seed01        = (s >> 8) / 16777216  (24-bit fraction, for shader extras)</item>
    /// </list>
    /// Bricks with the <c>no_variation</c> flag use v = w = 0 (exact colour, e.g. signage).
    /// A brick's seed uses its record min corner; a stud's seed uses the stud's own cell
    /// (I, J, K) where K is the level the stud sits on (brick top).
    /// </summary>
    public static class BrickVariation
    {
        public const float ValueAmplitude = 0.06f;
        public const float WarmthAmplitude = 0.02f;

        public static uint Pcg(uint v)
        {
            unchecked
            {
                uint state = v * 747796405u + 2891336453u;
                uint word = ((state >> (int)((state >> 28) + 4u)) ^ state) * 277803737u;
                return (word >> 22) ^ word;
            }
        }

        public static uint Seed(int i, int j, int k)
        {
            unchecked
            {
                uint v = ((uint)i * 0x8DA6B343u) ^ ((uint)j * 0xD8163841u) ^ ((uint)k * 0xCB1AB31Fu);
                return Pcg(v);
            }
        }

        public static float ValueJitter(uint seed) => ((seed & 0xFF) / 255f * 2f - 1f) * ValueAmplitude;
        public static float WarmthJitter(uint seed) => (((seed >> 8) & 0xFF) / 255f * 2f - 1f) * WarmthAmplitude;
        public static float StudAngleDeg(uint seed) => ((seed >> 16) & 0xFFFF) / 65536f * 360f;
        public static float Seed01(uint seed) => (seed >> 8) / 16777216f;

        /// <summary>Applies the jitter to a linear colour in place.</summary>
        public static void Apply(uint seed, bool noVariation, ref float r, ref float g, ref float b)
        {
            if (noVariation) return;
            float v = 1f + ValueJitter(seed);
            float w = WarmthJitter(seed);
            r *= v * (1f + w);
            g *= v;
            b *= v * (1f - w);
        }
    }
}
