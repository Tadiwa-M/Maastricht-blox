using System;
using System.IO;
using System.IO.Compression;
using Blox.Data;
using Blox.Data.Json;
using Xunit;

namespace Blox.Tests
{
    public class ChunkIoTests
    {
        /// <summary>Builds a chunk byte-for-byte from the CONTRACT section 4 layout, independent of ChunkWriter.</summary>
        private static byte[] HandBuilt(bool compress, out byte[] body)
        {
            body = new byte[]
            {
                // i, j, k(lo, hi), type, color, rotFlags, reserved, featureId (LE)
                3, 4, 0x2C, 0x01, 7, 4, 0x01, 0, 0x11, 0x00, 0x00, 0x00,   // brick_2x2 at k=300, rot 1, feature 17
                0, 0, 0x2D, 0x01, 24, 22, 0x06, 0, 0xFF, 0xFF, 0xFF, 0xFF,  // tile_1x1 at k=301, rot 2 + no_variation
            };
            byte[] stored = body;
            if (compress)
            {
                using var ms = new MemoryStream();
                using (var d = new DeflateStream(ms, CompressionLevel.Optimal, true)) d.Write(body, 0, body.Length);
                stored = ms.ToArray();
            }
            var file = new byte[32 + stored.Length];
            "BXC1"u8.CopyTo(file);
            file[4] = 1; file[5] = 0;                     // version
            file[6] = (byte)(compress ? 1 : 0); file[7] = 0;
            BitConverter.TryWriteBytes(file.AsSpan(8), 5);    // cx
            BitConverter.TryWriteBytes(file.AsSpan(12), 9);   // cy
            BitConverter.TryWriteBytes(file.AsSpan(16), 2u);  // brickCount
            BitConverter.TryWriteBytes(file.AsSpan(20), (ushort)300);  // minK
            BitConverter.TryWriteBytes(file.AsSpan(22), (ushort)303);  // maxK = 300 + 3
            BitConverter.TryWriteBytes(file.AsSpan(24), (uint)stored.Length);
            stored.CopyTo(file, 32);
            return file;
        }

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void ReadsHandBuiltChunk(bool compress)
        {
            var data = ChunkReader.Read(HandBuilt(compress, out _), Repo.Types, new ChunkCoord(5, 9));
            Assert.Equal(compress, data.Header.Compressed);
            Assert.Equal(2, data.Count);
            var a = data.Records[0];
            Assert.Equal((3, 4, 300), (a.i, a.j, (int)a.k));
            Assert.Equal(7, a.type);
            Assert.Equal(1, a.Rot);
            Assert.False(a.NoVariation);
            Assert.Equal(17u, a.featureId);
            var b = data.Records[1];
            Assert.Equal(2, b.Rot);
            Assert.True(b.NoVariation);
            Assert.Equal(uint.MaxValue, b.featureId);
            Assert.Equal(5 * 64 + 3, data.GlobalI(0));
            Assert.Equal(9 * 64 + 4, data.GlobalJ(0));
        }

        [Fact]
        public void WriterMatchesHandBuiltBytesUncompressed()
        {
            var hand = HandBuilt(false, out _);
            var recs = ChunkReader.Read(hand).Records;
            Array.Reverse(recs); // writer must sort
            var written = ChunkWriter.Write(5, 9, recs, Repo.Types, compress: false);
            Assert.Equal(hand, written);
        }

        [Fact]
        public void RoundTripsCompressedThroughWriter()
        {
            var recs = new[]
            {
                new BrickRecord(63, 63, 65532, Repo.TypeId("slope33_2x3"), 12, 0, false, 2), // ends exactly at 63/63? 2x3 at rot 0 -> crosses
            };
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(ChunkWriter.Write(0, 0, recs, Repo.Types), Repo.Types));
            recs[0] = new BrickRecord(62, 61, 65532, Repo.TypeId("slope33_2x3"), 12, 0, false, 2);
            var back = ChunkReader.Read(ChunkWriter.Write(1, 2, recs, Repo.Types), Repo.Types);
            Assert.Equal(recs, back.Records);
            Assert.Equal(65535, back.Header.MaxK);
            Assert.Equal(65532, back.Header.MinK);
        }

        [Fact]
        public void EmptyChunkRoundTrips()
        {
            var back = ChunkReader.Read(ChunkWriter.Write(3, 4, Array.Empty<BrickRecord>(), Repo.Types), Repo.Types);
            Assert.Equal(0, back.Count);
            Assert.Equal(new ChunkCoord(3, 4), back.Coord);
        }

