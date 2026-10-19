using System;
using System.Collections.Generic;
using Blox.Gameplay;
using Xunit;

namespace Blox.LookTests
{
    public class WalkCycleTests
    {
        [Fact]
        public void LegsSwingOppositeAndArmsCounterSwing()
        {
            var w = new WalkCycle();
            for (int n = 0; n < 30; n++) w.Step(1.2f / 60f, 1f / 60f);   // walk at 1.2 m/s
            Assert.NotEqual(0f, w.LegLeftDeg);
            Assert.Equal(-w.LegLeftDeg, w.LegRightDeg, 5);
            Assert.Equal(-w.LegLeftDeg * w.ArmRatio, w.ArmLeftDeg, 5);
            Assert.Equal(w.LegLeftDeg * w.ArmRatio, w.ArmRightDeg, 5);
            Assert.InRange(Math.Abs(w.LegLeftDeg), 0, w.LegSwingDeg + 1e-3f);
            Assert.Equal(w.LegRightDeg, w.AngleFor("leg_r"));
            Assert.Equal(0f, w.AngleFor("head"));
        }

        [Fact]
        public void PhaseFollowsDistanceNotTime()
        {
            var a = new WalkCycle();
            var b = new WalkCycle();
            a.Step(0.7f, 1f);          // one stride in one second
            b.Step(0.7f, 0.25f);       // the same stride, faster
            Assert.Equal(a.Phase, b.Phase, 5);
            Assert.Equal((float)Math.PI, a.Phase, 4);
        }

        [Fact]
        public void SwingFadesOutWhenStopped()
        {
            var w = new WalkCycle();
            for (int n = 0; n < 60; n++) w.Step(0.02f, 1f / 60f);
            Assert.True(w.Amplitude > 0.5f);
            for (int n = 0; n < 120; n++) w.Step(0f, 1f / 60f);
            Assert.True(w.Amplitude < 0.01f);
            Assert.InRange(Math.Abs(w.LegLeftDeg), 0, 0.5f);
        }
    }

    public class GroundProbeTests
    {
        // Column (0, 0): ground top at k = 10 (cells 0..9 solid); column (1, 0): a 2-plate kerb;
        // column (2, 0): a wall up to k = 40; column (3, 0): nothing.
        private static readonly HashSet<(int, int, int)> Solid = Build();

        private static HashSet<(int, int, int)> Build()
        {
            var s = new HashSet<(int, int, int)>();
            for (int k = 0; k < 10; k++) s.Add((0, 0, k));
            for (int k = 0; k < 12; k++) s.Add((1, 0, k));
            for (int k = 0; k < 40; k++) s.Add((2, 0, k));
            return s;
        }

        private static bool IsSolid(int i, int j, int k) => Solid.Contains((i, j, k));

        [Fact]
        public void FindsFlatGroundStepsUpKerbsAndStopsAtWalls()
        {
            Assert.Equal(GroundResult.Ground, GroundProbe.Find(IsSolid, 0, 0, 10, 3, 6, 10, out int g));
            Assert.Equal(10, g);
            Assert.Equal(GroundResult.Ground, GroundProbe.Find(IsSolid, 1, 0, 10, 3, 6, 10, out g));
            Assert.Equal(12, g);
            Assert.Equal(GroundResult.Blocked, GroundProbe.Find(IsSolid, 2, 0, 10, 3, 6, 10, out _));
            Assert.Equal(GroundResult.NoGround, GroundProbe.Find(IsSolid, 3, 0, 10, 3, 6, 10, out g));
            Assert.Equal(10, g);
            // Stepping down off the kerb.
            Assert.Equal(GroundResult.Ground, GroundProbe.Find(IsSolid, 0, 0, 12, 3, 6, 10, out g));
            Assert.Equal(10, g);
        }
    }

    public class CharacterMotionTests
    {
        [Theory]
        [InlineData(0f, 0f, 1f, 0f, 1f)]      // camera looks north: W walks north
        [InlineData(90f, 0f, 1f, 1f, 0f)]     // camera looks east: W walks east
        [InlineData(0f, 1f, 0f, 1f, 0f)]      // camera looks north: D walks east
        [InlineData(90f, 1f, 0f, 0f, -1f)]    // camera looks east: D walks south
        public void InputIsRelativeToTheCamera(float camYaw, float right, float fwd, float dx, float dz)
        {
            CharacterMotion.MoveDirection(right, fwd, camYaw, out float x, out float z);
            Assert.Equal(dx, x, 4);
            Assert.Equal(dz, z, 4);
        }

        [Fact]
        public void DiagonalInputIsNotFaster()
        {
            CharacterMotion.MoveDirection(1, 1, 0, out float x, out float z);
            Assert.Equal(1f, (float)Math.Sqrt(x * x + z * z), 4);
        }

        [Fact]
        public void TurnsTheShortWayAtLimitedSpeed()
        {
            Assert.Equal(340f, CharacterMotion.TurnToward(10f, -1f, 0f, 30f, 1f), 3);   // toward west, via north
            Assert.Equal(90f, CharacterMotion.TurnToward(80f, 1f, 0f, 720f, 1f), 3);    // reaches the target
            Assert.Equal(80f, CharacterMotion.TurnToward(80f, 0f, 0f, 720f, 1f), 3);    // no input: keep
        }
    }
}
