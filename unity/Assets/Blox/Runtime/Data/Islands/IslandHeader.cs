#nullable enable
using System;
using System.Buffers.Binary;

namespace Blox.Data
{
    /// <summary>
    /// 40-byte .bxi header (CONTRACT 5.1), little-endian:
    /// <code>
    ///  0 char[4] magic "BXI1"   4 u16 version   6 u16 flags (bit0 raw DEFLATE)   8 u32 islandId
    /// 12 i32 cx   16 i32 cy (owning chunk)   20 f32 originX   24 f32 originZ   28 f32 yawDeg
    /// 32 u32 brickCount   36 u32 bodyBytes
    /// </code>
    /// The body after it is the chunk record body (section 4), with i/j local to the island.
    /// </summary>
    public struct IslandHeader
    {
        public const int Size = 40;
        public const ushort CurrentVersion = 1;
        public const ushort FlagDeflate = 0x0001;
        public static readonly byte[] Magic = { (byte)'B', (byte)'X', (byte)'I', (byte)'1' };

        public ushort Version;
        public ushort Flags;
        public uint IslandId;
        public int Cx;
        public int Cy;
        public float OriginX;
        public float OriginZ;
        public float YawDeg;
        public uint BrickCount;
        public uint BodyBytes;

        public bool Compressed => (Flags & FlagDeflate) != 0;
        public ChunkCoord Owner => new ChunkCoord(Cx, Cy);
        public IslandPose Pose => new IslandPose(OriginX, OriginZ, YawDeg);

        public static IslandHeader Decode(ReadOnlySpan<byte> b)
        {
            if (b.Length < Size) throw new ChunkFormatException($"island file is {b.Length} bytes, shorter than the {Size}-byte header");
            if (b[0] != Magic[0] || b[1] != Magic[1] || b[2] != Magic[2] || b[3] != Magic[3])
                throw new ChunkFormatException("bad magic (expected 'BXI1')");
            return new IslandHeader
            {
                Version = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(4)),
                Flags = BinaryPrimitives.ReadUInt16LittleEndian(b.Slice(6)),
                IslandId = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(8)),
                Cx = BinaryPrimitives.ReadInt32LittleEndian(b.Slice(12)),
                Cy = BinaryPrimitives.ReadInt32LittleEndian(b.Slice(16)),
                OriginX = ReadFloat(b.Slice(20)),
                OriginZ = ReadFloat(b.Slice(24)),
                YawDeg = ReadFloat(b.Slice(28)),
                BrickCount = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(32)),
                BodyBytes = BinaryPrimitives.ReadUInt32LittleEndian(b.Slice(36)),
            };
        }

        public void Encode(Span<byte> b)
        {
            if (b.Length < Size) throw new ArgumentException("buffer too small for island header");
            Magic.CopyTo(b);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(4), Version);
            BinaryPrimitives.WriteUInt16LittleEndian(b.Slice(6), Flags);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(8), IslandId);
            BinaryPrimitives.WriteInt32LittleEndian(b.Slice(12), Cx);
            BinaryPrimitives.WriteInt32LittleEndian(b.Slice(16), Cy);
            WriteFloat(b.Slice(20), OriginX);
            WriteFloat(b.Slice(24), OriginZ);
            WriteFloat(b.Slice(28), YawDeg);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(32), BrickCount);
            BinaryPrimitives.WriteUInt32LittleEndian(b.Slice(36), BodyBytes);
        }

        // BinaryPrimitives.ReadSingleLittleEndian is .NET 5+, not in Unity's netstandard2.1 profile.
        private static float ReadFloat(ReadOnlySpan<byte> b) =>
            BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(b));

        private static void WriteFloat(Span<byte> b, float v) =>
            BinaryPrimitives.WriteInt32LittleEndian(b, BitConverter.SingleToInt32Bits(v));
    }
}
