#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>Coarse grid of an LOD build.</summary>
    public struct LodDims
    {
        public int Factor;        // horizontal: studs per coarse cell (2, 4 or 8)
        public int FactorK;       // vertical: plates per coarse cell (Factor * 5 / 2, near-cubic)
        public int ChunkI0, ChunkJ0;
        public int KC0;           // global coarse level of index 0
        public int NI, NJ, NK;

        public int Length => NI * NJ * NK;
        public int Index(int x, int y, int z) => (y * NJ + z) * NI + x; // x = i, y = k, z = j
        public int Size(int axis) => axis == 0 ? NI : axis == 1 ? NK : NJ;
    }

    /// <summary>
    /// HLOD mesher: downsamples a chunk by 2/4/8 into coarse cells and emits greedy-merged
    /// boxes (no studs, no bevel edges: UV1 = 0). A coarse cell is solid when any fine cell in it
    /// is occupied (keeps thin hollow walls), and takes the colour of its highest brick (roofs
    /// win, which is what matters from far away). Faces between coarse cells follow the same
    /// opaque / same-transparent-class rule as the full mesher; chunk borders are not culled.
    /// </summary>
    public static class LodMesherCore
    {
        public static LodDims ComputeDims(ReadOnlySpan<PlacedBrick> own, ReadOnlySpan<BrickTypeInfo> types, int chunkI0, int chunkJ0, int factor)
        {
            if (factor != 2 && factor != 4 && factor != 8) throw new ArgumentException("LOD factor must be 2, 4 or 8");
            var d = new LodDims { Factor = factor, FactorK = factor * 5 / 2, ChunkI0 = chunkI0, ChunkJ0 = chunkJ0, NI = Units.ChunkStuds / factor, NJ = Units.ChunkStuds / factor };
            int minK = int.MaxValue, maxTop = int.MinValue;
            for (int n = 0; n < own.Length; n++)
            {
                var t = types[own[n].Type];
                if (t.Defined == 0) continue;
                minK = Math.Min(minK, own[n].K);
                maxTop = Math.Max(maxTop, own[n].K + t.H);
            }
            if (minK == int.MaxValue) { d.NK = 0; return d; }
            d.KC0 = WorldSpec.FloorDiv(minK, d.FactorK);
            d.NK = WorldSpec.FloorDiv(maxTop - 1, d.FactorK) - d.KC0 + 1;
            return d;
        }

        /// <summary>Scratch bytes needed by <see cref="Build"/> for the 2D face mask.</summary>
        public static int MaskSize(in LodDims d) => Math.Max(d.NI * d.NJ, Math.Max(d.NI * d.NK, d.NJ * d.NK));

        /// <summary>Fills the coarse colour grid (0 = empty). <paramref name="topK"/> is scratch of <c>Length</c> ints.</summary>
        public static void Downsample(ReadOnlySpan<PlacedBrick> own, ReadOnlySpan<BrickTypeInfo> types, in LodDims d, Span<byte> color, Span<int> topK)
        {
            color.Slice(0, d.Length).Clear();
            topK.Slice(0, d.Length).Fill(int.MinValue);
            for (int n = 0; n < own.Length; n++)
            {
                var br = own[n];
                var t = types[br.Type];
                if (t.Defined == 0) continue;
                Footprint.Extent(t, br.Rot, out int ei, out int ej);
                for (int cj = 0; cj < ej; cj++)
                    for (int ci = 0; ci < ei; ci++)
                    {
                        int li = br.I + ci - d.ChunkI0, lj = br.J + cj - d.ChunkJ0;
                        if ((uint)li >= Units.ChunkStuds || (uint)lj >= Units.ChunkStuds) continue;
                        for (int p = 0; p < t.H; p++)
                        {
                            int k = br.K + p;
                            int idx = d.Index(li / d.Factor, WorldSpec.FloorDiv(k, d.FactorK) - d.KC0, lj / d.Factor);
                            if (k > topK[idx]) { topK[idx] = k; color[idx] = br.Color; }
                        }
                    }
            }
        }

        /// <summary>Greedy-meshes the coarse grid into the sink. <paramref name="mask"/> needs <see cref="MaskSize"/> bytes.</summary>
        public static void Build<TSink>(ref TSink sink, in LodDims d, ReadOnlySpan<byte> color, ReadOnlySpan<PaletteColor> colors,
                                        Span<byte> mask, float originX, float originZ)
            where TSink : struct, IChunkMeshSink
        {
            for (int dir = 0; dir < 6; dir++)
            {
                int axis = dir >= Dir.PosY ? 1 : dir >= Dir.PosZ ? 2 : 0;   // 0 = x(i), 1 = y(k), 2 = z(j)
                int sign = (dir & 1) == 0 ? 1 : -1;
                int ua = axis == 0 ? 2 : 0, va = axis == 1 ? 2 : 1;          // the two in-plane axes
                int nS = d.Size(axis), nU = d.Size(ua), nV = d.Size(va);
                for (int s = 0; s < nS; s++)
                {
                    for (int v = 0; v < nV; v++)
                        for (int u = 0; u < nU; u++)
                            mask[v * nU + u] = VisibleColor(d, color, colors, axis, ua, va, s, u, v, sign);
                    Greedy(ref sink, d, colors, mask, nU, nV, axis, ua, va, s, sign, dir, originX, originZ);
                }
            }
        }

        private static byte VisibleColor(in LodDims d, ReadOnlySpan<byte> color, ReadOnlySpan<PaletteColor> colors,
                                         int axis, int ua, int va, int s, int u, int v, int sign)
        {
            Cell(axis, ua, va, s, u, v, out int x, out int y, out int z);
            byte c = color[d.Index(x, y, z)];
            if (c == 0) return 0;
            int nx = x + (axis == 0 ? sign : 0), ny = y + (axis == 1 ? sign : 0), nz = z + (axis == 2 ? sign : 0);
            if (nx < 0 || ny < 0 || nz < 0 || nx >= d.NI || ny >= d.NK || nz >= d.NJ) return c;
            byte o = color[d.Index(nx, ny, nz)];
            if (o == 0) return c;
            MaterialClass self = colors[c].Material, other = colors[o].Material;
            if (other.IsOpaque()) return 0;
            return !self.IsOpaque() && self == other ? (byte)0 : c;
        }

        private static void Cell(int axis, int ua, int va, int s, int u, int v, out int x, out int y, out int z)
        {
            x = y = z = 0;
            Assign(axis, s, ref x, ref y, ref z);
            Assign(ua, u, ref x, ref y, ref z);
            Assign(va, v, ref x, ref y, ref z);
        }

        private static void Assign(int axis, int value, ref int x, ref int y, ref int z)
        {
            if (axis == 0) x = value; else if (axis == 1) y = value; else z = value;
        }

        private static void Greedy<TSink>(ref TSink sink, in LodDims d, ReadOnlySpan<PaletteColor> colors, Span<byte> mask,
                                          int nU, int nV, int axis, int ua, int va, int s, int sign, int dir, float originX, float originZ)
            where TSink : struct, IChunkMeshSink
        {
            for (int v = 0; v < nV; v++)
                for (int u = 0; u < nU;)
                {
                    byte c = mask[v * nU + u];
                    if (c == 0) { u++; continue; }
                    int w = 1;
                    while (u + w < nU && mask[v * nU + u + w] == c) w++;
                    int h = 1;
                    while (v + h < nV && RowMatches(mask, nU, v + h, u, w, c)) h++;
                    for (int dv = 0; dv < h; dv++)
                        for (int du = 0; du < w; du++) mask[(v + dv) * nU + u + du] = 0;
                    EmitQuad(ref sink, d, colors[c], axis, ua, va, s + (sign > 0 ? 1 : 0), u, v, w, h, dir, originX, originZ);
                    u += w;
                }
        }

        private static bool RowMatches(Span<byte> mask, int nU, int v, int u, int w, byte c)
        {
            for (int du = 0; du < w; du++) if (mask[v * nU + u + du] != c) return false;
            return true;
        }

        private static void EmitQuad<TSink>(ref TSink sink, in LodDims d, in PaletteColor pc, int axis, int ua, int va,
                                            int plane, int u, int v, int w, int h, int dir, float originX, float originZ)
            where TSink : struct, IChunkMeshSink
        {
            var poly = new Poly();
            AddCorner(ref poly, d, axis, ua, va, plane, u, v, originX, originZ);
            AddCorner(ref poly, d, axis, ua, va, plane, u + w, v, originX, originZ);
            AddCorner(ref poly, d, axis, ua, va, plane, u + w, v + h, originX, originZ);
            AddCorner(ref poly, d, axis, ua, va, plane, u, v + h, originX, originZ);
            var hint = new Float3(Dir.Di(dir), Dir.Dk(dir), Dir.Dj(dir));
            var style = new FaceStyle { R = pc.R, G = pc.G, B = pc.B, Material = pc.Material, Seed01 = 0 };
            FaceEmitter.EmitWorld(ref sink, poly, hint, style, false);
        }

        private static void AddCorner(ref Poly poly, in LodDims d, int axis, int ua, int va, int plane, int u, int v, float originX, float originZ)
        {
            Cell(axis, ua, va, plane, u, v, out int x, out int y, out int z);
            poly.Add((d.ChunkI0 + x * d.Factor) * Units.StudM - originX,
                     (d.KC0 + y) * d.FactorK * Units.PlateM,
                     (d.ChunkJ0 + z * d.Factor) * Units.StudM - originZ);
        }
    }
}
