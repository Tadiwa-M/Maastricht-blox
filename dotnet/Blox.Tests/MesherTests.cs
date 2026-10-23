using System;
using System.Linq;
using Blox.Data;
using Blox.Meshing.Core;
using Xunit;
using static Blox.Tests.MeshRunner;

namespace Blox.Tests
{
    public class MesherTests
    {
        private const byte Red = 4, Water = 32, Glass = 34;

        /// <summary>Every profile-based type (not the v2 detail pieces, see DetailMesherTests) in every rotation.</summary>
        public static TheoryData<string, int> ProfileTypesAllRotations()
        {
            var d = new TheoryData<string, int>();
            foreach (var t in Repo.Catalogue.Types)
                if (!t.Info.IsDetail)
                    for (int rot = 0; rot < 4; rot++) d.Add(t.Name, rot);
            return d;
        }

        [Theory]
        [MemberData(nameof(ProfileTypesAllRotations))]
        public void IsolatedBrickIsClosedOutwardAndHasExpectedVolume(string type, int rot)
        {
            var s = Run(2, 3, new[] { Brick(type, 2 * 64 + 10, 3 * 64 + 10, 100, rot) });
            MeshAssert.WindingMatchesNormals(s);
            MeshAssert.IsClosedManifold(s);
            Assert.InRange(Math.Abs(ExpectedVolume(Repo.Catalogue.ByName(type).Info) - MeshAssert.Volume(s)), 0, 1e-5);
            // Every vertex lies inside the brick's rotated box (chunk-local metres).
            var t = Repo.Catalogue.ByName(type).Info;
            Rotation.RotatedExtent(t, rot, out int ei, out int ej);
            foreach (var v in s.Vertices)
            {
                Assert.InRange(v.Position.X, 10 * 0.5f - 1e-4f, (10 + ei) * 0.5f + 1e-4f);
                Assert.InRange(v.Position.Z, 10 * 0.5f - 1e-4f, (10 + ej) * 0.5f + 1e-4f);
                Assert.InRange(v.Position.Y, 100 * 0.2f - 1e-4f, (100 + t.H) * 0.2f + 1e-4f);
            }
        }

        private static double ExpectedVolume(BrickTypeInfo t)
        {
            const double cell = 0.5 * 0.5 * 0.2;
            switch (t.Kind)
            {
                case BrickKind.Slope:
                {
                    double lip = BrickProfile.LipPlates, sr = t.StudRows;
                    double area = sr * t.H + (t.D - sr) * (t.H + lip) / 2.0; // stud x plate units
                    return t.W * area * cell;
                }
                case BrickKind.SlopeDouble:
                    return t.W * t.D * (t.H + BrickProfile.LipPlates) / 2.0 * cell;
                case BrickKind.Round:
                case BrickKind.RoundTile:
                {
                    int n = BrickProfile.RoundSegments;
                    double r = BrickProfile.RoundRadius * 0.5;
                    return 0.5 * n * r * r * Math.Sin(2 * Math.PI / n) * t.H * 0.2;
                }
                default:
                    return t.W * t.D * t.H * cell;
            }
        }

        [Fact]
        public void SingleBrickHasSixQuadsAndExposedStuds()
        {
            var s = Run(0, 0, new[] { Brick("brick_2x4", 5, 5, 10) });
            Assert.Equal(12, s.TriangleCount(0));
            Assert.Equal(0, s.TriangleCount(1));
            Assert.Equal(24, s.Vertices.Count);
            Assert.Equal(8, s.Studs.Count);
            var stud = s.Studs.OrderBy(x => x.X).ThenBy(x => x.Z).First();
            Assert.Equal((5.5f * 0.5f, 13 * 0.2f, 5.5f * 0.5f), (stud.X, stud.Y, stud.Z));
        }

