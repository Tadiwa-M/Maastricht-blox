using System;
using System.IO;
using Blox.Data;
using Xunit;

namespace Blox.Tests
{
    public class ContractModelTests
    {
        [Fact]
        public void PaletteLoadsFromContract()
        {
            var p = Repo.Palette;
            Assert.Equal("air", p[0]!.Name);
            Assert.Equal(MaterialClass.None, p[0]!.Material);
            var mergel = p[1]!;
            Assert.Equal("mergel", mergel.Name);
            Assert.Equal(0xD9, mergel.SrgbR);
            Assert.Equal(MaterialClass.Trans, p[32]!.Material);   // water
            Assert.Equal(MaterialClass.Glass, p[34]!.Material);   // glass
            var table = p.ToTable();
            Assert.Equal(0, table[0].Defined);
            Assert.Equal(1, table[1].Defined);
            Assert.Equal(ColorSpace.SrgbToLinear((byte)0xD9), table[1].R, 6);
        }

        [Fact]
        public void SrgbToLinearMatchesKnownValues()
        {
            Assert.Equal(0f, ColorSpace.SrgbToLinear((byte)0), 6);
            Assert.Equal(1f, ColorSpace.SrgbToLinear((byte)255), 5);
            Assert.Equal(0.21586f, ColorSpace.SrgbToLinear((byte)128), 4); // standard reference value
            Assert.Equal(10 / 255f / 12.92f, ColorSpace.SrgbToLinear((byte)10), 6); // linear toe
            Assert.Equal(0.5f, ColorSpace.LinearToSrgb(ColorSpace.SrgbToLinear(0.5f)), 5);
        }

        [Fact]
        public void PaletteRejectsBadEntries()
        {
            Assert.Throws<FormatException>(() => Palette.Parse("{\"entries\":[{\"idx\":64,\"name\":\"x\",\"srgb\":\"#000000\",\"material\":\"solid\"}]}"));
            Assert.Throws<FormatException>(() => Palette.Parse("{\"entries\":[{\"idx\":1,\"name\":\"x\",\"srgb\":\"#00000\",\"material\":\"solid\"}]}"));
            Assert.Throws<FormatException>(() => Palette.Parse("{\"entries\":[{\"idx\":1,\"name\":\"x\",\"srgb\":\"#000000\",\"material\":\"plastic\"}]}"));
            Assert.Throws<FormatException>(() => Palette.Parse("{\"entries\":[{\"idx\":1,\"name\":\"x\",\"srgb\":null,\"material\":\"solid\"}]}"));
        }

        [Fact]
        public void CatalogueLoadsFromContract()
        {
            var c = Repo.Catalogue;
            Assert.Equal(47, c.Types.Count);
            var s = c.ByName("slope33_2x3");
            Assert.Equal(BrickKind.Slope, s.Kind);
            Assert.Equal((2, 3, 3), (s.W, s.D, s.H));
            Assert.Equal(StudPattern.BackRows, s.Studs);
            Assert.Equal(1, s.StudRows);
            Assert.Equal(BrickKind.SlopeDouble, c.ByName("slope_double45_2x2").Kind);
            Assert.Equal(StudPattern.None, c.ByName("tile_2x4").Studs);
            Assert.Null(c[0]);
            Assert.Equal(0, Repo.Types[0].Defined);
            Assert.Equal(1, Repo.Types[37].Defined);
        }

        [Fact]
        public void CatalogueV2DetailPiecesLoad()
        {
            var c = Repo.Catalogue;
            Assert.Equal(BrickKind.Arch, c.ByName("arch_1x6").Kind);
            Assert.Equal(BrickKind.Window, c.ByName("window_1x2x3").Kind);
            Assert.Equal(BrickKind.Door, c.ByName("door_1x2x4").Kind);
            Assert.Equal(BrickKind.Fence, c.ByName("fence_1x4").Kind);
            Assert.Equal(BrickKind.RoundTile, c.ByName("round_tile_1x1").Kind);
            Assert.Equal(StudPattern.Center, c.ByName("jumper_1x2").Studs);
            Assert.Equal(BrickKind.TileGrille, c.ByName("grille_1x2").Kind);
            var s30 = c.ByName("slope30_1x2");
            Assert.Equal((StudPattern.BackRows, 0, 2), (s30.Studs, s30.StudRows, s30.H));
            Assert.True(Repo.Types[c.ByName("window_1x2x2").Id].IsDetail);
            Assert.True(Repo.Types[c.ByName("round_tile_1x1").Id].IsRound);
            Assert.False(Repo.Types[c.ByName("jumper_1x2").Id].IsDetail);
        }

        [Fact]
        public void CatalogueRejectsReservedAndDuplicateIds()
        {
            const string t = "{{\"id\":{0},\"name\":\"{1}\",\"kind\":\"brick\",\"w\":1,\"d\":1,\"h\":3,\"studs\":\"all\"}}";
            Assert.Throws<FormatException>(() => Catalogue.Parse("{\"types\":[" + string.Format(t, 0, "a") + "]}"));
            Assert.Throws<FormatException>(() => Catalogue.Parse("{\"types\":[" + string.Format(t, 1, "a") + "," + string.Format(t, 1, "b") + "]}"));
            Assert.Throws<FormatException>(() => Catalogue.Parse("{\"types\":[" + string.Format(t, 1, "a") + "," + string.Format(t, 2, "a") + "]}"));
        }

