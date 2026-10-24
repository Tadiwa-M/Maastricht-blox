using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Data.Json;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    /// <summary>
    /// v3 islands (CONTRACT 5.1): pose maths against contract/test_vectors/islands.json, the .bxi
    /// reader/writer, island occupancy, meshing on the island grid, studs to world, island LOD,
    /// picking through rotated islands, and opening a world directory with islands.
    /// </summary>
    public class IslandTests
    {
        private static readonly byte Brick2x4 = Repo.TypeId("brick_2x4");
        private static readonly byte Brick1x1 = Repo.TypeId("brick_1x1");
        private static readonly byte Plate2x2 = Repo.TypeId("plate_2x2");

        // ---- pose ---------------------------------------------------------------------------

        public static IEnumerable<object[]> PoseCases()
        {
            var root = JsonParser.Parse(File.ReadAllText(Repo.PathOf("contract", "test_vectors", "islands.json")));
            for (int n = 0; n < root["cases"].Count; n++) yield return new object[] { n };
        }

        private static JsonNode PoseCase(int index) =>
            JsonParser.Parse(File.ReadAllText(Repo.PathOf("contract", "test_vectors", "islands.json")))["cases"][index];

        /// <summary>The vectors are rounded to 6 decimals, so compare with an absolute tolerance.</summary>
        private static void Near(double expected, double actual, double tol) =>
            Assert.True(Math.Abs(expected - actual) <= tol, $"expected {expected}, got {actual}");

        [Fact]
        public void PoseVectorsFileHasCases()
        {
            var root = JsonParser.Parse(File.ReadAllText(Repo.PathOf("contract", "test_vectors", "islands.json")));
            Assert.True(root["cases"].Count >= 4);
        }

        [Theory]
        [MemberData(nameof(PoseCases))]
        public void LocalToWorldMatchesContractVectors(int index)
        {
            var c = PoseCase(index);
            var pose = new IslandPose(c["origin"][0].AsDouble, c["origin"][1].AsDouble, c["yawDeg"].AsDouble);
            foreach (var p in c["points"].Items)
            {
                double u = p[0].AsDouble, v = p[1].AsDouble, x = p[2].AsDouble, z = p[3].AsDouble;
                pose.LocalToWorld(u, v, out double gx, out double gz);
                Near(x, gx, 2e-6);
                Near(z, gz, 2e-6);
                // Inverse.
                pose.WorldToLocal(x, z, out double bu, out double bv);
                Near(u, bu, 1e-5);
                Near(v, bv, 1e-5);
            }
        }

        /// <summary>
        /// The Unity transform (position (originX, 0, originZ), rotation Euler(0, yaw, 0)) must equal
        /// the contract map. UnityEulerY spells out Unity's Y rotation; this pins that no sign flip
        /// is needed between "yaw clockwise from north" and Unity's left-handed Y rotation.
        /// </summary>
        [Theory]
        [MemberData(nameof(PoseCases))]
        public void UnityTransformMatchesContractVectors(int index)
        {
            var c = PoseCase(index);
            double ox = c["origin"][0].AsDouble, oz = c["origin"][1].AsDouble, yaw = c["yawDeg"].AsDouble;
            foreach (var p in c["points"].Items)
            {
                IslandPose.UnityEulerY(yaw, p[0].AsDouble, p[1].AsDouble, out double rx, out double rz);
                Near(p[2].AsDouble, ox + rx, 2e-6);
                Near(p[3].AsDouble, oz + rz, 2e-6);
            }
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(20.0)]
        [InlineData(-33.5)]
        [InlineData(45.0)]
        public void LocalAxesFollowTheContract(double yaw)
        {
            var pose = new IslandPose(10, 20, yaw);
            double r = yaw * Math.PI / 180;
            pose.LocalDirToWorld(0, 1, out double jx, out double jz);   // local +j -> (sin, cos)
            Assert.Equal(Math.Sin(r), jx, 12);
            Assert.Equal(Math.Cos(r), jz, 12);
            pose.LocalDirToWorld(1, 0, out double ix, out double iz);   // local +i -> (cos, -sin)
            Assert.Equal(Math.Cos(r), ix, 12);
            Assert.Equal(-Math.Sin(r), iz, 12);
            pose.WorldDirToLocal(jx, jz, out double du, out double dv);
            Assert.Equal(0, du, 12);
            Assert.Equal(1, dv, 12);
            // Unity: Euler(0, a, 0) * (1, 0, 0) = (cos a, 0, -sin a); same as local +i.
            IslandPose.UnityEulerY(yaw, 1, 0, out double ux, out double uz);
            Assert.Equal(ix, ux, 12);
            Assert.Equal(iz, uz, 12);
            // Positive yaw turns north toward east (clockwise seen from above).
            if (yaw > 0) Assert.True(jx > 0);
        }

        // ---- .bxi reader / writer ---------------------------------------------------------------

        private static BrickRecord[] SampleRecords() => new[]
        {
            new BrickRecord(200, 10, 300, Brick2x4, 4, 1, false, 77),
            new BrickRecord(0, 0, 250, Plate2x2, 12, 0),
            new BrickRecord(5, 250, 251, Brick1x1, 3, 0, true, 0, hideStuds: true),
        };

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void IslandFileRoundTrips(bool compress)
        {
            var pose = new IslandPose(612.25, 1344.5, -33.5);
            byte[] file = IslandWriter.Write(42, 12, 40, pose, SampleRecords(), compress);
            Assert.Equal((byte)'B', file[0]);
            Assert.Equal((byte)'I', file[2]);
            var d = IslandReader.Read(file, Repo.Types, 42);
            Assert.Equal(42u, d.Id);
            Assert.Equal(new ChunkCoord(12, 40), d.Owner);
            Assert.Equal(612.25f, d.Header.OriginX);
            Assert.Equal(1344.5f, d.Header.OriginZ);
            Assert.Equal(-33.5f, d.Header.YawDeg);
            Assert.Equal(compress, d.Header.Compressed);
            Assert.Equal(3, d.Count);
            // Written in (k, j, i) order; LOCAL i/j up to 255 survive.
            Assert.Equal(new[] { 250, 251, 300 }, d.Records.Select(r => (int)r.k));
            var big = d.Records[2];
            Assert.Equal((200, 10, 1, 77u), (big.i, big.j, big.Rot, big.featureId));
            Assert.True(d.Records[1].HideStuds);
            Assert.True(d.Records[1].NoVariation);
            Assert.Equal(file.Length, IslandHeader.Size + (int)d.Header.BodyBytes);
        }

        [Fact]
        public void HeaderLayoutIsFortyBytesLittleEndian()
        {
            byte[] file = IslandWriter.Write(0x01020304, 7, 9, new IslandPose(1.5, -2.0, 20), Array.Empty<BrickRecord>(), compress: false);
            Assert.Equal(40, file.Length);
            Assert.Equal(new byte[] { 0x42, 0x58, 0x49, 0x31, 1, 0, 0, 0, 4, 3, 2, 1, 7, 0, 0, 0, 9, 0, 0, 0 }, file.Take(20).ToArray());
            Assert.Equal(1.5f, BitConverter.ToSingle(file, 20));
            Assert.Equal(-2.0f, BitConverter.ToSingle(file, 24));
            Assert.Equal(20f, BitConverter.ToSingle(file, 28));
            Assert.Equal(0u, BitConverter.ToUInt32(file, 32));
            Assert.Equal(0u, BitConverter.ToUInt32(file, 36));
        }

        [Fact]
        public void ReaderRejectsBrokenFiles()
        {
            var pose = new IslandPose(0, 0, 10);
            byte[] good = IslandWriter.Write(5, 1, 1, pose, SampleRecords(), compress: false);
            IslandReader.Read(good, Repo.Types);
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(With(good, 3, (byte)'C')));          // magic
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(With(good, 4, 2)));                  // version
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(With(good, 6, 4)));                  // unknown flag
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(good, Repo.Types, 6));               // id mismatch
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(good.Take(good.Length - 1).ToArray())); // body size
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(good.Take(30).ToArray()));           // short header
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(IslandWriter.Write(0, 1, 1, pose, SampleRecords())));  // id 0
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(IslandWriter.Write(5, -1, 1, pose, SampleRecords()))); // owner
            // Yaw must be in (-45, 45].
            IslandReader.Read(IslandWriter.Write(5, 1, 1, new IslandPose(0, 0, 45), SampleRecords()));
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(IslandWriter.Write(5, 1, 1, new IslandPose(0, 0, -45), SampleRecords())));
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(IslandWriter.Write(5, 1, 1, new IslandPose(0, 0, 50), SampleRecords())));
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(IslandWriter.Write(5, 1, 1, new IslandPose(double.NaN, 0, 0), SampleRecords())));
            // A brick crossing the 256-stud island edge (brick_2x4 rot 0 at i = 254 is 2 wide: ok; at j = 253 it is 4 deep: not ok).
            IslandReader.Read(IslandWriter.Write(5, 1, 1, pose, new[] { new BrickRecord(254, 0, 0, Brick2x4, 4, 0) }), Repo.Types);
            Assert.Throws<ChunkFormatException>(() =>
                IslandReader.Read(IslandWriter.Write(5, 1, 1, pose, new[] { new BrickRecord(0, 253, 0, Brick2x4, 4, 0) }), Repo.Types));
            // Corrupt DEFLATE body.
            byte[] zipped = IslandWriter.Write(5, 1, 1, pose, SampleRecords());
            for (int n = IslandHeader.Size; n < zipped.Length; n++) zipped[n] = 0xFF;
            Assert.Throws<ChunkFormatException>(() => IslandReader.Read(zipped));
        }

        private static byte[] With(byte[] src, int at, byte value)
        {
            var copy = (byte[])src.Clone();
            copy[at] = value;
            return copy;
        }

        // ---- manifest -------------------------------------------------------------------------

        private const string ManifestHead = @"{
  ""contractVersion"": 3, ""crs"": ""EPSG:28992"", ""originRD"": [175700, 316500], ""baseNapM"": 30.0,
  ""studM"": 0.5, ""plateM"": 0.2, ""chunkStuds"": 64, ""chunksX"": 64, ""chunksY"": 64,
  ""chunks"": [{""cx"": 12, ""cy"": 40, ""file"": ""chunks/c_12_40.bxc"", ""bricks"": 18234, ""minK"": 60, ""maxK"": 410, ""sha1"": ""ab""}]";
        private const string ManifestIslands = @",
  ""islands"": [{""id"": 7, ""file"": ""islands/i_000007.bxi"", ""cx"": 12, ""cy"": 40, ""bricks"": 3120, ""sha1"": ""cd""}]";
        private const string ManifestV3 = ManifestHead + ManifestIslands + "}";

        [Fact]
        public void ManifestParsesIslands()
        {
            var m = Manifest.Parse(ManifestV3);
            Assert.Equal(3, m.ContractVersion);
            var isl = Assert.Single(m.Islands);
            Assert.Equal((7u, "islands/i_000007.bxi", 12, 40, 3120, "cd"), (isl.Id, isl.File, isl.Cx, isl.Cy, isl.Bricks, isl.Sha1));
            Assert.Equal(new ChunkCoord(12, 40), isl.Owner);
            // v1/v2 manifests have no islands key.
            var v2 = Manifest.Parse((ManifestHead + "}").Replace("\"contractVersion\": 3", "\"contractVersion\": 2"));
            Assert.Empty(v2.Islands);
            Assert.Throws<FormatException>(() => Manifest.Parse(ManifestV3.Replace("\"contractVersion\": 3", "\"contractVersion\": 5")));
            Assert.Throws<FormatException>(() => Manifest.Parse(ManifestV3.Replace("\"id\": 7", "\"id\": 0")));
        }

        // ---- occupancy --------------------------------------------------------------------------

        private static IslandData Island(uint id, IslandPose pose, params BrickRecord[] recs) =>
            IslandReader.Read(IslandWriter.Write(id, 3, 4, pose, recs), Repo.Types, id);

        [Fact]
        public void IslandIndexCoversLocalCellsUpTo255()
        {
            var data = Island(9, new IslandPose(100, 200, 20),
                new BrickRecord(250, 100, 50, Brick2x4, 4, 1, false, 5),   // rot 1: i 250..253, j 100..101
                new BrickRecord(255, 255, 40, Brick1x1, 4, 0));
            var idx = new IslandIndex(data, Repo.Types);
            Assert.True(idx.IsSolid(250, 100, 50));
            Assert.True(idx.IsSolid(253, 101, 52));
            Assert.False(idx.IsSolid(254, 100, 50));
            Assert.False(idx.IsSolid(250, 102, 50));
            Assert.True(idx.IsSolid(255, 255, 42));
            Assert.Equal(53, idx.ColumnTop(251, 100));
            Assert.Equal((256, 256, 40, 53), (idx.ExtentI, idx.ExtentJ, idx.MinK, idx.MaxK));
            Assert.True(idx.TryGetBrick(252, 101, 51, out var hit));
            Assert.Equal((9u, 250, 100, 50, 5u), (hit.IslandId, hit.I, hit.J, hit.K, hit.Record.featureId));
            Assert.True(hit.IsIsland);
            Assert.Equal(new ChunkCoord(3, 4), hit.Chunk);
            // World -> cell through the pose: the centre of local cell (251, 100).
            idx.Pose.CellToWorld(251.5, 100.5, out double x, out double z);
            idx.WorldToCell(x, z, out int ci, out int cj);
            Assert.Equal((251, 100), (ci, cj));
        }

        [Fact]
        public void ColumnOccupancyAcceptsUnsortedRecords()
        {
            var recs = new[]
            {
                new BrickRecord(1, 1, 10, Repo.TypeId("plate_1x1"), 3, 0),
                new BrickRecord(1, 1, 0, Repo.TypeId("plate_1x1"), 1, 0),
                new BrickRecord(1, 1, 1, Brick1x1, 2, 0),
            };
            var occ = new ColumnOccupancy(recs, Repo.Types, 256, "island");
            Assert.Equal(1, occ.BrickAt(1, 1, 0));
            Assert.Equal(2, occ.BrickAt(1, 1, 3));
            Assert.Equal(-1, occ.BrickAt(1, 1, 5));
            Assert.Equal(0, occ.BrickAt(1, 1, 10));
            Assert.Equal(11, occ.ColumnTop(1, 1));
        }

        // ---- meshing ----------------------------------------------------------------------------

        private static ListSink MeshIsland(params BrickRecord[] recs)
        {
            var sink = ListSink.Create();
            IslandMesherCore.BuildManaged(ref sink, recs, Repo.Types, Repo.Colors);
            return sink;
        }

        [Fact]
        public void IslandMeshIsInLocalSpaceAndEqualsTheChunkMesher()
        {
            var recs = new[]
            {
                new BrickRecord(10, 20, 100, Brick2x4, 4, 1),
                new BrickRecord(10, 20, 103, Brick2x4, 5, 0),
            };
            var island = MeshIsland(recs);
            MeshAssert.WindingMatchesNormals(island);
            foreach (var v in island.Vertices)
            {
                Assert.InRange(v.Position.X, 10 * 0.5f - 1e-4f, 14 * 0.5f + 1e-4f);
                Assert.InRange(v.Position.Z, 20 * 0.5f - 1e-4f, 24 * 0.5f + 1e-4f);
            }
            // The island grid is "a chunk at the origin": same triangles as chunk (0, 0).
            var chunk = MeshRunner.Run(0, 0, recs.Select(r => PlacedBrick.From(r, 0, 0)).ToArray());
            Assert.Equal(chunk.Vertices.Count, island.Vertices.Count);
            Assert.Equal(chunk.TriangleCount(0), island.TriangleCount(0));
            Assert.Equal(chunk.Studs.Count, island.Studs.Count);
        }

        [Fact]
        public void FaceCullingAndStudExposureWorkWithinTheIsland()
        {
            // Two 1x1 bricks stacked at local cells far beyond a chunk (i = 200): the shared face is
            // culled and the lower stud is covered.
            var lone = MeshIsland(new BrickRecord(200, 150, 10, Brick1x1, 4, 0));
            Assert.Equal(6, lone.TriangleCount(0) / 2);
            Assert.Single(lone.Studs);
            var stack = MeshIsland(new BrickRecord(200, 150, 10, Brick1x1, 4, 0), new BrickRecord(200, 150, 13, Brick1x1, 4, 0));
            Assert.Equal(10, stack.TriangleCount(0) / 2);   // 12 faces minus the 2 touching ones
            var stud = Assert.Single(stack.Studs);
            Assert.Equal(16 * 0.2f, stud.Y, 4);
            Assert.Equal(200.5f * 0.5f, stud.X, 4);
            Assert.Equal(150.5f * 0.5f, stud.Z, 4);
            // Side by side along local j: the touching side faces are culled too.
            var row = MeshIsland(new BrickRecord(200, 150, 10, Brick1x1, 4, 0), new BrickRecord(200, 151, 10, Brick1x1, 4, 0));
            Assert.Equal(10, row.TriangleCount(0) / 2);
            Assert.Equal(2, row.Studs.Count);
            MeshAssert.IsClosedManifold(row);
        }

        [Fact]
        public void IslandStudsGoToWorldThroughThePose()
        {
            var pose = new IslandPose(485, 1217, 20);
            var sink = MeshIsland(new BrickRecord(19, 7, 10, Brick1x1, 4, 0));
            var studs = sink.Studs.ToArray();
            float angle = studs[0].AngleDeg;
            IslandMesherCore.StudsToWorld(studs, pose);
            // Stud centre is local (u, v) = (9.75, 3.75) m.
            pose.LocalToWorld(9.75, 3.75, out double x, out double z);
            Assert.Equal(x, studs[0].X, 3);
            Assert.Equal(z, studs[0].Z, 3);
            Assert.Equal(13 * 0.2f, studs[0].Y, 4);
            Assert.Equal(angle + 20f, studs[0].AngleDeg, 4);
        }

        [Fact]
        public void IslandLodKeepsBricksBeyondOneChunk()
        {
            var bricks = IslandMesherCore.ToPlaced(new[] { new BrickRecord(0, 0, 10, Brick1x1, 4, 0), new BrickRecord(190, 120, 10, Brick1x1, 4, 0) });
            IslandMesherCore.Extent(bricks, Repo.Types, out int ei, out int ej);
            Assert.Equal((191, 121), (ei, ej));
            var dims = LodMesherCore.ComputeDims(bricks, Repo.Types, 0, 0, ei, ej, 4);
            Assert.Equal((48, 31), (dims.NI, dims.NJ));
            var color = new byte[dims.Length];
            var top = new int[dims.Length];
            LodMesherCore.Downsample(bricks, Repo.Types, dims, color, top);
            Assert.Equal(2, color.Count(c => c != 0));
            var sink = ListSink.Create();
            var mask = new byte[LodMesherCore.MaskSize(dims)];
            LodMesherCore.Build(ref sink, dims, color, Repo.Colors, mask, 0, 0);
            Assert.Equal(24, sink.TriangleCount(0)); // two separate boxes: 2 x 6 quads
            Assert.True(sink.Vertices.Max(v => v.Position.X) >= 190 * 0.5f);
        }

        // ---- picking ----------------------------------------------------------------------------

        private static WorldIndex EmptyWorld() =>
            new WorldIndex(WorldSpec.Contract, Repo.Palette, Repo.Catalogue, new FeatureSet(), Array.Empty<ManifestChunk>(), _ => null);

        [Fact]
        public void RaycastHitsRotatedIslandBricks()
        {
            var w = EmptyWorld();
            // Ground plate in chunk (0, 0) at k = 0 everywhere under the test point.
            var ground = new List<BrickRecord>();
            for (byte j = 0; j < 64; j += 2)
                for (byte i = 0; i < 64; i += 2) ground.Add(new BrickRecord(i, j, 0, Plate2x2, 1, 0));
            w.Add(ChunkReader.Read(ChunkWriter.Write(0, 0, ground.ToArray(), Repo.Types), Repo.Types));
            var pose = new IslandPose(5, 3, 30);
            var island = w.AddIsland(Island(11, pose, new BrickRecord(20, 10, 5, Brick1x1, 4, 0, false, 99)));

            // Straight down onto the centre of the island brick's local cell (20, 10).
            pose.CellToWorld(20.5, 10.5, out double x, out double z);
            Assert.True(WorldRaycast.Cast(w, x, 50, z, 0, -1, 0, 100, out var hit, out double dist, out int axis));
            Assert.Equal(11u, hit.IslandId);
            Assert.Equal((20, 10, 5, 99u), (hit.I, hit.J, hit.K, hit.Record.featureId));
            Assert.Equal(50 - 8 * 0.2, dist, 4);   // top of the brick at k = 8
            Assert.Equal(1, axis);

            // A world-grid cell (20, 10) is NOT where the island brick is: down there we hit the ground.
            Assert.True(WorldRaycast.Cast(w, 10.1, 50, 1.3, 0, -1, 0, 100, out hit, out dist, out _));
            Assert.False(hit.IsIsland);
            Assert.Equal(50 - 0.2, dist, 4);

            // Horizontal ray along the island's local +i at brick height, from outside the island box.
            pose.CellToWorld(-10, 10.5, out double sx, out double sz);
            pose.LocalDirToWorld(1, 0, out double dx, out double dz);
            Assert.True(WorldRaycast.Cast(w, sx, 6.5 * 0.2, sz, dx, 0, dz, 100, out hit, out dist, out axis));
            Assert.Equal(11u, hit.IslandId);
            Assert.Equal(30 * 0.5 / 1.0, dist, 3);  // from local i = -10 to i = 20
            Assert.Equal(0, axis);                  // entered through a local-i face
            Assert.Same(island, w.GetIsland(11));
        }

        // ---- world directory --------------------------------------------------------------------

        [Fact]
        public void WorldFilesOpensIslands()
        {
            string dir = Path.Combine(Path.GetTempPath(), "blox-island-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(dir, "chunks"));
            Directory.CreateDirectory(Path.Combine(dir, "islands"));
            try
            {
                File.Copy(Repo.PathOf("contract", "palette.json"), Path.Combine(dir, "palette.json"));
                File.Copy(Repo.PathOf("contract", "brick_catalogue.json"), Path.Combine(dir, "brick_catalogue.json"));
                byte[] chunk = ChunkWriter.Write(12, 40, new[] { new BrickRecord(0, 0, 60, Plate2x2, 1, 0) }, Repo.Types);
                File.WriteAllBytes(Path.Combine(dir, "chunks", "c_12_40.bxc"), chunk);
                byte[] isl = IslandWriter.Write(7, 12, 40, new IslandPose(390, 1290, 20), SampleRecords());
                File.WriteAllBytes(Path.Combine(dir, "islands", "i_000007.bxi"), isl);
                string manifest = ManifestV3
                    .Replace("\"bricks\": 18234", "\"bricks\": 1").Replace("\"minK\": 60, \"maxK\": 410", "\"minK\": 60, \"maxK\": 61")
                    .Replace("\"sha1\": \"ab\"", $"\"sha1\": \"{WorldFiles.Sha1Hex(chunk)}\"")
                    .Replace("\"bricks\": 3120", "\"bricks\": 3").Replace("\"sha1\": \"cd\"", $"\"sha1\": \"{WorldFiles.Sha1Hex(isl)}\"");
                File.WriteAllText(Path.Combine(dir, "manifest.json"), manifest);

                var w = WorldFiles.Open(dir, verifySha1: true);
                Assert.Equal(1, w.IslandCount);
                Assert.Equal(new uint[] { 7 }, w.IslandsOwnedBy(new ChunkCoord(12, 40)));
                Assert.Empty(w.IslandsOwnedBy(new ChunkCoord(0, 0)));
                Assert.False(w.IsIslandLoaded(7));
                var idx = w.LoadIsland(7);
                Assert.NotNull(idx);
                Assert.Equal(3, idx!.Data.Count);
                Assert.Equal(20.0, idx.Pose.YawDeg, 5);
                Assert.True(w.IsIslandLoaded(7));
                Assert.True(w.UnloadIsland(7));
                Assert.Null(w.LoadIsland(8));

                // A brick count that disagrees with the manifest is an error.
                File.WriteAllText(Path.Combine(dir, "manifest.json"), manifest.Replace("\"bricks\": 3", "\"bricks\": 4"));
                Assert.Throws<ChunkFormatException>(() => WorldFiles.Open(dir).LoadIsland(7));
            }
            finally
            {
                Directory.Delete(dir, recursive: true);
            }
        }

        /// <summary>The real Markt sample (pre-islands, contract v2) still opens and meshes, with no islands.</summary>
        [SkippableFact]
        public void RealMarktSampleOpensWithoutIslands()
        {
            string dir = Repo.PathOf("samples", "markt");
            Skip.IfNot(File.Exists(Path.Combine(dir, "manifest.json")), "samples/markt absent");
            var w = WorldFiles.Open(dir);
            Assert.Equal(0, w.IslandCount);
            var first = w.AvailableChunks.First();
            var data = w.Load(first.Coord);
            Assert.NotNull(data);
            Assert.Equal(first.Bricks, data!.Count);
        }

        /// <summary>
        /// A pipeline-built world with islands: the synthetic town (pipeline/tests/town_fixture.py)
        /// built with `blox build`, committed as pipeline/tests/fixtures/town_world (the pipeline test
        /// test_committed_town_world_is_current keeps it current). BLOX_ISLAND_WORLD_DIR points
        /// these checks at any other pipeline output (e.g. build/world).
        /// </summary>
        private static string IslandWorldDir() =>
            Environment.GetEnvironmentVariable("BLOX_ISLAND_WORLD_DIR") is { Length: > 0 } env
                ? env
                : Repo.PathOf("pipeline", "tests", "fixtures", "town_world");

        /// <summary>
        /// Every island of the pipeline-built world loads (sha1 + brick count), meshes on its own
        /// grid, and its centre lies in (or next to) its owning chunk, which exists (CONTRACT 5.1).
        /// </summary>
        [Fact]
        public void PipelineBuiltIslandsLoadAndMesh()
        {
            string dir = IslandWorldDir();
            Assert.True(File.Exists(Path.Combine(dir, "manifest.json")), $"no world at {dir}");
            var w = WorldFiles.Open(dir, verifySha1: true);
            Assert.True(w.IslandCount > 0, "the pipeline-built world has no islands");
            foreach (var entry in w.AvailableIslands.ToList())
            {
                var island = w.LoadIsland(entry.Id)!;
                Assert.InRange(Math.Abs(island.Pose.YawDeg), 0, 45);
                Assert.True(w.Exists(island.Owner), $"island {island.Id}: owning chunk {island.Owner} not in the manifest");
                var sink = ListSink.Create();
                IslandMesherCore.BuildManaged(ref sink, island.Data.Records, Repo.Types, Repo.Colors);
                Assert.NotEmpty(sink.Vertices);
                MeshAssert.WindingMatchesNormals(sink);
                foreach (var v in sink.Vertices)
                {
                    Assert.InRange(v.Position.X, -1e-3f, island.ExtentI * 0.5f + 1e-3f);
                    Assert.InRange(v.Position.Z, -1e-3f, island.ExtentJ * 0.5f + 1e-3f);
                }
                island.Pose.LocalToWorld(island.ExtentI * 0.25, island.ExtentJ * 0.25, out double cx, out double cz);
                var owner = w.Spec.ChunkOf(w.Spec.UnityXToI(cx), w.Spec.UnityZToJ(cz));
                // "the chunk holding the island's centre": the pipeline uses the brick-extent centre.
                Assert.InRange(Math.Abs(owner.X - island.Owner.X), 0, 1);
                Assert.InRange(Math.Abs(owner.Y - island.Owner.Y), 0, 1);
                _out?.WriteLine($"island {island.Id}: yaw {island.Pose.YawDeg:0.##}, owner {island.Owner}, {island.Data.Count} bricks, " +
                                $"extent {island.ExtentI}x{island.ExtentJ}, {sink.TriangleCount(0) + sink.TriangleCount(1)} tris, {sink.Studs.Count} studs");
            }
        }

        /// <summary>
        /// End-to-end sign and origin check across languages: placed by C#'s <see cref="IslandPose"/>,
        /// an island's columns must land on the paving the pipeline left under its footprint in the
        /// chunks (CONTRACT 5.1), with the chunk ground just below the island's lowest bricks. The same
        /// island with the yaw sign flipped (or the origin read as a centre) lands mostly on grass,
        /// streets and neighbours, so this fails for any sign or origin mix-up between the two sides.
        /// </summary>
        [Fact]
        public void PipelineBuiltIslandsSitOnTheirPavedHole()
        {
            var w = WorldFiles.Open(IslandWorldDir());
            foreach (var c in w.AvailableChunks.ToList()) w.Load(c.Coord);
            int pave = w.Palette.Entries.Single(e => e.Name == "pavement").Index;
            foreach (var entry in w.AvailableIslands.ToList())
            {
                var island = w.LoadIsland(entry.Id)!;
                var right = PavedShare(w, island, island.Pose, pave, out int cols, out int seamOk);
                var flipped = PavedShare(w, island, new IslandPose(island.Pose.OriginX, island.Pose.OriginZ, -island.Pose.YawDeg), pave, out _, out _);
                _out?.WriteLine($"island {island.Id}: {cols} columns, {right:P0} over paving ({flipped:P0} with the yaw flipped), seam ok {seamOk}");
                Assert.True(right > 0.6, $"island {island.Id}: only {right:P0} of its columns are over the paved hole");
                Assert.True(right > 3 * flipped, $"island {island.Id}: flipped yaw fits as well ({flipped:P0} vs {right:P0})");
                // the plinth reaches down to (or below) the chunk ground: no gap under the walls
                Assert.True(seamOk > 0.9 * cols, $"island {island.Id}: plinth above the chunk ground in {cols - seamOk}/{cols} columns");
            }
        }

        /// <summary>Share of the island's interior columns (all four neighbours solid too) whose
        /// world column, under the given pose, is topped by a pavement brick.</summary>
        private static double PavedShare(WorldIndex w, IslandIndex island, IslandPose pose, int pave, out int cols, out int seamOk)
        {
            int paved = 0;
            cols = 0; seamOk = 0;
            for (int i = 1; i < island.ExtentI - 1; i++)
            for (int j = 1; j < island.ExtentJ - 1; j++)
            {
                if (island.ColumnTop(i, j) < 0 || island.ColumnTop(i - 1, j) < 0 || island.ColumnTop(i + 1, j) < 0 ||
                    island.ColumnTop(i, j - 1) < 0 || island.ColumnTop(i, j + 1) < 0) continue;
                pose.LocalToWorld((i + 0.5) * 0.5, (j + 0.5) * 0.5, out double x, out double z);
                int I = w.Spec.UnityXToI(x), J = w.Spec.UnityZToJ(z);
                int top = w.ColumnTop(I, J);
                cols++;
                if (top < 0 || !w.TryGetBrick(I, J, top - 1, out var hit)) continue;
                if (hit.Record.color == pave) paved++;
                int low = int.MaxValue;
                for (int k = island.MinK; k < island.MaxK && low == int.MaxValue; k++)
                    if (island.IsSolid(i, j, k)) low = k;
                if (low <= top) seamOk++;
            }
            return cols == 0 ? 0 : (double)paved / cols;
        }

        private readonly Xunit.Abstractions.ITestOutputHelper? _out;
        public IslandTests(Xunit.Abstractions.ITestOutputHelper output) { _out = output; }

        // ---- pipeline golden island ------------------------------------------------------------

        /// <summary>
        /// Reads the pipeline's golden island (pipeline/tests/fixtures/golden/i_000001.bxi +
        /// golden_island.json) and compares header and records. Skipped until the pipeline writes it.
        /// </summary>
        [SkippableFact]
        public void ReadsPipelineGoldenIsland()
        {
            string dir = Repo.PathOf("pipeline", "tests", "fixtures", "golden");
            string jsonPath = Path.Combine(dir, "golden_island.json");
            string bxi = Path.Combine(dir, "i_000001.bxi");
            Skip.IfNot(File.Exists(jsonPath) && File.Exists(bxi), "golden island fixture absent (pipeline writes it)");
            var golden = JsonParser.Parse(File.ReadAllText(jsonPath));
            GoldenIslandCheck.Verify(dir, golden);
        }
    }
}

