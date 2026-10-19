#nullable enable
using System;
using System.Buffers.Binary;
using System.IO;
using System.IO.Compression;

namespace Blox.Data
{
    /// <summary>A decoded chunk: header plus records in file order (sorted by k, j, i).</summary>
    public sealed class ChunkData
    {
        public ChunkHeader Header;
        public BrickRecord[] Records = Array.Empty<BrickRecord>();
        public ChunkCoord Coord => new ChunkCoord(Header.Cx, Header.Cy);
        public int Count => Records.Length;

        /// <summary>Global I of a record's min corner.</summary>
        public int GlobalI(int index) => Header.Cx * 64 + Records[index].i;
        public int GlobalJ(int index) => Header.Cy * 64 + Records[index].j;
    }

    /// <summary>
    /// Reads .bxc chunk files (CONTRACT section 4). Structural checks always run (magic,
    /// version, flags, sizes, local coordinates, reserved bits, sort order). Passing a
    /// catalogue table additionally checks type ids, chunk-border crossing and minK/maxK.
    /// Any violation throws <see cref="ChunkFormatException"/>.
    /// </summary>
    public static class ChunkReader
    {
        public const int ChunkStuds = 64;

        public static ChunkData ReadFile(string path, BrickTypeInfo[]? catalogue = null, ChunkCoord? expected = null) =>
            Read(File.ReadAllBytes(path), catalogue, expected);

        public static ChunkData Read(byte[] file, BrickTypeInfo[]? catalogue = null, ChunkCoord? expected = null)
        {
            var header = ChunkHeader.Decode(file);
            ValidateHeader(header, file.Length, expected);
            byte[] body = ExtractBody(file, header);
            var records = DecodeRecords(body, (int)header.BrickCount);
            ValidateRecords(header, records, catalogue);
            return new ChunkData { Header = header, Records = records };
        }

        private static void ValidateHeader(in ChunkHeader h, int fileLength, ChunkCoord? expected)
        {
            if (h.Version != ChunkHeader.CurrentVersion) throw new ChunkFormatException($"unsupported chunk version {h.Version}");
            if ((h.Flags & ~ChunkHeader.FlagDeflate) != 0) throw new ChunkFormatException($"unknown header flags 0x{h.Flags:X4}");
            if (h.Reserved != 0) throw new ChunkFormatException("header reserved field is not 0");
            if (h.Cx < 0 || h.Cy < 0) throw new ChunkFormatException($"negative chunk coordinate ({h.Cx}, {h.Cy})");
            if (expected.HasValue && (expected.Value.X != h.Cx || expected.Value.Y != h.Cy))
                throw new ChunkFormatException($"chunk header says ({h.Cx}, {h.Cy}) but {expected.Value} was expected");
            long remaining = fileLength - ChunkHeader.Size;
            if (h.BodyBytes != remaining)
                throw new ChunkFormatException($"body is {remaining} bytes, header says {h.BodyBytes}");
            if (h.BrickCount > int.MaxValue / ChunkHeader.RecordSize) throw new ChunkFormatException("brickCount too large");
            if (!h.Compressed && h.BodyBytes != h.BrickCount * (long)ChunkHeader.RecordSize)
                throw new ChunkFormatException($"uncompressed body holds {h.BodyBytes} bytes for {h.BrickCount} records");
        }

