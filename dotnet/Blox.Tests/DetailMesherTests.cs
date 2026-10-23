using System;
using System.Linq;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;
using static Blox.Tests.MeshRunner;

namespace Blox.Tests
{
    /// <summary>v2 detail pieces (CONTRACT 2.1), slope lip, jumper stud and hide_studs.</summary>
    public class DetailMesherTests
    {
        private const byte Red = 4, Glass = 34;
        private const int I0 = 10, J0 = 10, K0 = 100;   // chunk (0, 0)

        public static TheoryData<string, int> DetailTypesAllRotations()
        {
            var d = new TheoryData<string, int>();
            foreach (var t in Repo.Catalogue.Types)
                if (t.Info.IsDetail)
                    for (int rot = 0; rot < 4; rot++) d.Add(t.Name, rot);
            return d;
        }

        [Theory]
        [MemberData(nameof(DetailTypesAllRotations))]
        public void DetailPieceIsWellFormedInsideItsBox(string type, int rot)
        {
            var t = Repo.Catalogue.ByName(type).Info;
            var s = Run(0, 0, new[] { Brick(type, I0, J0, K0, rot, Red) });
            MeshAssert.WindingMatchesNormals(s);
            Rotation.RotatedExtent(t, rot, out int ei, out int ej);
            foreach (var v in s.Vertices)
            {
                Assert.InRange(v.Position.X, I0 * 0.5f - 1e-4f, (I0 + ei) * 0.5f + 1e-4f);
                Assert.InRange(v.Position.Z, J0 * 0.5f - 1e-4f, (J0 + ej) * 0.5f + 1e-4f);
                Assert.InRange(v.Position.Y, K0 * 0.2f - 1e-4f, (K0 + t.H) * 0.2f + 1e-4f);
            }
            double box = t.W * t.D * t.H * 0.5 * 0.5 * 0.2;
            if (t.Kind != BrickKind.Fence) // spindles are open (their ends are buried in the rails)
                Assert.InRange(MeshAssert.Volume(s), 0.05 * box, box + 1e-6);
            // Studs: every top cell of these pieces is studded except the grille (a tile).
            Assert.Equal(t.Studs == StudPattern.All ? t.W * t.D : 0, s.Studs.Count);
        }

        [Theory]
        [InlineData(Facing.N)]
        [InlineData(Facing.E)]
        [InlineData(Facing.S)]
        [InlineData(Facing.W)]
        public void WindowPaneIsGlassSeamlessAndSetBackFromTheFront(Facing facing)
        {
            var br = Placed("window_1x2x2", I0, J0, K0, facing, Red);
            var s = Run(0, 0, new[] { br });
            var glass = s.Indices[1].Select(i => s.Vertices[i]).ToList();
            Assert.NotEmpty(glass);
            // Panes are glass (class 2) even though the record colour is red, and have no bevel/seam edges.
            Assert.All(glass, v => Assert.Equal((float)MaterialClass.Glass, v.U2));
            Assert.All(glass, v => Assert.Equal((0f, 0f), (v.U1, v.V1)));
            // They carry the window's seed so the night shader can light windows individually.
            Assert.All(glass, v => Assert.Equal(BrickVariation.Seed01(BrickVariation.Seed(I0, J0, K0)), v.V2, 6));
            Assert.All(s.Indices[0], i => Assert.Equal((float)MaterialClass.Solid, s.Vertices[i].U2));
            // Pane depth: 0.1 m behind the front face, measured along the facing direction.
            Rotation.FrontDir(facing, out int fi, out int fj);
            Rotation.RotatedExtent(2, 1, Rotation.FacingToRot(facing), out int ei, out int ej);
            float front = fi > 0 ? (I0 + ei) * 0.5f : fi < 0 ? I0 * 0.5f : fj > 0 ? (J0 + ej) * 0.5f : J0 * 0.5f;
            float along(BrickVertex v) => fi != 0 ? v.Position.X : v.Position.Z;
            float sign = fi + fj;
            float depth = glass.Select(v => (front - along(v)) * sign).Average();
            Assert.Equal(DetailShapes.PaneBackM, depth, 3);
        }

        [Fact]
        public void DoorHasGlassOnlyInTheFanlight()
        {
            var s = Run(0, 0, new[] { Brick("door_1x2x4", I0, J0, K0, 0, Red) });
            var glass = s.Indices[1].Select(i => s.Vertices[i]).ToList();
            Assert.NotEmpty(glass);
            float top = (K0 + 12) * 0.2f;
            Assert.All(glass, v => Assert.InRange(v.Position.Y, top - 0.4f, top));
        }

        [Fact]
        public void ArchHasAnOpeningAndRoughlyTheRightVolume()
        {
            var t = Repo.Catalogue.ByName("arch_1x4").Info;
            var s = Run(0, 0, new[] { Brick("arch_1x4", I0, J0, K0, 0, Red) });
            // Bottom faces only under the two 1-stud piers: 2 x 0.5 m x 0.5 m.
            double bottom = s.Triangles().Where(x => x.a.Normal.Y < -0.99f && Math.Abs(x.a.Position.Y - K0 * 0.2f) < 1e-5f).Sum(x => Area(x.a.Position, x.b.Position, x.c.Position));
            Assert.Equal(0.5, bottom, 4);
            DetailShapes.ArchOpening(t, out _, out float rx, out float side, out float ry, out _);
            double opening = 2 * rx * side + Math.PI * rx * ry / 2;
            double expected = 0.5 * (2.0 * 0.6 - opening);
            Assert.InRange(MeshAssert.Volume(s), expected * 0.98, expected * 1.02);
            MeshAssert.WindingMatchesNormals(s);
        }