        [Fact]
        public void RejectsCorruptFiles()
        {
            var good = HandBuilt(true, out _);
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(good.AsSpan(0, 20).ToArray()));            // short header
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(good, 0, (byte)'X')));             // magic
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(good, 4, 2)));                     // version
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(good, 6, 3)));                     // unknown flag
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(good, 28, 1)));                    // reserved
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(good.AsSpan(0, good.Length - 1).ToArray())); // bodyBytes mismatch
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(good, 16, 3)));                    // brickCount vs inflated size
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(good, Repo.Types, new ChunkCoord(5, 8))); // wrong coordinate
            var garbage = HandBuilt(true, out _);
            for (int n = 32; n < garbage.Length; n++) garbage[n] = 0xFF;
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(garbage));                                // corrupt DEFLATE
        }

        [Fact]
        public void RejectsBadRecords()
        {
            var plain = HandBuilt(false, out _);
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 0, 64)));    // i out of range
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 6, 0x11)));  // reserved rotFlags bit (bit 4; bit 3 is hide_studs since v2)
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 7, 1)));     // reserved byte
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 4, 0)));     // type 0
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 5, 0)));     // colour 0
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 2, 0x2E)));  // unsorted (k 302 > 301)
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 4, 200), Repo.Types)); // unknown type
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 22, 99), Repo.Types));      // maxK mismatch
            Assert.Throws<ChunkFormatException>(() => ChunkReader.Read(Mutate(plain, 32 + 0, 63), Repo.Types));  // 2x2 at i=63 crosses
        }

        private static byte[] Mutate(byte[] src, int at, byte value)
        {
            var copy = (byte[])src.Clone();
            copy[at] = value;
            return copy;
        }

        /// <summary>Reads the pipeline's golden files (if generated) and compares with golden.json.</summary>
        [SkippableFact]
        public void ReadsPipelineGoldenFixture()
        {
            string dir = Repo.PathOf("pipeline", "tests", "fixtures", "golden");
            string jsonPath = Path.Combine(dir, "golden.json");
            Skip.IfNot(File.Exists(jsonPath), "golden fixture absent (run `uv run python -m blox_pipeline.io.make_golden` in pipeline/)");
            var golden = JsonParser.Parse(File.ReadAllText(jsonPath));
            var files = golden["files"];
            Assert.NotEmpty(files.Keys);
            foreach (var name in files.Keys)
            {
                var expect = files[name];
                byte[] bytes = File.ReadAllBytes(Path.Combine(dir, name));
                Assert.Equal(expect["size"].AsInt, bytes.Length);
                Assert.Equal(expect["sha1"].AsString, WorldFiles.Sha1Hex(bytes));
                Assert.Equal(expect["headerHex"].AsString, Convert.ToHexString(bytes, 0, 32).ToLowerInvariant());
                var data = ChunkReader.Read(bytes, Repo.Types);
                var h = expect["header"];
                Assert.Equal(h["flags"].AsInt, data.Header.Flags);
                Assert.Equal(h["cx"].AsInt, data.Header.Cx);
                Assert.Equal(h["cy"].AsInt, data.Header.Cy);
                Assert.Equal(h["minK"].AsInt, data.Header.MinK);
                Assert.Equal(h["maxK"].AsInt, data.Header.MaxK);
                Assert.Equal(h["bodyBytes"].AsInt, (int)data.Header.BodyBytes);
                var recs = golden["records"].Items;
                Assert.Equal(recs.Count, data.Count);
                for (int n = 0; n < recs.Count; n++)
                {
                    var e = recs[n];
                    var r = data.Records[n];
                    Assert.Equal(e["i"].AsInt, r.i);
                    Assert.Equal(e["j"].AsInt, r.j);
                    Assert.Equal(e["k"].AsInt, r.k);
                    Assert.Equal(e["typeId"].AsInt, r.type);
                    Assert.Equal(e["typeName"].AsString, Repo.Catalogue[r.type]!.Name);
                    Assert.Equal(e["colorIdx"].AsInt, r.color);
                    Assert.Equal(e["rot"].AsInt, r.Rot);
                    Assert.Equal(e["noVariation"].AsBool, r.NoVariation);
                    Assert.Equal(e["rotFlags"].AsInt, r.rotFlags);
                    Assert.Equal(e["featureId"].AsUInt, r.featureId);
                    Assert.Equal(e["I"].AsInt, data.GlobalI(n));
                    Assert.Equal(e["J"].AsInt, data.GlobalJ(n));
                }
                // Our writer reproduces the uncompressed golden body byte for byte.
                Assert.Equal(golden["bodyHex"].AsString, Convert.ToHexString(ChunkWriter.EncodeRecords(data.Records)).ToLowerInvariant());
                if (!data.Header.Compressed)
                    Assert.Equal(bytes, ChunkWriter.Write(data.Header.Cx, data.Header.Cy, data.Records, Repo.Types, compress: false));
            }
        }
    }
}
