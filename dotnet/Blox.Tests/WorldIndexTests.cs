using System;
using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    public class WorldIndexTests
    {
        private readonly Xunit.Abstractions.ITestOutputHelper _out;
        public WorldIndexTests(Xunit.Abstractions.ITestOutputHelper output) { _out = output; }

        private static WorldIndex EmptyWorld() =>
            new WorldIndex(WorldSpec.Contract, Repo.Palette, Repo.Catalogue, new FeatureSet(), Array.Empty<ManifestChunk>(), _ => null);

        private static ChunkData Chunk(int cx, int cy, params BrickRecord[] recs) =>
            ChunkReader.Read(ChunkWriter.Write(cx, cy, recs, Repo.Types), Repo.Types);

        [Fact]
        public void OccupancyCoversRotatedBoxes()
        {
            var w = EmptyWorld();
            // brick_2x4 rot 1 at local (10, 20, 100) occupies i 10..13, j 20..21, k 100..102.
            w.Add(Chunk(3, 4, new BrickRecord(10, 20, 100, Repo.TypeId("brick_2x4"), 4, 1, false, 9)));
            int I = 3 * 64, J = 4 * 64;
            Assert.True(w.IsSolid(I + 10, J + 20, 100));
            Assert.True(w.IsSolid(I + 13, J + 21, 102));
            Assert.False(w.IsSolid(I + 14, J + 20, 100));
            Assert.False(w.IsSolid(I + 10, J + 22, 100));
            Assert.False(w.IsSolid(I + 10, J + 20, 103));
            Assert.False(w.IsSolid(I + 10, J + 20, 99));
            Assert.True(w.TryGetBrick(I + 12, J + 21, 101, out var hit));
            Assert.Equal((I + 10, J + 20, 100), (hit.I, hit.J, hit.K));
            Assert.Equal(9u, hit.Record.featureId);
            Assert.Equal(103, w.ColumnTop(I + 11, J + 20));
            Assert.Equal(-1, w.ColumnTop(I, J));
            Assert.False(w.IsSolid(-5, -5, 0));
        }

        [Fact]
        public void StackedSpansResolveToTheRightBrick()
        {
            var w = EmptyWorld();
            byte b11 = Repo.TypeId("brick_1x1"), p11 = Repo.TypeId("plate_1x1");
            w.Add(Chunk(0, 0,
                new BrickRecord(1, 1, 0, p11, 1, 0),
                new BrickRecord(1, 1, 1, b11, 2, 0),
                new BrickRecord(1, 1, 10, p11, 3, 0)));
            Assert.True(w.TryGetBrick(1, 1, 0, out var a)); Assert.Equal(1, a.Record.color);
            Assert.True(w.TryGetBrick(1, 1, 3, out var b)); Assert.Equal(2, b.Record.color);
            Assert.False(w.IsSolid(1, 1, 4));
            Assert.False(w.IsSolid(1, 1, 9));
            Assert.True(w.TryGetBrick(1, 1, 10, out var c)); Assert.Equal(3, c.Record.color);
        }

        [Fact]
        public void FeatureLookupAndRaycast()
        {
            var features = FeatureSet.Parse("{\"features\":[{\"id\":5,\"kind\":\"building\",\"name\":\"Stadhuis\"}]}");
            var w = new WorldIndex(WorldSpec.Contract, Repo.Palette, Repo.Catalogue, features, Array.Empty<ManifestChunk>(), _ => null);
            w.Add(Chunk(0, 0, new BrickRecord(4, 4, 50, Repo.TypeId("brick_2x2"), 8, 0, false, 5)));
            Assert.Equal("Stadhuis", w.FeatureAt(5, 5, 51)!.Name);
            // Straight down from 100 m above the brick centre.
            Assert.True(WorldRaycast.Cast(w, 2.5, 100, 2.5, 0, -1, 0, 200, out var hit, out double dist, out int axis));
            Assert.Equal(5u, hit.Record.featureId);
            Assert.Equal(100 - 53 * 0.2, dist, 6);
            Assert.Equal(1, axis);
            // Diagonal ray from the west side.
            Assert.True(WorldRaycast.Cast(w, 0.1, 10.5, 2.6, 1, 0.01, 0, 10, out _, out double d2, out int axis2));
            Assert.Equal(2.0 - 0.1, d2, 6);
            Assert.Equal(0, axis2);
            Assert.False(WorldRaycast.Cast(w, 0.1, 10.5, 2.6, -1, 0, 0, 10, out _, out _, out _));
        }

        [Fact]
        public void LoaderIsUsedForAvailableChunksOnly()
        {
            int calls = 0;
            var data = Chunk(7, 8, new BrickRecord(0, 0, 0, Repo.TypeId("brick_1x1"), 1, 0));
            var w = new WorldIndex(WorldSpec.Contract, Repo.Palette, Repo.Catalogue, new FeatureSet(),
                new[] { new ManifestChunk { Cx = 7, Cy = 8, File = "chunks/c_07_08.bxc", Bricks = 1 } },
                c => { calls++; return data; });
            Assert.Null(w.Load(new ChunkCoord(1, 1)));
            Assert.NotNull(w.Load(new ChunkCoord(7, 8)));
            Assert.NotNull(w.Load(new ChunkCoord(7, 8)));
            Assert.Equal(1, calls);
            Assert.True(w.IsSolid(7 * 64, 8 * 64, 0));
            Assert.True(w.Unload(new ChunkCoord(7, 8)));
            Assert.False(w.IsSolid(7 * 64, 8 * 64, 0));
        }

        [Fact]
        public void OpensDirectoryWrittenToDisk()
        {
            string dir = Path.Combine(Path.GetTempPath(), "blox-world-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(dir, "chunks"));
            try
            {
                var bytes = ChunkWriter.Write(12, 40, new[] { new BrickRecord(1, 2, 60, Repo.TypeId("brick_1x2"), 4, 0) }, Repo.Types);
                File.WriteAllBytes(Path.Combine(dir, "chunks", "c_12_40.bxc"), bytes);
                File.Copy(Repo.PathOf("contract", "palette.json"), Path.Combine(dir, "palette.json"));
                File.Copy(Repo.PathOf("contract", "brick_catalogue.json"), Path.Combine(dir, "brick_catalogue.json"));
                File.WriteAllText(Path.Combine(dir, "features.json"), "{\"features\": []}");
                File.WriteAllText(Path.Combine(dir, "manifest.json"), $@"{{""contractVersion"":1,""crs"":""EPSG:28992"",""originRD"":[175700,316500],
""baseNapM"":30.0,""studM"":0.5,""plateM"":0.2,""chunkStuds"":64,""chunksX"":64,""chunksY"":64,
""palette"":""palette.json"",""catalogue"":""brick_catalogue.json"",""features"":""features.json"",""sources"":[],
""chunks"":[{{""cx"":12,""cy"":40,""file"":""chunks/c_12_40.bxc"",""bricks"":1,""minK"":60,""maxK"":63,""sha1"":""{WorldFiles.Sha1Hex(bytes)}""}}]}}");
                var w = WorldFiles.Open(dir, verifySha1: true);
                Assert.NotNull(w.Load(new ChunkCoord(12, 40)));
                Assert.True(w.IsSolid(12 * 64 + 1, 40 * 64 + 3, 62));
                File.WriteAllText(Path.Combine(dir, "manifest.json"), File.ReadAllText(Path.Combine(dir, "manifest.json")).Replace(WorldFiles.Sha1Hex(bytes), "00"));
                var bad = WorldFiles.Open(dir, verifySha1: true);
                Assert.Throws<ChunkFormatException>(() => bad.Load(new ChunkCoord(12, 40)));
            }
            finally { Directory.Delete(dir, true); }
        }

        [SkippableFact]
        public void TestsceneChunksLoadAndMeshIfPresent()
        {
            // BLOX_WORLD_DIR points this check at any pipeline output (e.g. build/world).
            string dir = Environment.GetEnvironmentVariable("BLOX_WORLD_DIR") is { Length: > 0 } env
                ? env : Repo.PathOf("build", "testscene");
            Skip.IfNot(File.Exists(Path.Combine(dir, "manifest.json")), $"{dir} not generated (pipeline testscene)");
            var w = WorldFiles.Open(dir, verifySha1: true);
            foreach (var c in w.AvailableChunks.ToList()) Assert.NotNull(w.Load(c.Coord));
            foreach (var cc in w.LoadedChunks.ToList())
            {
                var data = w.GetLoaded(cc)!;
                var own = data.Records.Select(r => PlacedBrick.From(r, cc.X, cc.Y)).ToArray();
                var s = MeshRunner.Run(cc.X, cc.Y, own);
                Assert.True(s.TriangleCount(0) + s.TriangleCount(1) > 0);
                MeshAssert.WindingMatchesNormals(s);
                // Culling must remove a substantial share of the naive 6-faces-per-brick count.
                Assert.True(s.Vertices.Count < own.Length * 24);
                _out.WriteLine($"{cc}: {own.Length} bricks -> {s.Vertices.Count} vertices, {s.TriangleCount(0)} opaque + {s.TriangleCount(1)} transparent triangles, {s.Studs.Count} exposed studs");
            }
        }
    }
}
