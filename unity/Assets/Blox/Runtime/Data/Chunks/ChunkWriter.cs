#nullable enable
using System;
using System.Buffers.Binary;
using System.IO;
using System.IO.Compression;

namespace Blox.Data
{
    /// <summary>
    /// Writes .bxc chunk files (CONTRACT section 4). The pipeline is the production writer;
    /// this exists for tests, tooling and round trips. Records are sorted by (k, j, i) and
    /// minK/maxK are computed from the catalogue heights (maxK clamped to 65535).
    /// </summary>
    public static class ChunkWriter
    {
        public static byte[] Write(int cx, int cy, BrickRecord[] records, BrickTypeInfo[] catalogue, bool compress = true)
        {
            var sorted = (BrickRecord[])records.Clone();
            Array.Sort(sorted, (a, b) => ChunkReader.Compare(a, b));
            byte[] body = EncodeRecords(sorted);
            if (compress) body = Deflate(body);

            int minK = 0, maxK = 0;
            if (sorted.Length > 0)
            {
                minK = int.MaxValue; maxK = int.MinValue;
                foreach (var r in sorted)
                {
                    var t = catalogue[r.type];
                    if (t.Defined == 0) throw new ArgumentException($"unknown typeId {r.type}");
                    minK = Math.Min(minK, r.k);
                    maxK = Math.Max(maxK, Math.Min(r.k + t.H, ushort.MaxValue));
                }
            }
            var header = new ChunkHeader
            {
                Version = ChunkHeader.CurrentVersion,
                Flags = compress ? ChunkHeader.FlagDeflate : (ushort)0,
                Cx = cx,
                Cy = cy,
                BrickCount = (uint)sorted.Length,
                MinK = (ushort)minK,
                MaxK = (ushort)maxK,
                BodyBytes = (uint)body.Length,
            };
            var file = new byte[ChunkHeader.Size + body.Length];
            header.Encode(file);
            Buffer.BlockCopy(body, 0, file, ChunkHeader.Size, body.Length);
            return file;
        }

        public static byte[] EncodeRecords(BrickRecord[] records)
        {
            var body = new byte[records.Length * ChunkHeader.RecordSize];
            var span = body.AsSpan();
            for (int n = 0; n < records.Length; n++)
            {
                var r = records[n];
                var s = span.Slice(n * ChunkHeader.RecordSize, ChunkHeader.RecordSize);
                s[0] = r.i;
                s[1] = r.j;
                BinaryPrimitives.WriteUInt16LittleEndian(s.Slice(2), r.k);
                s[4] = r.type;
                s[5] = r.color;
                s[6] = r.rotFlags;
                s[7] = 0;
                BinaryPrimitives.WriteUInt32LittleEndian(s.Slice(8), r.featureId);
            }
            return body;
        }

        /// <summary>Raw DEFLATE (RFC 1951, no zlib header).</summary>
        public static byte[] Deflate(byte[] data)
        {
            using var ms = new MemoryStream();
            using (var d = new DeflateStream(ms, CompressionLevel.Optimal, leaveOpen: true)) d.Write(data, 0, data.Length);
            return ms.ToArray();
        }
    }
}
