using System;
using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;

namespace Blox.Tests
{
    /// <summary>Brick models (CONTRACT 7.1): parsing, validation and per-part meshing.</summary>
    public class BrickModelTests
    {
        // A tiny walker: two 1x1 legs (parts), a 1x2 body plate across them, hip pivot at k = 3.
        private const string Walker = @"{
  ""name"": ""walker"", ""version"": 1, ""size"": [2, 1, 4], ""pivot"": [1.0, 0.5, 0.0], ""forward"": ""+j"",
  ""parts"": { ""leg_l"": {""pivot"": [0.5, 0.5, 3.0]}, ""leg_r"": {""pivot"": [1.5, 0.5, 3.0]} },
  ""bricks"": [
    {""i"": 0, ""j"": 0, ""k"": 0, ""type"": 1, ""color"": 21, ""rot"": 0, ""part"": ""leg_l""},
    {""i"": 1, ""j"": 0, ""k"": 0, ""type"": 1, ""color"": 21, ""rot"": 0, ""part"": ""leg_r""},
    {""i"": 0, ""j"": 0, ""k"": 3, ""type"": 13, ""color"": 4, ""rot"": 1}
  ] }";

        [Fact]
        public void ParsesSizePivotPartsAndBricks()
        {
            var m = BrickModel.Parse(Walker, Repo.Catalogue);
            Assert.Equal("walker", m.Name);
            Assert.Equal((2, 1, 4), (m.SizeI, m.SizeJ, m.SizeK));
            Assert.Equal((1.0f, 0.5f, 0.0f), (m.PivotI, m.PivotJ, m.PivotK));
            Assert.Equal(new[] { "leg_l", "leg_r" }, m.Parts.Select(p => p.Name));
            Assert.Equal(3, m.Bricks.Count);
            Assert.Equal(0, m.Bricks[0].Part);
            Assert.Equal(-1, m.Bricks[2].Part);
            Assert.Equal(Facing.E, m.Bricks[2].Facing);
        }

        [Fact]
        public void RejectsBadModels()
        {
            Assert.Throws<FormatException>(() => BrickModel.Parse(Walker.Replace("\"+j\"", "\"+i\"")));
            Assert.Throws<FormatException>(() => BrickModel.Parse(Walker.Replace("\"part\": \"leg_r\"", "\"part\": \"tail\"")));
            Assert.Throws<FormatException>(() => BrickModel.Parse(Walker.Replace("\"size\": [2, 1, 4]", "\"size\": [1, 1, 4]"), Repo.Catalogue));
            Assert.Throws<FormatException>(() => BrickModel.Parse(Walker.Replace("\"type\": 13", "\"type\": 200"), Repo.Catalogue));
        }

        [Fact]
        public void PartMeshesAreRelativeToTheirPivots()
        {
            var m = BrickModel.Parse(Walker, Repo.Catalogue);
            var leg = Mesh(m, m.PartIndex("leg_l"));
            // Leg brick spans i 0..1, k 0..3 -> x 0..0.5, y 0..0.6; pivot (0.25, 0.6, 0.25) m.
            Assert.Equal(-0.25f, leg.Vertices.Min(v => v.Position.X), 5);
            Assert.Equal(0.25f, leg.Vertices.Max(v => v.Position.X), 5);
            Assert.Equal(-0.6f, leg.Vertices.Min(v => v.Position.Y), 5);
            Assert.Equal(0f, leg.Vertices.Max(v => v.Position.Y), 5);
            ModelMesherCore.PartOffset(m, m.PartIndex("leg_l"), out float ox, out float oy, out float oz);
            Assert.Equal((-0.25f, 0.6f, 0f), (ox, oy, oz));

            var body = Mesh(m, -1);
            Assert.Equal(-0.5f, body.Vertices.Min(v => v.Position.X), 5);
            Assert.Equal(0.6f, body.Vertices.Min(v => v.Position.Y), 5);
            MeshAssert.WindingMatchesNormals(leg);
            MeshAssert.WindingMatchesNormals(body);
        }

        [Fact]
        public void FacesAreCulledOnlyWithinAPartAndStudsBecomeGeometry()
        {
            var m = BrickModel.Parse(Walker, Repo.Catalogue);
            // The leg keeps its top face (the body plate is another part and may swing away)...
            var leg = Mesh(m, m.PartIndex("leg_l"));
            Assert.Equal(12, leg.TriangleCount(0));
            // ...but its stud is covered by the body, so no stud geometry.
            Assert.Equal(24, leg.Vertices.Count);
            // The body plate is free on top: 2 studs as geometry (10 sides + 10-triangle cap each).
            var body = Mesh(m, -1);
            Assert.Empty(body.Studs);
            Assert.Equal(12 + 2 * (StudMesher.Segments * 2 + StudMesher.Segments), body.TriangleCount(0));
            Assert.Equal(0.6f + 0.2f + StudMesher.Height, body.Vertices.Max(v => v.Position.Y), 5);
        }

        [Fact]
        public void ContractModelsLoadAndMeshIfPresent()
        {
            string dir = Repo.PathOf("contract", "models");
            var files = Directory.Exists(dir) ? Directory.GetFiles(dir, "*.json") : Array.Empty<string>();
            foreach (var f in files)
            {
                var m = BrickModel.Parse(File.ReadAllText(f), Repo.Catalogue);
                for (int part = -1; part < m.Parts.Count; part++)
                {
                    var s = Mesh(m, part);
                    if (s.Vertices.Count > 0) MeshAssert.WindingMatchesNormals(s);
                }
            }
        }

        private static ListSink Mesh(BrickModel m, int part)
        {
            var sink = ListSink.Create();
            ModelMesherCore.BuildPart(ref sink, m, part, Repo.Types, Repo.Colors);
            return sink;
        }
    }
}
