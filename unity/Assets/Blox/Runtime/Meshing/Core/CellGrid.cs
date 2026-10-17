#nullable enable
using System;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>Box of global cells covered by a dense <see cref="CellGrid"/> buffer.</summary>
    public struct CellGridDims
    {
        public int I0, J0, K0;          // global cell of index 0
        public int SizeI, SizeJ, SizeK;

        public int Length => SizeI * SizeJ * SizeK;

        /// <summary>Flat index of global cell (I, J, K), or -1 when outside.</summary>
        public int Index(int i, int j, int k)
        {
            int li = i - I0, lj = j - J0, lk = k - K0;
            if ((uint)li >= (uint)SizeI || (uint)lj >= (uint)SizeJ || (uint)lk >= (uint)SizeK) return -1;
            return (lk * SizeJ + lj) * SizeI + li;
        }
    }

    /// <summary>
    /// Dense per-cell occupancy for one chunk plus a one-cell border, built from global bricks.
    /// Cell value (ushort): bits 0-5 = world directions whose cell face the occupying brick
    /// fully covers (<see cref="Dir"/> order), bit 6 = occupied, bits 8-15 = <see cref="MaterialClass"/>.
    /// Pure functions over spans so they run identically in Burst and in dotnet tests.
    /// </summary>
    public static class CellGrid
    {
        public const int OccupiedBit = 1 << 6;
        public const int CoverMask = 0x3F;

        public static bool Occupied(ushort v) => (v & OccupiedBit) != 0;
        public static bool Covers(ushort v, int worldDir) => (v & (1 << worldDir)) != 0;
        public static MaterialClass Material(ushort v) => (MaterialClass)(v >> 8);

        /// <summary>
        /// Grid box for a chunk whose SW cell is (chunkI0, chunkJ0): the chunk's 64 x 64 columns
        /// plus one cell all round, vertically [minK - 1, maxTop] of the chunk's own bricks.
        /// Returns SizeK = 0 when there are no valid bricks.
        /// </summary>
        public static CellGridDims ComputeDims(ReadOnlySpan<PlacedBrick> own, ReadOnlySpan<BrickTypeInfo> types, int chunkI0, int chunkJ0)
        {
            int minK = int.MaxValue, maxTop = int.MinValue;
            for (int n = 0; n < own.Length; n++)
            {
                var t = types[own[n].Type];
                if (t.Defined == 0) continue;
                minK = Math.Min(minK, own[n].K);
                maxTop = Math.Max(maxTop, own[n].K + t.H);
            }
            var d = new CellGridDims { I0 = chunkI0 - 1, J0 = chunkJ0 - 1, SizeI = Units.ChunkStuds + 2, SizeJ = Units.ChunkStuds + 2 };
            if (minK == int.MaxValue) { d.K0 = 0; d.SizeK = 0; return d; }
            d.K0 = minK - 1;
            d.SizeK = maxTop - minK + 2; // [minK-1, maxTop] inclusive
            return d;
        }

        /// <summary>Clears <paramref name="cells"/> and stamps every brick (own and neighbours) into it.</summary>
        public static void Fill(Span<ushort> cells, in CellGridDims dims, ReadOnlySpan<PlacedBrick> bricks,
                                ReadOnlySpan<BrickTypeInfo> types, ReadOnlySpan<PaletteColor> colors)
        {
            cells.Slice(0, dims.Length).Clear();
            for (int n = 0; n < bricks.Length; n++) Stamp(cells, dims, bricks[n], types, colors);
        }

        public static void Stamp(Span<ushort> cells, in CellGridDims dims, in PlacedBrick br,
                                 ReadOnlySpan<BrickTypeInfo> types, ReadOnlySpan<PaletteColor> colors)
        {
            var t = types[br.Type];
            if (t.Defined == 0) return;
            int rot = br.Rot;
            Footprint.Extent(t, rot, out int ei, out int ej);
            // Quick reject when the brick box misses the grid.
            if (br.I + ei <= dims.I0 || br.I >= dims.I0 + dims.SizeI || br.J + ej <= dims.J0 || br.J >= dims.J0 + dims.SizeJ
                || br.K + t.H <= dims.K0 || br.K >= dims.K0 + dims.SizeK) return;
            int material = (int)colors[br.Color].Material;
            for (int cj = 0; cj < ej; cj++)
                for (int ci = 0; ci < ei; ci++)
                {
                    Footprint.UnrotateCell(ci, cj, t.W, t.D, rot, out int a, out int b);
                    for (int p = 0; p < t.H; p++)
                    {
                        int idx = dims.Index(br.I + ci, br.J + cj, br.K + p);
                        if (idx < 0) continue;
                        int cover = BrickProfile.CoverMaskWorld(t, rot, a, b, p);
                        cells[idx] = (ushort)(cover | OccupiedBit | (material << 8));
                    }
                }
        }

        /// <summary>Value at a global cell; 0 (air) outside the grid.</summary>
        public static ushort Get(ReadOnlySpan<ushort> cells, in CellGridDims dims, int i, int j, int k)
        {
            int idx = dims.Index(i, j, k);
            return idx < 0 ? (ushort)0 : cells[idx];
        }

        /// <summary>
        /// Whether a face of a brick with material <paramref name="self"/>, lying on the boundary of
        /// cell (i, j, k) and facing world direction <paramref name="worldDir"/>, is hidden by the
        /// neighbouring cell. Hidden when the neighbour fully covers that face and is opaque, or
        /// when both are see-through with the same material class (no internal water/glass walls).
        /// </summary>
        public static bool FaceHidden(ReadOnlySpan<ushort> cells, in CellGridDims dims, int i, int j, int k, int worldDir, MaterialClass self)
        {
            ushort n = Get(cells, dims, i + Dir.Di(worldDir), j + Dir.Dj(worldDir), k + Dir.Dk(worldDir));
            if (!Occupied(n) || !Covers(n, Dir.Opposite(worldDir))) return false;
            MaterialClass other = Material(n);
            if (other.IsOpaque()) return true;
            return !self.IsOpaque() && other == self;
        }
    }
}
