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

        public static Manifest Parse(string json) => FromJson(JsonParser.Parse(json));

        public static Manifest FromJson(JsonNode n)
        {
            var m = new Manifest
            {
                ContractVersion = n["contractVersion"].AsInt,
            };
            if (m.ContractVersion != WorldSpec.ContractVersion)
                throw new FormatException($"manifest contractVersion {m.ContractVersion} is not supported (expected {WorldSpec.ContractVersion})");
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
            return m;
        }
    }
}
