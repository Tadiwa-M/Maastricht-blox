#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Sparse per-column occupancy of one chunk: for each of the 64 x 64 columns a list of
    /// vertical spans [k0, k1) owned by a brick (index into the chunk's records). Memory is
    /// one span per brick footprint cell. Bricks occupy their whole rotated bounding box
    /// (slopes included), matching the "no two bricks overlap in any cell" rule.
    /// </summary>
    public sealed class ChunkOccupancy
    {
        public const int Size = 64;

        private readonly int[] _colStart;   // Size*Size + 1 prefix offsets
        private readonly ushort[] _k0;
        private readonly int[] _k1;          // exclusive top (may exceed 65535)
        private readonly int[] _brick;

        public ChunkData Chunk { get; }

        public ChunkOccupancy(ChunkData chunk, BrickTypeInfo[] catalogue)
        {
            Chunk = chunk;
            var recs = chunk.Records;
            _colStart = new int[Size * Size + 1];
            int total = 0;
            for (int n = 0; n < recs.Length; n++)
            {
                Box(recs[n], catalogue, out int ei, out int ej, out _);
                for (int dj = 0; dj < ej; dj++)
                    for (int di = 0; di < ei; di++)
                        _colStart[Col(recs[n].i + di, recs[n].j + dj) + 1]++;
                total += ei * ej;
            }
            for (int c = 0; c < Size * Size; c++) _colStart[c + 1] += _colStart[c];
            _k0 = new ushort[total];
            _k1 = new int[total];
            _brick = new int[total];
            var fill = new int[Size * Size];
            Array.Copy(_colStart, fill, Size * Size);
            // Records are sorted by k, so each column's spans come out sorted by k0.
            for (int n = 0; n < recs.Length; n++)
            {
                var r = recs[n];
                Box(r, catalogue, out int ei, out int ej, out int h);
                for (int dj = 0; dj < ej; dj++)
                    for (int di = 0; di < ei; di++)
                    {
                        int c = Col(r.i + di, r.j + dj);
                        int at = fill[c]++;
                        _k0[at] = r.k;
                        _k1[at] = r.k + h;
                        _brick[at] = n;
                    }
            }
        }

        private static void Box(in BrickRecord r, BrickTypeInfo[] cat, out int ei, out int ej, out int h)
        {
            var t = cat[r.type];
            if (t.Defined == 0) throw new ArgumentException($"unknown typeId {r.type}");
            Footprint.Extent(t, r.Rot, out ei, out ej);
            if (r.i + ei > Size || r.j + ej > Size) throw new ArgumentException($"brick {r} crosses the chunk border");
            h = t.H;
        }

        private static int Col(int i, int j) => j * Size + i;

        /// <summary>Index of the brick occupying local cell (i, j, k), or -1.</summary>
        public int BrickAt(int i, int j, int k)
        {
            if ((uint)i >= Size || (uint)j >= Size) return -1;
            int c = Col(i, j);
            int lo = _colStart[c], hi = _colStart[c + 1] - 1, found = -1;
            while (lo <= hi) // last span with k0 <= k
            {
                int mid = (lo + hi) >> 1;
                if (_k0[mid] <= k) { found = mid; lo = mid + 1; } else hi = mid - 1;
            }
            return found >= 0 && k < _k1[found] ? _brick[found] : -1;
        }

        /// <summary>Exclusive top K of the highest brick in column (i, j), or -1 if empty.</summary>
        public int ColumnTop(int i, int j)
        {
            if ((uint)i >= Size || (uint)j >= Size) return -1;
            int c = Col(i, j);
            int top = -1;
            for (int s = _colStart[c]; s < _colStart[c + 1]; s++) top = Math.Max(top, _k1[s]);
            return top;
        }

        public int SpanCount => _k0.Length;
    }
}
