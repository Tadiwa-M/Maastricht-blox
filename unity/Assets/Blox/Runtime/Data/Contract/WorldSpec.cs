#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>Integer global grid cell (CONTRACT section 1): I east, J north, K up.</summary>
    public readonly struct GridCell : IEquatable<GridCell>
    {
        public readonly int I, J, K;
        public GridCell(int i, int j, int k) { I = i; J = j; K = k; }
        public bool Equals(GridCell o) => I == o.I && J == o.J && K == o.K;
        public override bool Equals(object? obj) => obj is GridCell o && Equals(o);
        public override int GetHashCode() => (I * 73856093) ^ (J * 19349663) ^ (K * 83492791);
        public override string ToString() => $"({I}, {J}, {K})";
    }

    /// <summary>Chunk coordinate (cx, cy).</summary>
    public readonly struct ChunkCoord : IEquatable<ChunkCoord>
    {
        public readonly int X, Y;
        public ChunkCoord(int x, int y) { X = x; Y = y; }
        public bool Equals(ChunkCoord o) => X == o.X && Y == o.Y;
        public override bool Equals(object? obj) => obj is ChunkCoord o && Equals(o);
        public override int GetHashCode() => (X * 397) ^ Y;
        public override string ToString() => $"c_{X:00}_{Y:00}";
        /// <summary>Chunk file name relative to the world directory (CONTRACT section 4).</summary>
        public string FileName => $"chunks/c_{X:00}_{Y:00}.bxc";
    }

    /// <summary>
    /// World constants and coordinate conversions (CONTRACT section 1). <see cref="Contract"/>
    /// holds the contract values; <see cref="FromManifest"/> reads them from a manifest and checks
    /// that the grid-defining values agree with the contract.
    /// </summary>
    public sealed class WorldSpec
    {
        /// <summary>Contract version this code implements (CONTRACT.md title).</summary>
        public const int ContractVersion = 2;
        /// <summary>Oldest manifest contractVersion still readable: v2 only added things (detail pieces, hide_studs, models).</summary>
        public const int MinContractVersion = 1;

        public double OriginRdX { get; }
        public double OriginRdY { get; }
        public double BaseNapM { get; }
        public double StudM { get; }
        public double PlateM { get; }
        public int ChunkStuds { get; }
        public int ChunksX { get; }
        public int ChunksY { get; }

        public int StudsX => ChunkStuds * ChunksX;
        public int StudsY => ChunkStuds * ChunksY;

        public static readonly WorldSpec Contract = new WorldSpec(175700, 316500, 30.0, 0.5, 0.2, 64, 64, 64);

        public WorldSpec(double originRdX, double originRdY, double baseNapM, double studM, double plateM,
                         int chunkStuds, int chunksX, int chunksY)
        {
            if (studM <= 0 || plateM <= 0 || chunkStuds <= 0 || chunksX <= 0 || chunksY <= 0)
                throw new ArgumentException("world dimensions must be positive");
            OriginRdX = originRdX; OriginRdY = originRdY; BaseNapM = baseNapM;
            StudM = studM; PlateM = plateM; ChunkStuds = chunkStuds; ChunksX = chunksX; ChunksY = chunksY;
        }

        public static WorldSpec FromManifest(Manifest m)
        {
            var s = new WorldSpec(m.OriginRdX, m.OriginRdY, m.BaseNapM, m.StudM, m.PlateM, m.ChunkStuds, m.ChunksX, m.ChunksY);
            // The binary chunk format hard-codes 64-stud chunks (uint8 local i/j < 64).
            if (s.ChunkStuds != Contract.ChunkStuds)
                throw new FormatException($"manifest chunkStuds {s.ChunkStuds} != contract {Contract.ChunkStuds}");
            return s;
        }

        // ---- RD / NAP -> grid ----------------------------------------------------------
        public int RdToI(double x) => (int)Math.Floor((x - OriginRdX) / StudM);
        public int RdToJ(double y) => (int)Math.Floor((y - OriginRdY) / StudM);
        public int NapToK(double zNap) => (int)Math.Floor((zNap - BaseNapM) / PlateM);
        public GridCell RdToCell(double x, double y, double zNap) => new GridCell(RdToI(x), RdToJ(y), NapToK(zNap));

        // ---- grid <-> Unity world metres (min corner of a cell) ------------------------
        public double CellToUnityX(double i) => i * StudM;
        public double CellToUnityZ(double j) => j * StudM;
        public double CellToUnityY(double k) => k * PlateM;
        public int UnityXToI(double x) => (int)Math.Floor(x / StudM);
        public int UnityZToJ(double z) => (int)Math.Floor(z / StudM);
        public int UnityYToK(double y) => (int)Math.Floor(y / PlateM);

        /// <summary>Unity world position (metres) of an RD/NAP point.</summary>
        public void RdToUnity(double x, double y, double zNap, out double ux, out double uy, out double uz)
        {
            ux = x - OriginRdX;
            uz = y - OriginRdY;
            uy = zNap - BaseNapM;
        }

        // ---- chunks --------------------------------------------------------------------
        public static int FloorDiv(int a, int b) => a >= 0 ? a / b : -((-a + b - 1) / b);
        public static int FloorMod(int a, int b) { int m = a % b; return m < 0 ? m + b : m; }

        public ChunkCoord ChunkOf(int i, int j) => new ChunkCoord(FloorDiv(i, ChunkStuds), FloorDiv(j, ChunkStuds));
        public bool ChunkInRange(ChunkCoord c) => c.X >= 0 && c.Y >= 0 && c.X < ChunksX && c.Y < ChunksY;
        public bool CellInSlice(int i, int j) => i >= 0 && j >= 0 && i < StudsX && j < StudsY;

        /// <summary>Unity metres of a chunk's south-west corner on the ground plane (y = 0).</summary>
        public double ChunkOriginX(ChunkCoord c) => c.X * ChunkStuds * StudM;
        public double ChunkOriginZ(ChunkCoord c) => c.Y * ChunkStuds * StudM;
    }
}