        private static byte[] ExtractBody(byte[] file, in ChunkHeader h)
        {
            int expectedBytes = (int)h.BrickCount * ChunkHeader.RecordSize;
            if (!h.Compressed)
            {
                var raw = new byte[expectedBytes];
                Buffer.BlockCopy(file, ChunkHeader.Size, raw, 0, expectedBytes);
                return raw;
            }
            var output = new byte[expectedBytes];
            using (var src = new MemoryStream(file, ChunkHeader.Size, (int)h.BodyBytes, writable: false))
            using (var inflate = new DeflateStream(src, CompressionMode.Decompress))
            {
                int got = 0;
                try
                {
                    while (got < expectedBytes)
                    {
                        int n = inflate.Read(output, got, expectedBytes - got);
                        if (n == 0) break;
                        got += n;
                    }
                    if (got != expectedBytes)
                        throw new ChunkFormatException($"DEFLATE body inflated to {got} bytes, expected {expectedBytes}");
                    var probe = new byte[1];
                    if (inflate.Read(probe, 0, 1) != 0)
                        throw new ChunkFormatException($"DEFLATE body inflates to more than {expectedBytes} bytes");
                }
                catch (InvalidDataException e)
                {
                    throw new ChunkFormatException("corrupt DEFLATE body: " + e.Message);
                }
            }
            return output;
        }

        /// <summary>Decodes little-endian 12-byte records (independent of host endianness).</summary>
        public static BrickRecord[] DecodeRecords(ReadOnlySpan<byte> body, int count)
        {
            if (body.Length != count * ChunkHeader.RecordSize)
                throw new ChunkFormatException($"body holds {body.Length} bytes for {count} records");
            var records = new BrickRecord[count];
            for (int n = 0; n < count; n++)
            {
                var r = body.Slice(n * ChunkHeader.RecordSize, ChunkHeader.RecordSize);
                if (r[7] != 0) throw new ChunkFormatException($"record {n}: reserved byte is {r[7]}");
                records[n] = new BrickRecord
                {
                    i = r[0],
                    j = r[1],
                    k = BinaryPrimitives.ReadUInt16LittleEndian(r.Slice(2)),
                    type = r[4],
                    color = r[5],
                    rotFlags = r[6],
                    featureId = BinaryPrimitives.ReadUInt32LittleEndian(r.Slice(8)),
                };
            }
            return records;
        }

        private static void ValidateRecords(in ChunkHeader h, BrickRecord[] recs, BrickTypeInfo[]? catalogue)
        {
            int minK = int.MaxValue, maxK = int.MinValue;
            for (int n = 0; n < recs.Length; n++)
            {
                var r = recs[n];
                if (r.i >= ChunkStuds || r.j >= ChunkStuds) throw new ChunkFormatException($"record {n}: local (i, j) = ({r.i}, {r.j}) outside 0..63");
                if ((r.rotFlags & BrickRecord.ReservedFlagMask) != 0) throw new ChunkFormatException($"record {n}: reserved rotFlags bits set (0x{r.rotFlags:X2})");
                if (r.type == 0) throw new ChunkFormatException($"record {n}: typeId 0 is reserved");
                if (r.color == 0) throw new ChunkFormatException($"record {n}: colorIdx 0 (air)");
                if (n > 0 && Compare(recs[n - 1], r) > 0) throw new ChunkFormatException($"record {n}: records are not sorted by (k, j, i)");
                if (catalogue != null)
                {
                    var t = catalogue[r.type];
                    if (t.Defined == 0) throw new ChunkFormatException($"record {n}: unknown typeId {r.type}");
                    Rotation.RotatedExtent(t, r.Rot, out int ei, out int ej);
                    if (r.i + ei > ChunkStuds || r.j + ej > ChunkStuds) throw new ChunkFormatException($"record {n}: brick crosses the chunk border");
                    minK = Math.Min(minK, r.k);
                    maxK = Math.Max(maxK, Math.Min(r.k + t.H, ushort.MaxValue));
                }
            }
            if (catalogue != null && recs.Length > 0 && (h.MinK != minK || h.MaxK != maxK))
                throw new ChunkFormatException($"header minK/maxK = {h.MinK}/{h.MaxK} but records give {minK}/{maxK}");
        }

        /// <summary>Ordering of the file: (k, j, i).</summary>
        public static int Compare(in BrickRecord a, in BrickRecord b)
        {
            if (a.k != b.k) return a.k.CompareTo(b.k);
            if (a.j != b.j) return a.j.CompareTo(b.j);
            return a.i.CompareTo(b.i);
        }
    }
}
