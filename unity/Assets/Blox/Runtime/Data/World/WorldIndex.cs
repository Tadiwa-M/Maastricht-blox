#nullable enable
using System;
using System.Collections.Generic;

namespace Blox.Data
{
    /// <summary>
    /// A brick found by a world query. For chunk bricks (<see cref="IslandId"/> = 0) I/J are global
    /// cells; for island bricks (v3) <see cref="Chunk"/> is the owning chunk, <see cref="Index"/> the
    /// record index in the island and I/J are island-local cells (use the island's pose for world).
    /// </summary>
    public readonly struct BrickHit
    {
        public readonly ChunkCoord Chunk;
        public readonly int Index;          // record index within the chunk (or island)
        public readonly BrickRecord Record;
        public readonly int I, J, K;        // min corner of the brick's rotated box (global, or island-local i/j)
        public readonly uint IslandId;      // 0 = chunk brick

        public BrickHit(ChunkCoord chunk, int index, BrickRecord record, int i, int j, int k, uint islandId = 0)
        {
            Chunk = chunk; Index = index; Record = record; I = i; J = j; K = k; IslandId = islandId;
        }

        public bool IsIsland => IslandId != 0;
    }

    /// <summary>
    /// The loaded world: spec, palette, catalogue, features and the chunks currently in
    /// memory, with global-cell queries. Chunk loading is delegated to a loader function so
    /// the index works with files (<see cref="WorldFiles"/>), tests and streaming alike.
    /// <para>v3 islands (CONTRACT 5.1) are kept apart from the chunks: they have their own
    /// rotated grid, so the global-cell queries (<see cref="TryGetBrick"/>, <see cref="ColumnTop"/>)
    /// only see chunk bricks, and island bricks are reached through <see cref="GetIsland"/> /
    /// <see cref="LoadedIslands"/> (and <see cref="WorldRaycast"/>, which tests both).</para>
    /// Not thread-safe: load/unload from one thread; read-only queries may run concurrently
    /// with each other.
    /// </summary>
    public sealed class WorldIndex
    {
        private readonly Dictionary<ChunkCoord, ChunkOccupancy> _loaded = new Dictionary<ChunkCoord, ChunkOccupancy>();
        private readonly Dictionary<ChunkCoord, ManifestChunk> _available = new Dictionary<ChunkCoord, ManifestChunk>();
        private readonly Func<ChunkCoord, ChunkData?> _loader;
        private readonly Dictionary<uint, ManifestIsland> _islands = new Dictionary<uint, ManifestIsland>();
        private readonly Dictionary<ChunkCoord, List<uint>> _islandsByOwner = new Dictionary<ChunkCoord, List<uint>>();
        private readonly Dictionary<uint, IslandIndex> _loadedIslands = new Dictionary<uint, IslandIndex>();
        private readonly Func<ManifestIsland, IslandData?>? _islandLoader;
        private static readonly List<uint> NoIslands = new List<uint>();

        public WorldSpec Spec { get; }
        public Palette Palette { get; }
        public Catalogue Catalogue { get; }
        public FeatureSet Features { get; }
        public BrickTypeInfo[] TypeTable { get; }
        public PaletteColor[] ColorTable { get; }

        public WorldIndex(WorldSpec spec, Palette palette, Catalogue catalogue, FeatureSet features,
                          IEnumerable<ManifestChunk> available, Func<ChunkCoord, ChunkData?> loader,
                          IEnumerable<ManifestIsland>? islands = null, Func<ManifestIsland, IslandData?>? islandLoader = null)
        {
            Spec = spec; Palette = palette; Catalogue = catalogue; Features = features;
            _loader = loader ?? throw new ArgumentNullException(nameof(loader));
            _islandLoader = islandLoader;
            TypeTable = catalogue.ToTable();
            ColorTable = palette.ToTable();
            foreach (var c in available) _available[c.Coord] = c;
            if (islands != null)
                foreach (var isl in islands) RegisterIsland(isl);
        }

        private void RegisterIsland(ManifestIsland isl)
        {
            if (_islands.ContainsKey(isl.Id)) return;
            _islands[isl.Id] = isl;
            if (!_islandsByOwner.TryGetValue(isl.Owner, out var list)) _islandsByOwner[isl.Owner] = list = new List<uint>();
            list.Add(isl.Id);
        }

        // ---- islands (v3) ------------------------------------------------------------------

        /// <summary>Islands listed in the manifest.</summary>
        public IEnumerable<ManifestIsland> AvailableIslands => _islands.Values;
        public int IslandCount => _islands.Count;
        public bool IslandExists(uint id) => _islands.ContainsKey(id);
        public bool IsIslandLoaded(uint id) => _loadedIslands.ContainsKey(id);
        public IEnumerable<IslandIndex> LoadedIslands => _loadedIslands.Values;

        /// <summary>Ids of the islands owned by a chunk (streamed and LOD-ed with it). Do not modify.</summary>
        public IReadOnlyList<uint> IslandsOwnedBy(ChunkCoord c) => _islandsByOwner.TryGetValue(c, out var l) ? l : NoIslands;

        /// <summary>Loads an island if listed and not loaded yet. Returns null when unknown or no island loader.</summary>
        public IslandIndex? LoadIsland(uint id)
        {
            if (_loadedIslands.TryGetValue(id, out var idx)) return idx;
            if (_islandLoader == null || !_islands.TryGetValue(id, out var entry)) return null;
            var data = _islandLoader(entry);
            if (data == null) return null;
            if (data.Id != id) throw new ChunkFormatException($"island loader returned id {data.Id} for {id}");
            if (!data.Owner.Equals(entry.Owner))
                throw new ChunkFormatException($"island {id}: header owner {data.Owner} != manifest owner {entry.Owner}");
            idx = new IslandIndex(data, TypeTable);
            _loadedIslands[id] = idx;
            return idx;
        }

        /// <summary>Adds an already-decoded island (tests, generated content).</summary>
        public IslandIndex AddIsland(IslandData data)
        {
            RegisterIsland(new ManifestIsland { Id = data.Id, Cx = data.Owner.X, Cy = data.Owner.Y, File = $"islands/i_{data.Id:000000}.bxi", Bricks = data.Count });
            var idx = new IslandIndex(data, TypeTable);
            _loadedIslands[data.Id] = idx;
            return idx;
        }

        public bool UnloadIsland(uint id) => _loadedIslands.Remove(id);
        public IslandIndex? GetIsland(uint id) => _loadedIslands.TryGetValue(id, out var i) ? i : null;

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
