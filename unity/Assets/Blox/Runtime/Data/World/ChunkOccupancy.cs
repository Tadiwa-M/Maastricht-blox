#nullable enable
namespace Blox.Data
{
    /// <summary>
    /// Occupancy of one loaded chunk: a 64 x 64 <see cref="ColumnOccupancy"/> plus the chunk it
    /// was built from. Answers "which brick is at local cell (i, j, k)" for picking, ground
    /// probes and neighbour queries.
    /// </summary>
    public sealed class ChunkOccupancy
    {
        public const int Size = 64;

        private readonly ColumnOccupancy _columns;

        public ChunkData Chunk { get; }

        public ChunkOccupancy(ChunkData chunk, BrickTypeInfo[] catalogue)
        {
            Chunk = chunk;
            _columns = new ColumnOccupancy(chunk.Records, catalogue, Size, "chunk");
        }

        /// <summary>Index of the brick occupying local cell (i, j, k), or -1.</summary>
        public int BrickAt(int i, int j, int k) => _columns.BrickAt(i, j, k);

        /// <summary>Exclusive top K of the highest brick in column (i, j), or -1 if empty.</summary>
        public int ColumnTop(int i, int j) => _columns.ColumnTop(i, j);

        public int SpanCount => _columns.SpanCount;
    }
}
