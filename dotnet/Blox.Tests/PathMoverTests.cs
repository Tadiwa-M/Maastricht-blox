using System;
using Blox.Data;
using Blox.Live;
using Xunit;

namespace Blox.Tests
{
    /// <summary>Path + distance -> pose (CONTRACT 7.1), shared by buses, followers and walkers.</summary>
    public class PathMoverTests
    {
        // An L: 10 m east, then 10 m north.
        private static PathMover L(float r = 0f, bool loop = false) =>
            PathMover.FromXZ(new[] { 0f, 10f, 10f }, new[] { 0f, 0f, 10f }, loop, r);

        [Fact]
        public void YawIsClockwiseFromNorth()
        {
            Assert.Equal(0f, Pose.YawOf(0, 1));
            Assert.Equal(90f, Pose.YawOf(1, 0));
            Assert.Equal(180f, Pose.YawOf(0, -1));
            Assert.Equal(270f, Pose.YawOf(-1, 0));
            var p = new Pose(0, 0, 0, 90f);
            Assert.Equal((1f, 0f), ((float)Math.Round(p.ForwardX, 5), (float)Math.Round(p.ForwardZ, 5)));
        }

        [Fact]
        public void SharpPathFollowsSegments()
        {
            var m = L();
            Assert.Equal(20.0, m.LengthM, 5);
            Assert.Equal(new Pose(5, 0, 0, 90f), m.Evaluate(5));
            Assert.Equal(new Pose(10, 0, 5, 0f), m.Evaluate(15));
            Assert.Equal(new Pose(10, 0, 10, 0f), m.Evaluate(99));   // open paths clamp
            Assert.Equal(new Pose(0, 0, 0, 90f), m.Evaluate(-3));
        }

        [Fact]
        public void TurnRadiusSmoothsTheCornerAndKeepsStraightsExact()
        {
            var m = L(2f);
            // Away from the corner nothing changes, including right at the ends (axles extrapolate).
            Assert.Equal(new Pose(5, 0, 0, 90f), m.Evaluate(5));
            Assert.Equal(new Pose(0, 0, 0, 90f), m.Evaluate(0));
            Assert.Equal(new Pose(10, 0, 10, 0f), m.Evaluate(20));
            // At the corner the heading is half way (45 deg) and the position cuts inside.
            var c = m.Evaluate(10);
            Assert.Equal(45f, c.YawDeg, 3);
            Assert.Equal((9f, 1f), (c.X, c.Z));
            // Heading changes gradually: no step bigger than a few degrees per 0.1 m.
            float prev = m.Evaluate(7).YawDeg;
            for (double s = 7.1; s <= 13; s += 0.1)
            {
                float y = m.Evaluate(s).YawDeg;
                Assert.InRange(Math.Abs(y - prev), 0, 3.5);
                prev = y;
            }
        }

        [Fact]
        public void LoopsWrapAndCloseBackToTheStart()
        {
            var m = PathMover.FromXZ(new[] { 0f, 10f, 10f, 0f }, new[] { 0f, 0f, 10f, 10f }, loop: true);
            Assert.Equal(40.0, m.LengthM, 5);
            Assert.Equal(m.Evaluate(5), m.Evaluate(45));
            Assert.Equal(m.Evaluate(35), m.Evaluate(-5));
            Assert.Equal(new Pose(0, 0, 5, 180f), m.Evaluate(35));   // closing segment heads south
        }

        [Fact]
        public void HeightIsInterpolatedAndExplicitDistancesAreUsed()
        {
            var m = new PathMover(new[] { 0f, 10f }, new[] { 2f, 4f }, new[] { 0f, 0f }, cumDistM: new[] { 100f, 110f });
            var p = m.Evaluate(105);
            Assert.Equal((5f, 3f, 0f, 90f), (p.X, p.Y, p.Z, p.YawDeg));
            Assert.Throws<ArgumentException>(() => new PathMover(new[] { 0f, 1f }, null, new[] { 0f, 0f }, loop: true, cumDistM: new[] { 0f, 1f }));
        }

        [Fact]
        public void LiveBusesUseTheSamePoseType()
        {
            var shape = new ShapePolyline("s", new[] { 0f, 10f, 10f }, new[] { 0f, 0f, 10f }, new[] { 0f, 10f, 20f }) { TurnRadiusM = 2f };
            Assert.Equal(L(2f).Evaluate(10), shape.PoseAt(10));
            var vp = new VehiclePose { Valid = true, X = 3, Z = 4, HeadingDeg = 270 };
            Assert.Equal(new Pose(3, 18, 4, 270), vp.ToPose(18));
            var reg = new VehicleRegistry { TurnRadiusM = 5f };
            var dto = new ShapesDto();
            dto.Shapes.Add(new ShapeDto { ShapeId = "a", X = new[] { 0f, 1f }, Z = new[] { 0f, 0f }, CumDistM = new[] { 0f, 1f } });
            reg.SetShapes(dto);
            Assert.Equal(5f, reg.ShapeFor("a")!.TurnRadiusM);
        }
    }
}