        private const string ManifestJson = @"{
  ""contractVersion"": 1, ""crs"": ""EPSG:28992"", ""originRD"": [175700, 316500], ""baseNapM"": 30.0,
  ""studM"": 0.5, ""plateM"": 0.2, ""chunkStuds"": 64, ""chunksX"": 64, ""chunksY"": 64,
  ""palette"": ""palette.json"", ""catalogue"": ""brick_catalogue.json"", ""features"": ""features.json"",
  ""generated"": ""2026-10-17T12:00:00Z"",
  ""sources"": [{""name"": ""3D BAG"", ""version"": ""v2024"", ""licence"": ""CC BY 4.0""}],
  ""chunks"": [{""cx"": 12, ""cy"": 40, ""file"": ""chunks/c_12_40.bxc"", ""bricks"": 18234, ""minK"": 60, ""maxK"": 410, ""sha1"": ""ab""}]
}";

        [Fact]
        public void ManifestParsesContractExample()
        {
            var m = Manifest.Parse(ManifestJson);
            Assert.Equal(175700, m.OriginRdX);
            Assert.Equal(0.2, m.PlateM);
            Assert.Single(m.Chunks);
            Assert.Equal(new ChunkCoord(12, 40), m.Chunks[0].Coord);
            Assert.Equal("chunks/c_12_40.bxc", m.Chunks[0].File);
            Assert.Equal(m.Chunks[0].File, m.Chunks[0].Coord.FileName);
            Assert.Equal("CC BY 4.0", m.Sources[0].Licence);
            var spec = WorldSpec.FromManifest(m);
            Assert.Equal(4096, spec.StudsX);
        }

        [Fact]
        public void ManifestAcceptsV1AndV2AndRejectsOthers()
        {
            Assert.Equal(2, WorldSpec.ContractVersion);
            Assert.Equal(1, Manifest.Parse(ManifestJson).ContractVersion);
            Assert.Equal(2, Manifest.Parse(ManifestJson.Replace("\"contractVersion\": 1", "\"contractVersion\": 2")).ContractVersion);
            Assert.Throws<FormatException>(() => Manifest.Parse(ManifestJson.Replace("\"contractVersion\": 1", "\"contractVersion\": 3")));
            Assert.Throws<FormatException>(() => Manifest.Parse(ManifestJson.Replace("\"contractVersion\": 1", "\"contractVersion\": 0")));
        }

        [Fact]
        public void WorldSpecConvertsReferencePoints()
        {
            var s = WorldSpec.Contract;
            // Vrijthof (176185, 317717): (485 m, 1217 m) from the origin.
            var c = s.RdToCell(176185, 317717, 50.0);
            Assert.Equal(new GridCell(970, 2434, 100), c);
            Assert.Equal(new ChunkCoord(15, 38), s.ChunkOf(c.I, c.J));
            Assert.Equal(485.0, s.CellToUnityX(c.I), 9);
            Assert.Equal(20.0, s.CellToUnityY(c.K), 9);
            Assert.Equal(1217.0, s.CellToUnityZ(c.J), 9);
            Assert.Equal(-1, s.RdToI(175699.9));
            Assert.Equal(new ChunkCoord(-1, -1), s.ChunkOf(-1, -1));
            Assert.Equal(-1, s.NapToK(29.99));
            s.RdToUnity(176430, 318007, 45.0, out double ux, out double uy, out double uz);
            Assert.Equal((730.0, 15.0, 1507.0), (ux, uy, uz));
        }

        [Fact]
        public void FeaturesParseAndSearch()
        {
            const string json = @"{ ""features"": [
  { ""id"": 17, ""kind"": ""building"", ""name"": ""Sint-Servaasbasiliek"", ""bagId"": ""NL.IMBAG.Pand.0935100000000001"",
    ""osmId"": ""way/12345"", ""address"": ""Keizer Karelplein 3"", ""year"": 1000, ""heightM"": 63.2,
    ""centroid"": [970, 2434], ""bboxIJ"": [960, 2420, 990, 2450], ""tags"": {""wikidata"": ""Q1"", ""levels"": 3} },
  { ""id"": 18, ""kind"": ""stop"", ""name"": ""Maastricht, Vrijthof"", ""centroid"": [1, 2], ""tags"": {""stop_id"": ""123""} },
  { ""id"": 19, ""kind"": ""future_kind"", ""name"": ""Servaas fountain"" }
]}";
            var f = FeatureSet.Parse(json);
            var b = f.Get(17)!;
            Assert.Equal(FeatureKind.Building, b.Kind);
            Assert.Equal(1000, b.Year);
            Assert.Equal(new[] { 960, 2420, 990, 2450 }, b.BboxIJ);
            Assert.Equal("Q1", b.Tags["wikidata"]);
            Assert.Equal("3", b.Tags["levels"]);
            Assert.Equal(FeatureKind.Unknown, f.Get(19)!.Kind);
            var hits = f.Search("servaas");
            Assert.Equal(new uint[] { 19, 17 }, new[] { hits[0].Id, hits[1].Id }); // name-prefix match ranks first
            Assert.Equal(17u, f.Search("Keizer")[0].Id);
            Assert.Throws<FormatException>(() => FeatureSet.Parse("{\"features\":[{\"id\":0,\"kind\":\"poi\"}]}"));
        }

        [SkippableFact]
        public void TestsceneWorldMetadataLoadsIfPresent()
        {
            string dir = Repo.PathOf("build", "testscene");
            Skip.IfNot(File.Exists(Path.Combine(dir, "manifest.json")), "build/testscene not generated (pipeline testscene)");
            var world = WorldFiles.Open(dir, verifySha1: true);
            Assert.NotEmpty(world.AvailableChunks);
            Assert.NotEmpty(world.Features.All);
        }
    }
}
