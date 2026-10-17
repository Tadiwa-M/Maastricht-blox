using System.Collections.Generic;
using System.Runtime.InteropServices;
using Blox.Data;
using Blox.Gameplay;
using Blox.Meshing.Core;
using Blox.Rendering;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.Rendering;

namespace Blox.Editor.Tests
{
    /// <summary>
    /// Edit-mode tests (Window > General > Test Runner) that check the engine-free maths
    /// against Unity's own conventions, which the dotnet tests cannot see.
    /// </summary>
    public class LookConventionTests
    {
        [TestCase(0f, 0f, 100f)]
        [TestCase(30f, 45f, 250f)]
        [TestCase(-120f, 70f, 12f)]
        public void OrbitOffsetLooksAtTheTarget(float yaw, float tilt, float distance)
        {
            var target = new Vector3(700f, 18f, 1500f);
            MapCameraMath.OrbitOffset(yaw, tilt, distance, out float x, out float y, out float z);
            var position = target + new Vector3(x, y, z);
            var forward = Quaternion.Euler(90f - tilt, yaw, 0f) * Vector3.forward;
            var lookedAt = position + forward * distance;
            Assert.That(Vector3.Distance(lookedAt, target), Is.LessThan(1e-3f));
        }

        [TestCase(30.0, 135.0)]
        [TestCase(5.0, 270.0)]
        [TestCase(62.0, 180.0)]
        public void SunLightShinesAwayFromTheSun(double elevation, double azimuth)
        {
            SolarPosition.DirectionToSun(new SunAngles(elevation, azimuth), out float x, out float y, out float z);
            // TimeOfDayController's rotation for this sun position:
            var forward = Quaternion.Euler((float)elevation, (float)azimuth + 180f, 0f) * Vector3.forward;
            Assert.That(Vector3.Distance(forward, -new Vector3(x, y, z)), Is.LessThan(1e-4f));
        }

        [Test]
        public void StudRotationMatchesQuaternionEuler()
        {
            // Stud.shader rotates (1, 0, 0) by angle a to (cos a, 0, -sin a).
            float a = 37f;
            var unity = Quaternion.Euler(0f, a, 0f) * Vector3.right;
            float r = a * Mathf.Deg2Rad;
            Assert.That(Vector3.Distance(unity, new Vector3(Mathf.Cos(r), 0f, -Mathf.Sin(r))), Is.LessThan(1e-5f));
        }

        [Test]
        public void StudInstanceMatchesTheShaderStride()
        {
            Assert.AreEqual(32, Marshal.SizeOf<StudInstance>());
        }

        [Test]
        public void StudMeshesHaveBrickSystemDimensions()
        {
            var near = StudMeshes.CreateNear();
            var mid = StudMeshes.CreateMid();
            try
            {
                Assert.AreEqual(IndexFormat.UInt16, near.indexFormat);
                Assert.That(near.bounds.extents.x, Is.EqualTo(0.15f).Within(1e-4f));
                Assert.That(near.bounds.max.y, Is.EqualTo(0.1125f).Within(1e-4f));
                Assert.That(mid.GetIndexCount(0), Is.LessThan(near.GetIndexCount(0)));
            }
            finally
            {
                Object.DestroyImmediate(near);
                Object.DestroyImmediate(mid);
            }
        }

        [Test]
        public void PlannerListsNearestChunksFirstWithTheirLevels()
        {
            var chunks = new List<ManifestChunk>
            {
                new ManifestChunk { Cx = 22, Cy = 47, File = "chunks/c_22_47.bxc", Bricks = 1, MinK = 80, MaxK = 220 },
                new ManifestChunk { Cx = 40, Cy = 47, File = "chunks/c_40_47.bxc", Bricks = 1, MinK = 80, MaxK = 120 },
                new ManifestChunk { Cx = 23, Cy = 47, File = "chunks/c_23_47.bxc", Bricks = 1, MinK = 80, MaxK = 120 },
            };
            var planner = new ChunkLodPlanner(WorldSpec.Contract, chunks);
            var camera = new Vector3(22 * 32 + 16, 40f, 47 * 32 + 16);     // above chunk (22, 47)
            var work = planner.Plan(camera, ChunkLodPolicy.Default, 4000f, _ => -1, new HashSet<ChunkCoord>());
            Assert.AreEqual(3, work.Count);
            Assert.AreEqual(new ChunkCoord(22, 47), work[0].Coord);
            Assert.AreEqual(0, work[0].Level);
            Assert.AreEqual(new ChunkCoord(23, 47), work[1].Coord);
            Assert.AreEqual(1, work[2].Level);  // ~560 m away: HLOD factor 2 (260..600 m)
        }
    }
}
