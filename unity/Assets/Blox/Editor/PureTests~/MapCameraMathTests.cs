using System;
using Blox.Gameplay;
using Xunit;

namespace Blox.LookTests
{
    public class MapCameraMathTests
    {
        [Fact]
        public void DampIsFrameRateIndependent()
        {
            float a = 0, b = 0;
            for (int n = 0; n < 60; n++) a = MapCameraMath.Damp(a, 10, 8, 1f / 60f);
            for (int n = 0; n < 30; n++) b = MapCameraMath.Damp(b, 10, 8, 1f / 30f);
            Assert.Equal(a, b, 3);
            Assert.InRange(a, 9.99f, 10f);
        }

        [Fact]
        public void DampAngleTakesShortestWay()
        {
            float v = MapCameraMath.DampAngle(350, 10, 1000, 1);
            Assert.Equal(370f, v, 3);
            Assert.Equal(-20f, MapCameraMath.DeltaAngle(10, 350), 3);
        }

        [Fact]
        public void ZoomFactorIsExponential()
        {
            Assert.Equal(1f, MapCameraMath.ZoomFactor(0, 0.8f));
            Assert.Equal(0.64f, MapCameraMath.ZoomFactor(2, 0.8f), 5);
            Assert.Equal(MapCameraMath.ZoomFactor(1, 0.8f) * MapCameraMath.ZoomFactor(1, 0.8f), MapCameraMath.ZoomFactor(2, 0.8f), 5);
            Assert.Equal(1.25f, MapCameraMath.ZoomFactor(-1, 0.8f), 5);
        }

        [Fact]
        public void TiltIncreasesWhenZoomingIn()
        {
            float far = MapCameraMath.TiltForDistance(2000, 30, 62, 1500, 10);
            float mid = MapCameraMath.TiltForDistance(200, 30, 62, 1500, 10);
            float near = MapCameraMath.TiltForDistance(10, 30, 62, 1500, 10);
            Assert.Equal(10f, far);
            Assert.Equal(62f, near);
            Assert.True(far < mid && mid < near);
        }

        [Fact]
        public void ZoomAboutKeepsThePivotFixed()
        {
            // Pivot stays where it is; the target moves toward it by the zoom factor.
            MapCameraMath.ZoomAbout(100, 100, 120, 80, 0.5f, out float x, out float z);
            Assert.Equal(110f, x, 4);
            Assert.Equal(90f, z, 4);
            MapCameraMath.ZoomAbout(120, 80, 120, 80, 0.5f, out x, out z);
            Assert.Equal(120f, x, 4);
            Assert.Equal(80f, z, 4);
        }

        [Fact]
        public void OrbitOffsetMatchesUnityEulerConvention()
        {
            // Top-down: straight above.
            MapCameraMath.OrbitOffset(0, 0, 100, out float x, out float y, out float z);
            Assert.Equal(0f, x, 4); Assert.Equal(100f, y, 4); Assert.Equal(0f, z, 4);
            // Yaw 0 looks north, so the camera sits south of the target (-Z).
            MapCameraMath.OrbitOffset(0, 45, 100, out x, out y, out z);
            Assert.Equal(0f, x, 4); Assert.True(z < 0); Assert.Equal(70.71f, y, 1);
            // Yaw 90 looks east, camera west of the target (-X).
            MapCameraMath.OrbitOffset(90, 60, 10, out x, out _, out z);
            Assert.True(x < 0); Assert.Equal(0f, z, 4);
            Assert.Equal(10f, MathF.Sqrt(x * x + 25f), 3); // |offset| = distance (y = 5)
        }

        [Fact]
        public void TiltShiftFocalLengthScalesWithSqrtOfFocusAndClamps()
        {
            Assert.Equal(200f, MapCameraMath.TiltShiftFocalLength(100, 200), 3);
            Assert.Equal(100f, MapCameraMath.TiltShiftFocalLength(25, 200), 3);
            Assert.Equal(300f, MapCameraMath.TiltShiftFocalLength(10000, 200), 3);
            Assert.Equal(1f, MapCameraMath.TiltShiftFocalLength(0, 50), 3);    // 50 * sqrt(0.01 / 100) = 0.5 -> min 1
        }

        [Fact]
        public void RayPlaneIntersection()
        {
            Assert.True(MapCameraMath.RayPlaneY(0, 10, 0, 0.6f, -0.8f, 0, 2, out float hx, out float hz));
            Assert.Equal(6f, hx, 4);
            Assert.Equal(0f, hz, 4);
            Assert.False(MapCameraMath.RayPlaneY(0, 10, 0, 0, 1, 0, 2, out _, out _));   // looking up
            Assert.False(MapCameraMath.RayPlaneY(0, 10, 0, 1, 0, 0, 2, out _, out _));   // parallel
        }
    }
}
