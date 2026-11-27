using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Meshing;
using NUnit.Framework;
using UnityEngine;

namespace Blox.Editor.Tests
{
    /// <summary>
    /// <see cref="PendingChunkMesh.Complete"/> with the Editor's collections safety checks on
    /// (release players have none). Regression: a chunk with no glass threw
    /// "dstIndex is outside the range" on the empty transparent-index copy and stayed invisible,
    /// which left most of a real city blank in Editor Play mode.
    /// </summary>
    public class ChunkMeshCompleteTests
    {
        private static string TownWorld =>
            Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "pipeline", "tests", "fixtures", "town_world"));

        [Test]
        public void EveryTownChunkCompletesIncludingGlassFreeOnes()
        {
            var world = WorldFiles.Open(TownWorld);
            var coords = world.AvailableChunks.Select(c => c.Coord).ToList();
            foreach (var c in coords) world.Load(c);
            int glassFree = 0;
            using (var builder = new ChunkMeshBuilder(world))
            {
                foreach (var c in coords)
                {
                    var pending = builder.Schedule(c);
                    Assert.That(pending, Is.Not.Null, $"chunk {c} not loaded");
                    var mesh = new Mesh();
                    try
                    {
                        var result = pending!.Complete(mesh);
                        Assert.That(mesh.subMeshCount, Is.EqualTo(2), $"chunk {c}");
                        Assert.That(mesh.GetIndexCount(0), Is.EqualTo((uint)(result.OpaqueTriangles * 3)), $"chunk {c}");
                        if (result.TransparentTriangles == 0 && result.OpaqueTriangles > 0) glassFree++;
                    }
                    finally { Object.DestroyImmediate(mesh); }
                }
            }
            Assert.That(glassFree, Is.GreaterThan(0), "the fixture no longer has a glass-free chunk, so this test covers nothing");
        }
    }
}