        [Fact]
        public void FenceHasEightRoundSpindles()
        {
            var s = Run(0, 0, new[] { Brick("fence_1x4", I0, J0, K0, 0, Red) });
            int spindleVertices = s.Vertices.Count(v => v.U1 == 0 && v.V1 == 0 && Math.Abs(v.Normal.Y) < 1e-6f);
            Assert.Equal(8 * DetailShapes.SpindleSegments * 4, spindleVertices);
        }

        [Fact]
        public void GrilleHasThreeGroovesOnTop()
        {
            var s = Run(0, 0, new[] { Brick("grille_1x2", I0, J0, K0, 0, Red) });
            float top = (K0 + 1) * 0.2f;
            int ribTops = s.Triangles().Count(x => x.a.Normal.Y > 0.99f && Math.Abs(x.a.Position.Y - top) < 1e-5f) / 2;
            Assert.Equal(DetailShapes.GrilleGrooves + 1, ribTops);
            Assert.Empty(s.Studs);
        }

        [Fact]
        public void WindowClosesItsSidesButNotItsFront()
        {
            // A wall brick east of the window loses its face toward the frame; one in front keeps it.
            var window = Brick("window_1x2x2", I0, J0, K0, 0, Red);
            var east = Brick("brick_1x1", I0 + 2, J0, K0, 0, Red);
            var front = Brick("brick_1x1", I0, J0 + 1, K0, 0, Red);
            var s = Run(0, 0, new[] { window, east, front });
            Assert.DoesNotContain(s.Triangles(), x => x.a.Normal.X < -0.99f && Math.Abs(x.a.Position.X - (I0 + 2) * 0.5f) < 1e-5f
                                                       && x.a.Position.Y < (K0 + 3) * 0.2f);
            Assert.Contains(s.Triangles(), x => x.a.Normal.Z < -0.99f && Math.Abs(x.a.Position.Z - (J0 + 1) * 0.5f) < 1e-5f
                                                 && x.a.Position.X < (I0 + 1) * 0.5f);
        }

        [Fact]
        public void GlassBricksHaveNoSeams()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x2", I0, J0, K0, 0, Glass) });
            Assert.All(s.Vertices, v => Assert.Equal((0f, 0f), (v.U1, v.V1)));
        }

        [Fact]
        public void Slope30HasNoStudsAndAThinLip()
        {
            var s = Run(0, 0, new[] { Brick("slope30_1x2", I0, J0, K0, 0, Red) });
            Assert.Empty(s.Studs);
            var lip = s.Triangles().Where(x => x.a.Normal.Z > 0.99f).SelectMany(x => new[] { x.a, x.b, x.c }).ToList();
            Assert.Equal(0.05f, lip.Max(v => v.Position.Y) - lip.Min(v => v.Position.Y), 4);
            Assert.Equal(0, MeshAssert.FacesWithNormal(s, new Float3(0, 1, 0))); // no flat top
        }

        [Theory]
        [InlineData(0)]
        [InlineData(1)]
        public void JumperHasOneCentredStud(int rot)
        {
            var s = Run(0, 0, new[] { Brick("jumper_1x2", I0, J0, K0, rot, Red) });
            var stud = Assert.Single(s.Studs);
            Rotation.RotatedExtent(2, 1, rot, out int ei, out int ej);
            Assert.Equal(((I0 + ei * 0.5f) * 0.5f, (J0 + ej * 0.5f) * 0.5f), (stud.X, stud.Z));
            // Anything on either cell above hides it.
            Rotation.FootprintCell(1, 0, 2, 1, rot, out int ci, out int cj);
            Assert.Empty(Run(0, 0, new[] { Brick("jumper_1x2", I0, J0, K0, rot, Red), Brick("plate_1x1", I0 + ci, J0 + cj, K0 + 1) })
                .Studs.Where(x => x.Y < (K0 + 1.5f) * 0.2f));
        }

        [Fact]
        public void RoundTileIsRoundWithoutStud()
        {
            var s = Run(0, 0, new[] { Brick("round_tile_1x1", I0, J0, K0, 0, Red) });
            Assert.Empty(s.Studs);
            MeshAssert.IsClosedManifold(s);
            Assert.Contains(s.Vertices, v => v.U1 == 0 && Math.Abs(v.Normal.Y) < 1e-6f);
        }

        [Fact]
        public void HideStudsFlagSuppressesStuds()
        {
            Assert.Equal(8, Run(0, 0, new[] { Brick("brick_2x4", I0, J0, K0) }).Studs.Count);
            Assert.Empty(Run(0, 0, new[] { Brick("brick_2x4", I0, J0, K0, hideStuds: true) }).Studs);
            Assert.Empty(Run(0, 0, new[] { Brick("jumper_1x2", I0, J0, K0, hideStuds: true) }).Studs);
        }

        private static double Area(Float3 a, Float3 b, Float3 c) => Float3.Cross(b - a, c - a).Length * 0.5;
    }
}
