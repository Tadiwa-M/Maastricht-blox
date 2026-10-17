#nullable enable
using System;
using System.Collections.Generic;

namespace Blox.Data
{
    /// <summary>A brick found by a world query.</summary>
    public readonly struct BrickHit
    {
        public readonly ChunkCoord Chunk;
        public readonly int Index;          // record index within the chunk
        public readonly BrickRecord Record;
        public readonly int I, J, K;        // global min corner of the brick's rotated box

        public BrickHit(ChunkCoord chunk, int index, BrickRecord record, int i, int j, int k)
        {
            Chunk = chunk; Index = index; Record = record; I = i; J = j; K = k;
        }
    }

    /// <summary>
    /// The loaded world: spec, palette, catalogue, features and the chunks currently in
    /// memory, with global-cell queries. Chunk loading is delegated to a loader function so
    /// the index works with files (<see cref="WorldFiles"/>), tests and streaming alike.
    /// Not thread-safe: load/unload from one thread; read-only queries may run concurrently
    /// with each other.
    /// </summary>
    public sealed class WorldIndex
    {
        private readonly Dictionary<ChunkCoord, ChunkOccupancy> _loaded = new Dictionary<ChunkCoord, ChunkOccupancy>();
        private readonly Dictionary<ChunkCoord, ManifestChunk> _available = new Dictionary<ChunkCoord, ManifestChunk>();
        private readonly Func<ChunkCoord, ChunkData?> _loader;

        public WorldSpec Spec { get; }
        public Palette Palette { get; }
        public Catalogue Catalogue { get; }
        public FeatureSet Features { get; }
        public BrickTypeInfo[] TypeTable { get; }
        public PaletteColor[] ColorTable { get; }

        public WorldIndex(WorldSpec spec, Palette palette, Catalogue catalogue, FeatureSet features,
                          IEnumerable<ManifestChunk> available, Func<ChunkCoord, ChunkData?> loader)
        {
            Spec = spec; Palette = palette; Catalogue = catalogue; Features = features;
            _loader = loader ?? throw new ArgumentNullException(nameof(loader));
            TypeTable = catalogue.ToTable();
            ColorTable = palette.ToTable();
            foreach (var c in available) _available[c.Coord] = c;
        }

        /// <summary>Chunks listed in the manifest (only non-empty chunks are written).</summary>
        public IEnumerable<ManifestChunk> AvailableChunks => _available.Values;
        public bool Exists(ChunkCoord c) => _available.ContainsKey(c);
        public bool IsLoaded(ChunkCoord c) => _loaded.ContainsKey(c);
        public IEnumerable<ChunkCoord> LoadedChunks => _loaded.Keys;

        /// <summary>Loads a chunk if it exists and is not loaded yet. Returns null for empty chunks.</summary>
        public ChunkData? Load(ChunkCoord c)
        {
            if (_loaded.TryGetValue(c, out var occ)) return occ.Chunk;
            if (!_available.ContainsKey(c)) return null;
            var data = _loader(c);
            if (data == null) return null;
            if (data.Coord.X != c.X || data.Coord.Y != c.Y) throw new ChunkFormatException($"loader returned {data.Coord} for {c}");
            _loaded[c] = new ChunkOccupancy(data, TypeTable);
            return data;
        }

        /// <summary>Adds an already-decoded chunk (tests, generated content).</summary>
        public void Add(ChunkData data)
        {
            _available[data.Coord] = _available.TryGetValue(data.Coord, out var m) ? m
                : new ManifestChunk { Cx = data.Coord.X, Cy = data.Coord.Y, File = data.Coord.FileName, Bricks = data.Count };
            _loaded[data.Coord] = new ChunkOccupancy(data, TypeTable);
        }

        public bool Unload(ChunkCoord c) => _loaded.Remove(c);

        public ChunkData? GetLoaded(ChunkCoord c) => _loaded.TryGetValue(c, out var o) ? o.Chunk : null;
        public ChunkOccupancy? GetOccupancy(ChunkCoord c) => _loaded.TryGetValue(c, out var o) ? o : null;

        /// <summary>Brick at global cell (I, J, K) among loaded chunks.</summary>
        public bool TryGetBrick(int i, int j, int k, out BrickHit hit)
        {
            hit = default;
            if (k < 0) return false;
            var cc = Spec.ChunkOf(i, j);
            if (!_loaded.TryGetValue(cc, out var occ)) return false;
            int li = i - cc.X * ChunkOccupancy.Size, lj = j - cc.Y * ChunkOccupancy.Size;
            int idx = occ.BrickAt(li, lj, k);
            if (idx < 0) return false;
            var r = occ.Chunk.Records[idx];
            hit = new BrickHit(cc, idx, r, cc.X * ChunkOccupancy.Size + r.i, cc.Y * ChunkOccupancy.Size + r.j, r.k);
            return true;
        }

        /// <summary>True when a loaded brick occupies global cell (I, J, K).</summary>
        public bool IsSolid(int i, int j, int k) => TryGetBrick(i, j, k, out _);

        /// <summary>Exclusive top K of the highest loaded brick at column (I, J), or -1.</summary>
        public int ColumnTop(int i, int j)
        {
            var cc = Spec.ChunkOf(i, j);
            return _loaded.TryGetValue(cc, out var occ)
                ? occ.ColumnTop(i - cc.X * ChunkOccupancy.Size, j - cc.Y * ChunkOccupancy.Size)
                : -1;
        }

        /// <summary>Feature of the brick at (I, J, K), or null.</summary>
        public Feature? FeatureAt(int i, int j, int k) =>
            TryGetBrick(i, j, k, out var hit) && hit.Record.featureId != 0 ? Features.Get(hit.Record.featureId) : null;
    }
}
