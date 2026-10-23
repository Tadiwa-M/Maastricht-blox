#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data.Json;

namespace Blox.Data
{
    /// <summary>One <c>chunks[]</c> entry of manifest.json (CONTRACT section 5).</summary>
    public sealed class ManifestChunk
    {
        public int Cx { get; set; }
        public int Cy { get; set; }
        public string File { get; set; } = "";
        public int Bricks { get; set; }
        public int MinK { get; set; }
        public int MaxK { get; set; }
        public string? Sha1 { get; set; }
        public ChunkCoord Coord => new ChunkCoord(Cx, Cy);
    }

    /// <summary>
    /// One <c>islands[]</c> entry of manifest.json (CONTRACT 5.1, v3): a building or terrace on
    /// its own rotated grid. <see cref="Cx"/>/<see cref="Cy"/> is the owning chunk (the one holding
    /// the island's centre); streaming and LOD follow that chunk.
    /// </summary>
    public sealed class ManifestIsland
    {
        public uint Id { get; set; }
        public string File { get; set; } = "";
        public int Cx { get; set; }
        public int Cy { get; set; }
        public int Bricks { get; set; }
        public string? Sha1 { get; set; }
        public ChunkCoord Owner => new ChunkCoord(Cx, Cy);
    }

    public sealed class ManifestSource
    {
        public string Name { get; set; } = "";
        public string? Version { get; set; }
        public string? Licence { get; set; }
    }

    /// <summary>manifest.json model (CONTRACT section 5).</summary>
    public sealed class Manifest
    {
        public int ContractVersion { get; set; }
        public string Crs { get; set; } = "";
        public double OriginRdX { get; set; }
        public double OriginRdY { get; set; }
        public double BaseNapM { get; set; }
        public double StudM { get; set; }
        public double PlateM { get; set; }
        public int ChunkStuds { get; set; }
        public int ChunksX { get; set; }
        public int ChunksY { get; set; }
        public string PaletteFile { get; set; } = "palette.json";
        public string CatalogueFile { get; set; } = "brick_catalogue.json";
        public string FeaturesFile { get; set; } = "features.json";
        public string? Generated { get; set; }
        public List<ManifestSource> Sources { get; } = new List<ManifestSource>();
        public List<ManifestChunk> Chunks { get; } = new List<ManifestChunk>();
        /// <summary>v3 islands; empty for v1/v2 manifests (the key is optional).</summary>
        public List<ManifestIsland> Islands { get; } = new List<ManifestIsland>();

        public static Manifest Parse(string json) => FromJson(JsonParser.Parse(json));

        public static Manifest FromJson(JsonNode n)
        {
            var m = new Manifest
            {
                ContractVersion = n["contractVersion"].AsInt,
            };
            if (m.ContractVersion < WorldSpec.MinContractVersion || m.ContractVersion > WorldSpec.ContractVersion)
                throw new FormatException($"manifest contractVersion {m.ContractVersion} is not supported (expected {WorldSpec.MinContractVersion}..{WorldSpec.ContractVersion})");
            m.Crs = n["crs"].AsString;
            var origin = n["originRD"];
            if (origin.Count != 2) throw new FormatException("originRD must have 2 numbers");
            m.OriginRdX = origin[0].AsDouble;
            m.OriginRdY = origin[1].AsDouble;
            m.BaseNapM = n["baseNapM"].AsDouble;
            m.StudM = n["studM"].AsDouble;
            m.PlateM = n["plateM"].AsDouble;
            m.ChunkStuds = n["chunkStuds"].AsInt;
            m.ChunksX = n["chunksX"].AsInt;
            m.ChunksY = n["chunksY"].AsInt;
            m.PaletteFile = n.OptString("palette") ?? m.PaletteFile;
            m.CatalogueFile = n.OptString("catalogue") ?? m.CatalogueFile;
            m.FeaturesFile = n.OptString("features") ?? m.FeaturesFile;
            m.Generated = n.OptString("generated");
            var sources = n.Get("sources");
            if (!sources.IsNull)
                foreach (var s in sources.Items)
                    m.Sources.Add(new ManifestSource { Name = s["name"].AsString, Version = s.OptString("version"), Licence = s.OptString("licence") });
            foreach (var c in n["chunks"].Items)
            {
                m.Chunks.Add(new ManifestChunk
                {
                    Cx = c["cx"].AsInt,
                    Cy = c["cy"].AsInt,
                    File = c["file"].AsString,
                    Bricks = c["bricks"].AsInt,
                    MinK = c["minK"].AsInt,
                    MaxK = c["maxK"].AsInt,
                    Sha1 = c.OptString("sha1"),
                });
            }
            var islands = n.Get("islands");
            if (!islands.IsNull)
                foreach (var c in islands.Items)
                {
                    long id = c["id"].AsLong;
                    if (id < 1 || id > uint.MaxValue) throw new FormatException($"island id {id} out of range");
                    m.Islands.Add(new ManifestIsland
                    {
                        Id = (uint)id,
                        File = c["file"].AsString,
                        Cx = c["cx"].AsInt,
                        Cy = c["cy"].AsInt,
                        Bricks = c["bricks"].AsInt,
                        Sha1 = c.OptString("sha1"),
                    });
                }
            return m;
        }
    }
}
