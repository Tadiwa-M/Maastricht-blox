#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>
    /// Full-detail chunk mesher (engine-free core). Steps:
    /// <list type="number">
    /// <item><see cref="CellGrid.ComputeDims"/> for the chunk's own bricks, allocate cells.</item>
    /// <item><see cref="CellGrid.Fill"/> with own + neighbour bricks (neighbours only matter within one cell of the border).</item>
    /// <item><see cref="Build"/>: body faces into submesh 0 (opaque) / 1 (trans/glass) plus exposed studs.</item>
    /// </list>
    /// Mesh positions are chunk-local (x, z relative to the chunk SW corner, y absolute);
    /// stud positions are absolute Unity world metres.
    /// </summary>
    public static class ChunkMesherCore
    {
        public static void Build<TSink>(ref TSink sink, ReadOnlySpan<PlacedBrick> own, ReadOnlySpan<ushort> cells, in CellGridDims dims,
                                        ReadOnlySpan<BrickTypeInfo> types, ReadOnlySpan<PaletteColor> colors, float originX, float originZ)
            where TSink : struct, IChunkMeshSink
        {
            var ctx = new MeshContext
            {
                Cells = cells, Dims = dims, Types = types, Colors = colors, OriginX = originX, OriginZ = originZ,
                Glass = MeshContext.FindGlass(colors),
            };
            for (int n = 0; n < own.Length; n++)
            {
                var br = own[n];
                var t = types[br.Type];
                if (t.Defined == 0) continue;
                var style = Style(br, colors);
                BrickBodyMesher.Emit(ref sink, br, t, ctx, style);
                StudExtractor.Emit(ref sink, br, t, cells, dims, style);
            }
        }

        /// <summary>Brick colour (linear, with variation unless no_variation) and seed.</summary>
        public static FaceStyle Style(in PlacedBrick br, ReadOnlySpan<PaletteColor> colors)
        {
            var c = colors[br.Color];
            uint seed = BrickVariation.Seed(br.I, br.J, br.K);
            float r = c.R, g = c.G, b = c.B;
            BrickVariation.Apply(seed, br.NoVariation, ref r, ref g, ref b);
            return new FaceStyle { R = r, G = g, B = b, Material = c.Material, Seed01 = BrickVariation.Seed01(seed) };
        }
    }
}
