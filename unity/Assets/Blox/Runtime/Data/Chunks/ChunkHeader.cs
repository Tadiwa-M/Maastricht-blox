#nullable enable
using System;
using System.Buffers.Binary;

namespace Blox.Data
{
    /// <summary>32-byte .bxc header (CONTRACT section 4), little-endian.</summary>
    public struct ChunkHeader
    {
        public const int Size = 32;
        public const int RecordSize = 12;
        public const ushort CurrentVersion = 1;
        public const ushort FlagDeflate = 0x0001;
        public static readonly byte[] Magic = { (byte)'B', (byte)'X', (byte)'C', (byte)'1' };

        public ushort Version;
        public ushort Flags;
        public int Cx;
        public int Cy;
        public uint BrickCount;
        public ushort MinK;
        public ushort MaxK;
        public uint BodyBytes;
        public uint Reserved;

        public bool Compressed => (Flags & FlagDeflate) != 0;

        public static ChunkHeader Decode(ReadOnlySpan<byte> b)
        {
            if (b.Length < Size) throw new ChunkFormatException($"file is {b.Length} bytes, shorter than the {Size}-byte header");
            if (b[0] != Magic[0] || b[1] != Magic[1] || b[2] != Magic[2] || b[3] != Magic[3])
                throw new ChunkFormatException("bad magic (expected 'BXC1')");
            return new ChunkHeader
            {
                Version = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(4)),
                Flags = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(6)),
                Cx = BinaryPrimitives.ReadInt32LittleEndian(b.Slice(8)),
                Cy = BinaryPrimitives.ReadInt32LittleEndian(b.Slice(12)),
                BrickCount = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(16)),
                MinK = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(20)),
                MaxK = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(22)),
                BodyBytes = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(24)),
                Reserved = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(28)),
            };
        }

        public void Encode(Span<byte> b)
        {
            if (b.Length < Size) throw new ArgumentException("buffer too small for header");
            Magic.CopyTo(b);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(4), Version);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(6), Flags);
            BinaryPrimitives.WriteInt32LittleEndian(b.Slice(8), Cx);
            BinaryPrimitives.WriteInt32LittleEndian(b.Slice(12), Cy);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(16), BrickCount);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(20), MinK);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(22), MaxK);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(24), BodyBytes);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(28), Reserved);
        }
    }

    public sealed class ChunkFormatException : Exception
    {
        public ChunkFormatException(string message) : base(message) { }
    }
}