        [Fact]
        public void AdjacentBricksShareNoFaces()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10), Brick("brick_1x1", 6, 5, 10) });
            Assert.Equal(10 * 2, s.TriangleCount(0));
            // No face on the shared plane x = 3.0 m.
            Assert.DoesNotContain(s.Triangles(), t => Math.Abs(t.a.Position.X - 3f) < 1e-5 && Math.Abs(t.b.Position.X - 3f) < 1e-5 && Math.Abs(t.c.Position.X - 3f) < 1e-5);
            MeshAssert.IsClosedManifold(s);
        }

        [Fact]
        public void StackedBricksCullTopBottomAndCoveredStuds()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10), Brick("brick_1x1", 5, 5, 13) });
            Assert.Equal(10 * 2, s.TriangleCount(0));
            Assert.Single(s.Studs);
            Assert.Equal(16 * 0.2f, s.Studs[0].Y, 5);
        }

        [Fact]
        public void PartiallyCoveredFaceIsKept()
        {
            // 1x1 brick against the 2-wide side of a 2x2 brick: the 1x1's face is hidden, the 2x2's is not.
            var s = Run(0, 0, new[] { Brick("brick_2x2", 5, 5, 10), Brick("brick_1x1", 7, 5, 10) });
            Assert.Equal((6 + 5) * 2, s.TriangleCount(0));
            // The 2x2's +x face at x = 3.5 m is present.
            Assert.Contains(s.Triangles(), t => Math.Abs(t.a.Normal.X - 1f) < 1e-5 && Math.Abs(t.a.Position.X - 3.5f) < 1e-5);
        }

        [Fact]
        public void PlateBesideBrickHidesOnlyThePlateFace()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10), Brick("plate_1x1", 6, 5, 10) });
            Assert.Equal((6 + 5) * 2, s.TriangleCount(0));
        }

        [Fact]
        public void SlopeSurfaceNormalTiltsTowardTheLowEdge()
        {
            for (int rot = 0; rot < 4; rot++)
            {
                var s = Run(0, 0, new[] { Brick("slope45_2x2", 10, 10, 10, rot) });
                Rotation.FrontDir(rot, out int di, out int dj); // a slope's front is its low edge
                var sloped = s.Triangles().Where(t => t.a.Normal.Y > 0.01f && t.a.Normal.Y < 0.99f).ToList();
                Assert.Equal(2, sloped.Count); // one quad
                var n = sloped[0].a.Normal;
                // rise 3 plates minus the 0.25-plate lip (0.55 m) over 1 stud (0.5 m).
                float rise = (3f - BrickProfile.LipPlates) * 0.2f;
                float len = (float)Math.Sqrt(rise * rise + 0.5 * 0.5);
                Assert.Equal(0.5f / len, n.Y, 4);
                Assert.Equal(di * rise / len, n.X, 4);
                Assert.Equal(dj * rise / len, n.Z, 4);
                // Flat top only over the studded back row, two studs on that row.
                Assert.Equal(2, s.Studs.Count);
                float backCentre = rot switch { 0 => 10.5f, 1 => 10.5f, 2 => 11.5f, _ => 11.5f } * 0.5f;
                foreach (var st in s.Studs)
                    Assert.Equal(backCentre, rot % 2 == 0 ? st.Z : st.X, 5);
            }
        }

        [Fact]
        public void Slope33HasShallowerSurfaceThanSlope45()
        {
            var s45 = Run(0, 0, new[] { Brick("slope45_1x2", 10, 10, 10) });
            var s33 = Run(0, 0, new[] { Brick("slope33_1x3", 10, 10, 10) });
            float Ny(ListSink s) => s.Triangles().First(t => t.a.Normal.Y > 0.01f && t.a.Normal.Y < 0.99f).a.Normal.Y;
            Assert.True(Ny(s33) > Ny(s45));
        }

        [Fact]
        public void RidgeHasTwoOpposedSlopesNoTopAndNoStuds()
        {
            var s = Run(0, 0, new[] { Brick("slope_double45_2x2", 10, 10, 10) });
            var sloped = s.Triangles().Where(t => t.a.Normal.Y > 0.01f && t.a.Normal.Y < 0.99f).ToList();
            Assert.Equal(4, sloped.Count);
            Assert.Contains(sloped, t => t.a.Normal.Z > 0.1f);
            Assert.Contains(sloped, t => t.a.Normal.Z < -0.1f);
            Assert.Equal(0, MeshAssert.FacesWithNormal(s, new Float3(0, 1, 0)));
            Assert.Empty(s.Studs);
        }

        [Fact]
        public void SlopeFrontOnlyHidesTheLip()
        {
            // Slope rot 0 (low edge +j) at j=10..11, a 1x1 brick in front at j=12, one behind at j=9.
            var bricks = new[] { Brick("brick_1x1", 10, 9, 10), Brick("slope45_1x2", 10, 10, 10), Brick("brick_1x1", 10, 12, 10) };
            var s = Run(0, 0, bricks);
            // Front brick's -j face stays (the slope's 0.05 m lip covers none of it).
            Assert.Contains(s.Triangles(), t => t.a.Normal.Z < -0.99f && Math.Abs(t.a.Position.Z - 6.0f) < 1e-5);
            // Slope's lip (+j at z = 6.0 m) is hidden by the front brick.
            Assert.DoesNotContain(s.Triangles(), t => t.a.Normal.Z > 0.99f && Math.Abs(t.a.Position.Z - 6.0f) < 1e-5);
            // Back faces: neither the slope's back nor the back brick's front survives at z = 5.0 m.
            Assert.DoesNotContain(s.Triangles(), t => Math.Abs(Math.Abs(t.a.Normal.Z) - 1) < 1e-5 && Math.Abs(t.a.Position.Z - 5.0f) < 1e-5
                                                      && Math.Abs(t.b.Position.Z - 5.0f) < 1e-5 && Math.Abs(t.c.Position.Z - 5.0f) < 1e-5);
            MeshAssert.WindingMatchesNormals(s);
        }

        [Fact]
        public void TransparentFacesGoToSubmeshOneAndDoNotHideSolids()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Red), Brick("brick_1x1", 6, 5, 10, color: Water) });
            Assert.Equal(6 * 2, s.TriangleCount(0));  // solid keeps its face toward the water
            Assert.Equal(5 * 2, s.TriangleCount(1));  // water loses its face toward the solid
            Assert.All(s.Indices[1], i => Assert.Equal((float)MaterialClass.Trans, s.Vertices[i].U2));
        }

        [Fact]
        public void SameClassTransparentNeighboursHideSharedFaces()
        {
            var water = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Water), Brick("brick_1x1", 6, 5, 10, color: 33) });
            Assert.Equal(10 * 2, water.TriangleCount(1));
            var mixed = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Water), Brick("brick_1x1", 6, 5, 10, color: Glass) });
            Assert.Equal(12 * 2, mixed.TriangleCount(1));
        }

        [Fact]
        public void StudUnderGlassIsCovered()
        {
            var s = Run(0, 0, new[] { Brick("plate_1x1", 5, 5, 10), Brick("brick_1x1", 5, 5, 11, color: Glass) });
            Assert.Single(s.Studs); // only the glass brick's own stud
            Assert.Equal(14 * 0.2f, s.Studs[0].Y, 5);
        }

        [Fact]
        public void TilesAndRidgesHaveNoStudsAndRoundHasOne()
        {
            Assert.Empty(Run(0, 0, new[] { Brick("tile_2x4", 5, 5, 10) }).Studs);
            Assert.Single(Run(0, 0, new[] { Brick("round_brick_1x1", 5, 5, 10) }).Studs);
        }

        [Fact]
        public void ChunkBorderUsesNeighbourBricks()
        {
            var own = new[] { Brick("brick_1x1", 63, 5, 10) };
            var neighbour = new[] { Brick("brick_1x1", 64, 5, 10) };
            Assert.Equal(12, Run(0, 0, own).TriangleCount(0));
            Assert.Equal(10, Run(0, 0, own, neighbour).TriangleCount(0));
            // Mesh positions are chunk-local: chunk (1, 0) brick at I = 64 starts at x = 0.
            var s = Run(1, 0, neighbour);
            Assert.Equal(0f, s.Vertices.Min(v => v.Position.X), 5);
            Assert.Equal(64 * 0.5f + 0.25f, s.Studs[0].X, 5); // studs are absolute
        }

        [Fact]
        public void FaceUvsAreMetresWithinFaceSize()
        {
            var s = Run(0, 0, new[] { Brick("brick_1x4", 5, 5, 10) });
            var side = s.Triangles().Where(t => t.a.Normal.X > 0.99f).SelectMany(t => new[] { t.a, t.b, t.c }).ToList();
            Assert.All(side, v => Assert.Equal((2.0f, 0.6f), (v.U1, (float)Math.Round(v.V1, 5))));
            Assert.Equal(0f, side.Min(v => v.U0), 5);
            Assert.Equal(2.0f, side.Max(v => v.U0), 5);
            Assert.Equal(0.6f, side.Max(v => v.V0), 5);
            var top = s.Triangles().Where(t => t.a.Normal.Y > 0.99f).SelectMany(t => new[] { t.a, t.b, t.c }).ToList();
            Assert.All(top, v => Assert.Equal((0.5f, 2.0f), (v.U1, v.V1)));
            Assert.All(s.Vertices, v => Assert.Equal((float)MaterialClass.Solid, v.U2));
        }

        [Fact]
        public void ColourIsLinearWithDeterministicVariation()
        {
            var exact = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Red, noVariation: true) });
            var pc = Repo.Colors[Red];
            Assert.All(exact.Vertices, v => Assert.Equal((pc.R, pc.G, pc.B), (v.R, v.G, v.B)));
            var varied = Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Red) });
            var v0 = varied.Vertices[0];
            uint seed = BrickVariation.Seed(5, 5, 10);
            Assert.Equal(pc.G * (1 + BrickVariation.ValueJitter(seed)), v0.G, 6);
            Assert.InRange(v0.R / pc.R, 1 - 0.09, 1 + 0.09);
            Assert.Equal(BrickVariation.Seed01(seed), v0.V2, 6);
            Assert.Equal(varied.Vertices.Select(v => v.R), Run(0, 0, new[] { Brick("brick_1x1", 5, 5, 10, color: Red) }).Vertices.Select(v => v.R));
        }

        [Fact]
        public void RoundBrickEnclosedOnAllSidesEmitsNothing()
        {
            var around = new[]
            {
                Brick("brick_1x1", 4, 5, 10), Brick("brick_1x1", 6, 5, 10), Brick("brick_1x1", 5, 4, 10), Brick("brick_1x1", 5, 6, 10),
                Brick("plate_1x1", 5, 5, 9), Brick("plate_1x1", 5, 5, 13),
            };
            var withRound = Run(0, 0, around.Append(Brick("round_brick_1x1", 5, 5, 10)).ToArray());
            var without = Run(0, 0, around);
            // The neighbours' faces toward the round brick stay (it covers nothing), the round emits nothing.
            Assert.Equal(without.TriangleCount(0), withRound.TriangleCount(0));
        }

        [Fact]
        public void CellGridCoverMasksFollowRotation()
        {
            var t = Repo.Types[Repo.TypeId("slope45_1x2")];
            // rot 1: low edge faces +i. Back row cell (a=0,b=0) covers +j/-j sides fully at every plate.
            Assert.Equal(1 << Dir.PosY, BrickProfile.CoverMaskWorld(t, 1, 0, 0, 2) & (1 << Dir.PosY));
            int frontTop = BrickProfile.CoverMaskWorld(t, 1, 0, 1, 2);
            Assert.Equal(0, frontTop & (1 << Dir.PosX));   // the front is the sloped surface
            Assert.Equal(0, frontTop & (1 << Dir.PosY));
            // v2: the lip is only 0.05 m, so even the bottom plate's front face is not closed.
            Assert.Equal(0, BrickProfile.CoverMaskWorld(t, 1, 0, 1, 0) & (1 << Dir.PosX));
            Assert.NotEqual(0, BrickProfile.CoverMaskWorld(t, 1, 0, 0, 0) & (1 << Dir.NegX)); // back stays closed
        }
    }
}
