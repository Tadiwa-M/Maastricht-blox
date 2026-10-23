using System;

namespace Blox.Rendering
{
    /// <summary>
    /// Layout of the global <c>_BloxStudTops</c> buffer read by the brick shaders
    /// (BloxGlobals.hlsl, BloxStudTopAt): for every world column (I, J) the plate level K of
    /// the highest exposed stud, 0 = none. 16 bits per column, two columns per uint (low half
    /// first), chunk-major so one chunk is one contiguous 2048-word range:
    /// <c>column = ((cy * 64 + cx) &lt;&lt; 12) | (lj &lt;&lt; 6) | li</c>.
    /// </summary>
    public static class StudTopsLayout
    {
        public const int WorldChunks = 64;
        public const int ChunkStuds = 64;
        public const int ColumnsPerChunk = ChunkStuds * ChunkStuds;     // 4096
        public const int WordsPerChunk = ColumnsPerChunk / 2;           // 2048
        public const int TotalWords = WorldChunks * WorldChunks * WordsPerChunk;
        public const float StudM = 0.5f;
        public const float PlateM = 0.2f;

        public static bool ChunkInRange(int cx, int cy) => cx >= 0 && cy >= 0 && cx < WorldChunks && cy < WorldChunks;

        /// <summary>First word of a chunk's range in the buffer.</summary>
        public static int WordOffset(int cx, int cy)
        {
            if (!ChunkInRange(cx, cy)) throw new ArgumentOutOfRangeException(nameof(cx), $"chunk ({cx}, {cy}) outside 0..63");
            return (cy * WorldChunks + cx) * WordsPerChunk;
        }

        /// <summary>Global column index as the shader computes it (for tests and debugging).</summary>
        public static int ColumnIndex(int i, int j)
        {
            int cx = i >> 6, cy = j >> 6;
            return ((cy * WorldChunks + cx) << 12) | ((j & 63) << 6) | (i & 63);
        }

        /// <summary>
        /// Records one stud (absolute Unity metres of its base centre, as in
        /// Blox.Meshing StudInstance) into a chunk's 4096-entry column table. Studs outside the
        /// chunk are ignored; the highest level per column wins.
        /// </summary>
        public static void Accumulate(ushort[] columnTops, int cx, int cy, float x, float y, float z)
        {
            if (columnTops.Length != ColumnsPerChunk) throw new ArgumentException("column table must have 4096 entries", nameof(columnTops));
            int li = (int)Math.Floor(x / StudM) - cx * ChunkStuds;
            int lj = (int)Math.Floor(z / StudM) - cy * ChunkStuds;
            if (li < 0 || lj < 0 || li >= ChunkStuds || lj >= ChunkStuds) return;
            int k = (int)Math.Round(y / PlateM);
            if (k <= 0) return; // 0 is the "no stud" marker; a stud base is always above level 0
            if (k > ushort.MaxValue) k = ushort.MaxValue;
            int n = lj * ChunkStuds + li;
            if (k > columnTops[n]) columnTops[n] = (ushort)k;
        }

        /// <summary>Packs a chunk's column table into its 2048 buffer words.</summary>
        public static void Pack(ushort[] columnTops, uint[] words)
        {
            if (columnTops.Length != ColumnsPerChunk) throw new ArgumentException("column table must have 4096 entries", nameof(columnTops));
            if (words.Length != WordsPerChunk) throw new ArgumentException("word table must have 2048 entries", nameof(words));
            for (int w = 0; w < WordsPerChunk; w++)
                words[w] = columnTops[2 * w] | ((uint)columnTops[2 * w + 1] << 16);
        }

        /// <summary>Decodes one column from a packed word range (mirror of the HLSL lookup).</summary>
        public static int Decode(uint[] chunkWords, int li, int lj)
        {
            int n = (lj << 6) | li;
            uint word = chunkWords[n >> 1];
            return (int)((n & 1) != 0 ? word >> 16 : word & 0xFFFFu);
        }
    }
}
