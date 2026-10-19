using System;

namespace Blox.Gameplay
{
    /// <summary>
    /// Leg and arm swing for walking brick figures (CONTRACT 7.1: parts rotate about their
    /// pivot's local i axis). Feed it the distance moved each frame; it returns swing angles.
    ///
    /// <para>The phase advances with distance, not time, so feet never slide: one full cycle
    /// (left step + right step) covers two strides. The swing size grows with speed up to
    /// <see cref="FullSwingSpeedMps"/> and eases back to zero when the figure stops.</para>
    ///
    /// <para>Sign: a positive angle swings the limb's lower end <b>forward</b> (toward the
    /// model's front). Legs swing opposite to each other; each arm swings opposite to its leg.
    /// In Unity (left-handed) "forward" is a <i>negative</i> rotation about +x, so apply
    /// <c>Quaternion.Euler(-angle, 0, 0)</c> (see CharacterWalker).</para>
    /// </summary>
    public sealed class WalkCycle
    {
        /// <summary>Metres per step (one foot passing the other).</summary>
        public float StrideM { get; set; } = 0.7f;
        /// <summary>Peak leg swing at full speed, degrees.</summary>
        public float LegSwingDeg { get; set; } = 32f;
        /// <summary>Arms swing this fraction of the legs.</summary>
        public float ArmRatio { get; set; } = 0.8f;
        /// <summary>Speed at which the swing reaches its peak (m/s).</summary>
        public float FullSwingSpeedMps { get; set; } = 1.2f;
        /// <summary>How fast the swing size follows the speed (1/s).</summary>
        public float Sharpness { get; set; } = 8f;

        public float Phase { get; private set; }       // radians, grows with distance
        public float Amplitude { get; private set; }   // 0..1 of LegSwingDeg

        public float LegLeftDeg { get; private set; }
        public float LegRightDeg { get; private set; }
        public float ArmLeftDeg { get; private set; }
        public float ArmRightDeg { get; private set; }

        /// <summary>Advances by <paramref name="distanceM"/> moved during <paramref name="dt"/> seconds.</summary>
        public void Step(float distanceM, float dt)
        {
            float speed = dt > 0 ? Math.Abs(distanceM) / dt : 0f;
            float target = Math.Min(1f, speed / Math.Max(1e-3f, FullSwingSpeedMps));
            Amplitude += (target - Amplitude) * (1f - (float)Math.Exp(-Sharpness * Math.Max(0f, dt)));
            Phase += Math.Abs(distanceM) / Math.Max(1e-3f, StrideM) * (float)Math.PI;
            if (Phase > 2 * Math.PI * 1000) Phase -= (float)(2 * Math.PI * 1000); // keep float precision
            float leg = (float)Math.Sin(Phase) * LegSwingDeg * Amplitude;
            LegLeftDeg = leg;
            LegRightDeg = -leg;
            ArmLeftDeg = -leg * ArmRatio;
            ArmRightDeg = leg * ArmRatio;
        }

        /// <summary>Swing angle for a part by its contract name (leg_l, leg_r, arm_l, arm_r); 0 for others.</summary>
        public float AngleFor(string part) => part switch
        {
            "leg_l" => LegLeftDeg,
            "leg_r" => LegRightDeg,
            "arm_l" => ArmLeftDeg,
            "arm_r" => ArmRightDeg,
            _ => 0f,
        };
    }
}
