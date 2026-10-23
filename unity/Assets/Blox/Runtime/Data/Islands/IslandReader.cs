#nullable enable
using System;
using System.IO;

namespace Blox.Data
{
    /// <summary>A decoded island: header (id, owning chunk, pose) plus records with LOCAL i/j.</summary>
    public sealed class IslandData
    {
        public IslandHeader Header;
        public BrickRecord[] Records = Array.Empty<BrickRecord>();
        public uint Id => Header.IslandId;
        public ChunkCoord Owner => Header.Owner;
        public IslandPose Pose => Header.Pose;
        public int Count => Records.Length;
    }

    /// <summary>
    /// Reads .bxi island files (CONTRACT 5.1). The body is the chunk body of section 4 (same
    /// 12-byte records, same raw DEFLATE), so the record decoding is shared with
    /// <see cref="ChunkReader"/>; only the header and the limits differ:
    /// i/j are local to the island (0..255, bricks may not cross the 256-stud edge), k is global,
    /// and |yawDeg| must be at most 45 (the contract says (-45, 45]).
    ///
    /// Structural checks always run; passing a catalogue table also checks type ids and the
    /// 256-stud edge. Unlike chunks, record order is not checked: section 5.1 does not repeat the
    /// (k, j, i) sort rule, and nothing here depends on it (<see cref="ColumnOccupancy"/> sorts).
    /// </summary>
    public static class IslandReader
    {
        public const int MaxStuds = 256;

        public static IslandData ReadFile(string path, BrickTypeInfo[]? catalogue = null, uint? expectedId = null) =>
            Read(File.ReadAllBytes(path), catalogue, expectedId);

        public static IslandData Read(byte[] file, BrickTypeInfo[]? catalogue = null, uint? expectedId = null)
        {
            var h = IslandHeader.Decode(file);
            ValidateHeader(h, file.Length, expectedId);
            byte[] body = ChunkReader.ExtractBody(file, IslandHeader.Size, (int)h.BodyBytes, (int)h.BrickCount, h.Compressed);
            var records = ChunkReader.DecodeRecords(body, (int)h.BrickCount);
            ValidateRecords(records, catalogue);
            return new IslandData { Header = h, Records = records };
        }

        private static void ValidateHeader(in IslandHeader h, int fileLength, uint? expectedId)
        {
            if (h.Version != IslandHeader.CurrentVersion) throw new ChunkFormatException($"unsupported island version {h.Version}");
            if ((h.Flags & ~IslandHeader.FlagDeflate) != 0) throw new ChunkFormatException($"unknown island header flags 0x{h.Flags:X4}");
            if (h.IslandId == 0) throw new ChunkFormatException("island id 0 is not allowed");
            if (expectedId.HasValue && expectedId.Value != h.IslandId)
                throw new ChunkFormatException($"island header says id {h.IslandId} but {expectedId.Value} was expected");
            if (h.Cx < 0 || h.Cy < 0) throw new ChunkFormatException($"negative owning chunk ({h.Cx}, {h.Cy})");
            if (!IsFinite(h.OriginX) || !IsFinite(h.OriginZ) || !IsFinite(h.YawDeg))
                throw new ChunkFormatException("island pose is not finite");
            if (h.YawDeg <= -IslandPose.MaxAbsYawDeg || h.YawDeg > IslandPose.MaxAbsYawDeg)
                throw new ChunkFormatException($"island yawDeg {h.YawDeg} outside (-45, 45]");
            long remaining = fileLength - IslandHeader.Size;
            if (h.BodyBytes != remaining)
                throw new ChunkFormatException($"island body is {remaining} bytes, header says {h.BodyBytes}");
            if (h.BrickCount > int.MaxValue / ChunkHeader.RecordSize) throw new ChunkFormatException("brickCount too large");
            if (!h.Compressed && h.BodyBytes != h.BrickCount * (long)ChunkHeader.RecordSize)
                throw new ChunkFormatException($"uncompressed island body holds {h.BodyBytes} bytes for {h.BrickCount} records");
        }

        // float.IsFinite is not in netstandard2.1.
        private static bool IsFinite(float f) => !float.IsNaN(f) && !float.IsInfinity(f);

        private static void ValidateRecords(BrickRecord[] recs, BrickTypeInfo[]? catalogue)
        {
            for (int n = 0; n < recs.Length; n++)
            {
                var r = recs[n];
                if ((r.rotFlags & BrickRecord.ReservedFlagMask) != 0) throw new ChunkFormatException($"island record {n}: reserved rotFlags bits set (0x{r.rotFlags:X2})");
                if (r.type == 0) throw new ChunkFormatException($"island record {n}: typeId 0 is reserved");
                if (r.color == 0) throw new ChunkFormatException($"island record {n}: colorIdx 0 (air)");
                if (catalogue == null) continue;
                var t = catalogue[r.type];
                if (t.Defined == 0) throw new ChunkFormatException($"island record {n}: unknown typeId {r.type}");
                Rotation.RotatedExtent(t, r.Rot, out int ei, out int ej);
                if (r.i + ei > MaxStuds || r.j + ej > MaxStuds) throw new ChunkFormatException($"island record {n}: brick crosses the 256-stud island edge");
            }
        }
    }

    /// <summary>
    /// Writes .bxi files (CONTRACT 5.1). The pipeline is the production writer; this exists for
    /// tests and round trips. Records are written in (k, j, i) order like chunks.
    /// </summary>
    public static class IslandWriter
    {
        public static byte[] Write(uint id, int cx, int cy, IslandPose pose, BrickRecord[] records, bool compress = true)
        {
            var sorted = (BrickRecord[])records.Clone();
            Array.Sort(sorted, (a, b) => ChunkReader.Compare(a, b));
            byte[] body = ChunkWriter.EncodeRecords(sorted);
            if (compress) body = ChunkWriter.Deflate(body);
            var h = new IslandHeader
            {
                Version = IslandHeader.CurrentVersion,
                Flags = compress ? IslandHeader.FlagDeflate : (ushort)0,
                IslandId = id,
                Cx = cx,
                Cy = cy,
                OriginX = (float)pose.OriginX,
                OriginZ = (float)pose.OriginZ,
                YawDeg = (float)pose.YawDeg,
                BrickCount = (uint)sorted.Length,
                BodyBytes = (uint)body.Length,
            };
            var file = new byte[IslandHeader.Size + body.Length];
            h.Encode(file);
            Buffer.BlockCopy(body, 0, file, IslandHeader.Size, body.Length);
            return file;
        }
    }
}
