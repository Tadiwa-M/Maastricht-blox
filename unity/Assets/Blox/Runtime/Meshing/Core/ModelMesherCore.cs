#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Meshes a <see cref="BrickModel"/> (CONTRACT 7.1) into one mesh per part, so each part
    /// can be its own child object that rotates about its pivot (legs, arms, wheels).
    /// Part index -1 is the static body (bricks without a part).
    ///
    /// <para>Same brick geometry as the chunks (<see cref="BrickBodyMesher"/>), with two
    /// differences: faces are culled only against bricks of the <b>same</b> part (a swinging leg
    /// must not leave a hole in the hip), and exposed studs become real geometry
    /// (<see cref="StudMesher"/>) because the model moves. A stud is exposed when nothing of the
    /// whole model sits on it.</para>
    ///
    /// <para>Output positions are metres relative to the part's pivot (or the model pivot for
    /// the body): x = i * 0.5, y = k * 0.2, z = j * 0.5 minus that origin. Place the part object
    /// at <see cref="PartOffset"/> under the model root.</para>
    /// </summary>
    public static class ModelMesherCore
    {
        /// <summary>Model bricks as placed bricks in model-local cells (I = i, J = j, K = k).</summary>
        public static PlacedBrick[] Bricks(BrickModel model, int part = int.MinValue)
        {
            var list = new List<PlacedBrick>(model.Bricks.Count);
            foreach (var b in model.Bricks)
                if (part == int.MinValue || b.Part == part)
                    list.Add(new PlacedBrick(b.I, b.J, b.K, b.Type, b.Color, b.RotFlags));
            return list.ToArray();
        }

        /// <summary>Origin of a part's mesh in model-local metres: the part pivot, or the model pivot for the body (-1).</summary>
        public static void PartOrigin(BrickModel model, int part, out float x, out float y, out float z)
        {
            if (part >= 0)
            {
                var p = model.Parts[part];
                x = p.PivotI * Units.StudM; y = p.PivotK * Units.PlateM; z = p.PivotJ * Units.StudM;
            }
            else
            {
                x = model.PivotI * Units.StudM; y = model.PivotK * Units.PlateM; z = model.PivotJ * Units.StudM;
            }
        }

        /// <summary>Where a part object sits relative to the model root (metres): part pivot minus model pivot.</summary>
        public static void PartOffset(BrickModel model, int part, out float x, out float y, out float z)
        {
            PartOrigin(model, part, out x, out y, out z);
            PartOrigin(model, -1, out float mx, out float my, out float mz);
            x -= mx; y -= my; z -= mz;
        }

        /// <summary>Builds the mesh of one part (-1 = body) into <paramref name="sink"/>.</summary>
        public static void BuildPart<TSink>(ref TSink sink, BrickModel model, int part, ReadOnlySpan<BrickTypeInfo> types,
                                            ReadOnlySpan<PaletteColor> colors, bool studs = true)
            where TSink : struct, IChunkMeshSink
        {
            var all = Bricks(model);
            var mine = Bricks(model, part);
            if (mine.Length == 0) return;
            var dims = Dims(all, types);
            var everything = new ushort[dims.Length];
            CellGrid.Fill(everything, dims, all, types, colors);
            var samepart = new ushort[dims.Length];
            CellGrid.Fill(samepart, dims, mine, types, colors);

            PartOrigin(model, part, out float ox, out float oy, out float oz);
            var ctx = new MeshContext
            {
                Cells = samepart, Dims = dims, Types = types, Colors = colors,
                OriginX = ox, OriginY = oy, OriginZ = oz, Glass = MeshContext.FindGlass(colors),
            };
            foreach (var br in mine)
            {
                var t = types[br.Type];
                if (t.Defined == 0) continue;
                var style = ChunkMesherCore.Style(br, colors);
                BrickBodyMesher.Emit(ref sink, br, t, ctx, style);
                if (!studs) continue;
                int top = br.K + t.H, spots = StudExtractor.SpotCount(t);
                for (int n = 0; n < spots; n++)
                    if (StudExtractor.ExposedSpot(br, t, n, everything, dims, out float ci, out float cj, out _, out _))
                        StudMesher.Emit(ref sink, ci * Units.StudM - ox, top * Units.PlateM - oy, cj * Units.StudM - oz, style);
            }
        }

        /// <summary>Grid box around every brick of the model plus one empty cell all round.</summary>
        public static CellGridDims Dims(ReadOnlySpan<PlacedBrick> bricks, ReadOnlySpan<BrickTypeInfo> types)
        {
            int i0 = int.MaxValue, j0 = int.MaxValue, k0 = int.MaxValue, i1 = int.MinValue, j1 = int.MinValue, k1 = int.MinValue;
            foreach (var b in bricks)
            {
                var t = types[b.Type];
                if (t.Defined == 0) continue;
                Rotation.RotatedExtent(t, b.Rot, out int ei, out int ej);
                i0 = Math.Min(i0, b.I); j0 = Math.Min(j0, b.J); k0 = Math.Min(k0, b.K);
                i1 = Math.Max(i1, b.I + ei); j1 = Math.Max(j1, b.J + ej); k1 = Math.Max(k1, b.K + t.H);
            }
            if (i0 == int.MaxValue) return new CellGridDims();
            return new CellGridDims { I0 = i0 - 1, J0 = j0 - 1, K0 = k0 - 1, SizeI = i1 - i0 + 2, SizeJ = j1 - j0 + 2, SizeK = k1 - k0 + 2 };
        }
    }
}
