#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>
    /// Sparse per-column occupancy of a square grid of bricks: for each column (i, j) a list of
    /// vertical spans [k0, k1) owned by a brick (index into the record array). Memory is one span
    /// per brick footprint cell. Bricks occupy their whole rotated bounding box (slopes included),
    /// matching the "no two bricks overlap in any cell" rule.
    ///
    /// <para>Shared by <see cref="ChunkOccupancy"/> (64 x 64 chunk) and <see cref="IslandIndex"/>
    /// (up to 256 x 256 island cells, CONTRACT 5.1). Why one class: an island is "a chunk on its own
    /// rotated grid", so the occupancy questions (what is at (i, j, k), how tall is this column) are
    /// the same, only the grid size differs.</para>
    /// </summary>
    public sealed class ColumnOccupancy
    {
        private readonly int _size;
        private readonly int[] _colStart;   // size*size + 1 prefix offsets
        private readonly ushort[] _k0;
        private readonly int[] _k1;          // exclusive top (may exceed 65535)
        private readonly int[] _brick;

        /// <summary>Grid edge length in cells (64 for chunks, 256 for islands).</summary>
        public int Size => _size;
        public int SpanCount => _k0.Length;

        /// <param name="records">Bricks with local (i, j); any order (sorted by k is cheapest).</param>
        /// <param name="what">Name used in error messages ("chunk", "island").</param>
        public ColumnOccupancy(BrickRecord[] records, BrickTypeInfo[] catalogue, int size, string what = "chunk")
        {
            if (size <= 0) throw new ArgumentException("size must be positive");
            _size = size;
            // Spans of a column must come out sorted by k0 for the binary search; chunk files are
            // sorted by (k, j, i) already, island files are not required to be.
            int[] order = KOrder(records);
            _colStart = new int[size * size + 1];
            int total = 0;
            for (int n = 0; n < records.Length; n++)
            {
                Box(records[n], catalogue, size, what, out int ei, out int ej, out _);
                for (int dj = 0; dj < ej; dj++)
                    for (int di = 0; di < ei; di++)
                        _colStart[Col(records[n].i + di, records[n].j + dj) + 1]++;
                total += ei * ej;
            }
            for (int c = 0; c < size * size; c++) _colStart[c + 1] += _colStart[c];
            _k0 = new ushort[total];
            _k1 = new int[total];
            _brick = new int[total];
            var fill = new int[size * size];
            Array.Copy(_colStart, fill, size * size);
            foreach (int n in order)
            {
                var r = records[n];
                Box(r, catalogue, size, what, out int ei, out int ej, out int h);
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

        private static int[] KOrder(BrickRecord[] records)
        {
            var order = new int[records.Length];
            bool sorted = true;
            for (int n = 0; n < order.Length; n++)
            {
                order[n] = n;
                if (n > 0 && records[n - 1].k > records[n].k) sorted = false;
            }
            if (!sorted)
            {
                var keys = new long[records.Length];
                for (int n = 0; n < keys.Length; n++) keys[n] = ((long)records[n].k << 32) | (uint)n; // stable
                Array.Sort(keys, order);
            }
            return order;
        }

        private static void Box(in BrickRecord r, BrickTypeInfo[] cat, int size, string what, out int ei, out int ej, out int h)
        {
            var t = cat[r.type];
            if (t.Defined == 0) throw new ArgumentException($"unknown typeId {r.type}");
            Rotation.RotatedExtent(t, r.Rot, out ei, out ej);
            if (r.i + ei > size || r.j + ej > size) throw new ArgumentException($"brick {r} crosses the {what} border");
            h = t.H;
        }

        private int Col(int i, int j) => j * _size + i;

        /// <summary>Index of the brick occupying local cell (i, j, k), or -1.</summary>
        public int BrickAt(int i, int j, int k)
        {
            if ((uint)i >= (uint)_size || (uint)j >= (uint)_size) return -1;
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
            if ((uint)i >= (uint)_size || (uint)j >= (uint)_size) return -1;
            int c = Col(i, j);
            int top = -1;
            for (int s = _colStart[c]; s < _colStart[c + 1]; s++) top = Math.Max(top, _k1[s]);
            return top;
        }
    }
}