namespace Blox.Tests
{
    /// <summary>
    /// Compares a .bxi file with the pipeline's golden JSON. Mirrors golden.json for chunks:
    /// { "files": { name: { size, sha1, headerHex?, header: {...} } }, "records": [...] }.
    /// Optional keys are checked only when present, so small layout differences in the JSON don't
    /// hide real format disagreements (the binary checks are what matter).
    /// </summary>
    internal static class GoldenIslandCheck
    {
        public static void Verify(string dir, JsonNode golden)
        {
            var files = golden.Get("files");
            var names = files.IsNull ? new List<string> { "i_000001.bxi" } : files.Keys.ToList();
            Assert.NotEmpty(names);
            foreach (var name in names)
            {
                byte[] bytes = File.ReadAllBytes(Path.Combine(dir, name));
                var expect = files.IsNull ? golden : files[name];
                var size = expect.OptInt("size");
                if (size.HasValue) Assert.Equal(size.Value, bytes.Length);
                var sha1 = expect.OptString("sha1");
                if (sha1 != null) Assert.Equal(sha1, WorldFiles.Sha1Hex(bytes));
                var hex = expect.OptString("headerHex");
                if (hex != null) Assert.Equal(hex, Convert.ToHexString(bytes, 0, IslandHeader.Size).ToLowerInvariant());
                var d = IslandReader.Read(bytes, Repo.Types);
                var h = expect.Get("header");
                if (h.IsNull) h = golden.Get("header");
                if (!h.IsNull)
                {
                    CheckInt(h, "version", d.Header.Version);
                    CheckInt(h, "flags", d.Header.Flags);
                    CheckLong(h, "islandId", d.Header.IslandId);
                    CheckInt(h, "cx", d.Header.Cx);
                    CheckInt(h, "cy", d.Header.Cy);
                    CheckLong(h, "brickCount", d.Header.BrickCount);
                    CheckLong(h, "bodyBytes", d.Header.BodyBytes);
                    CheckFloat(h, "originX", d.Header.OriginX);
                    CheckFloat(h, "originZ", d.Header.OriginZ);
                    CheckFloat(h, "yawDeg", d.Header.YawDeg);
                }
                var recsNode = golden.Get("records");
                if (recsNode.IsNull) continue;
                var recs = recsNode.Items;
                Assert.Equal(recs.Count, d.Count);
                for (int n = 0; n < recs.Count; n++)
                {
                    var e = recs[n];
                    var r = d.Records[n];
                    CheckInt(e, "i", r.i);
                    CheckInt(e, "j", r.j);
                    CheckInt(e, "k", r.k);
                    CheckInt(e, "typeId", r.type);
                    CheckInt(e, "colorIdx", r.color);
                    CheckInt(e, "rot", r.Rot);
                    CheckInt(e, "rotFlags", r.rotFlags);
                    CheckLong(e, "featureId", r.featureId);
                    var tn = e.OptString("typeName");
                    if (tn != null) Assert.Equal(tn, Repo.Catalogue[r.type]!.Name);
                    var nv = e.OptBool("noVariation");
                    if (nv.HasValue) Assert.Equal(nv.Value, r.NoVariation);
                    var hs = e.OptBool("hideStuds");
                    if (hs.HasValue) Assert.Equal(hs.Value, r.HideStuds);
                    // "world": the record's local min corner through the island pose (Unity metres).
                    var world = e.Get("world");
                    if (!world.IsNull)
                    {
                        d.Pose.CellToWorld(r.i, r.j, out double x, out double z);
                        Assert.True(Math.Abs(world[0].AsDouble - x) < 1e-4, $"record {n} world x {world[0].AsDouble} != {x}");
                        Assert.True(Math.Abs(world[1].AsDouble - r.k * 0.2) < 1e-6, $"record {n} world y");
                        Assert.True(Math.Abs(world[2].AsDouble - z) < 1e-4, $"record {n} world z {world[2].AsDouble} != {z}");
                    }
                }
                // Our writer reproduces an uncompressed golden file byte for byte.
                if (!d.Header.Compressed)
                    Assert.Equal(bytes, IslandWriter.Write(d.Id, d.Header.Cx, d.Header.Cy, d.Pose, d.Records, compress: false));
                var bodyHex = golden.OptString("bodyHex");
                if (bodyHex != null) Assert.Equal(bodyHex, Convert.ToHexString(ChunkWriter.EncodeRecords(d.Records)).ToLowerInvariant());
                // The island meshes on its own grid without errors.
                var sink = ListSink.Create();
                IslandMesherCore.BuildManaged(ref sink, d.Records, Repo.Types, Repo.Colors);
                if (d.Count > 0) Assert.True(sink.Vertices.Count > 0);
            }
        }

        private static void CheckInt(JsonNode n, string key, int actual)
        {
            var v = n.OptLong(key);
            if (v.HasValue) Assert.True(v.Value == actual, $"{key}: expected {v.Value}, got {actual}");
        }

        private static void CheckLong(JsonNode n, string key, long actual)
        {
            var v = n.OptLong(key);
            if (v.HasValue) Assert.True(v.Value == actual, $"{key}: expected {v.Value}, got {actual}");
        }

        private static void CheckFloat(JsonNode n, string key, float actual)
        {
            var v = n.OptDouble(key);
            if (v.HasValue) Assert.True(Math.Abs(v.Value - actual) < 1e-4, $"{key}: expected {v.Value}, got {actual}");
        }
    }
}
