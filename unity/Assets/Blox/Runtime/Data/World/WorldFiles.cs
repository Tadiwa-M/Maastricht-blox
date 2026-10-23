#nullable enable
using System;
using System.IO;
using System.Security.Cryptography;

namespace Blox.Data
{
    /// <summary>
    /// Opens a world output directory (CONTRACT section 5: manifest.json, palette.json,
    /// brick_catalogue.json, features.json, chunks/, and since v3 islands/). Uses System.IO only, so it works in the
    /// editor and standalone players (e.g. StreamingAssets on desktop).
    /// </summary>
    public static class WorldFiles
    {
        public static Manifest ReadManifest(string worldDir) =>
            Manifest.Parse(File.ReadAllText(Path.Combine(worldDir, "manifest.json")));

        /// <param name="verifySha1">Check each chunk file against the manifest's sha1 on load.</param>
        public static WorldIndex Open(string worldDir, bool verifySha1 = false)
        {
            var manifest = ReadManifest(worldDir);
            var spec = WorldSpec.FromManifest(manifest);
            var palette = Palette.Parse(File.ReadAllText(Path.Combine(worldDir, manifest.PaletteFile)));
            var catalogue = Catalogue.Parse(File.ReadAllText(Path.Combine(worldDir, manifest.CatalogueFile)));
            string featuresPath = Path.Combine(worldDir, manifest.FeaturesFile);
            var features = File.Exists(featuresPath) ? FeatureSet.Parse(File.ReadAllText(featuresPath)) : new FeatureSet();
            var table = catalogue.ToTable();
            var byCoord = new System.Collections.Generic.Dictionary<ChunkCoord, ManifestChunk>();
            foreach (var c in manifest.Chunks) byCoord[c.Coord] = c;

            ChunkData? Loader(ChunkCoord cc)
            {
                if (!byCoord.TryGetValue(cc, out var entry)) return null;
                byte[] bytes = File.ReadAllBytes(Path.Combine(worldDir, entry.File));
                if (verifySha1 && entry.Sha1 != null)
                {
                    string got = Sha1Hex(bytes);
                    if (!string.Equals(got, entry.Sha1, StringComparison.OrdinalIgnoreCase))
                        throw new ChunkFormatException($"sha1 mismatch for {entry.File}: {got} != {entry.Sha1}");
                }
                var data = ChunkReader.Read(bytes, table, cc);
                if (data.Count != entry.Bricks)
                    throw new ChunkFormatException($"{entry.File}: {data.Count} bricks, manifest says {entry.Bricks}");
                return data;
            }

            IslandData? IslandLoader(ManifestIsland entry)
            {
                byte[] bytes = File.ReadAllBytes(Path.Combine(worldDir, entry.File));
                if (verifySha1 && entry.Sha1 != null)
                {
                    string got = Sha1Hex(bytes);
                    if (!string.Equals(got, entry.Sha1, StringComparison.OrdinalIgnoreCase))
                        throw new ChunkFormatException($"sha1 mismatch for {entry.File}: {got} != {entry.Sha1}");
                }
                var data = IslandReader.Read(bytes, table, entry.Id);
                if (data.Count != entry.Bricks)
                    throw new ChunkFormatException($"{entry.File}: {data.Count} bricks, manifest says {entry.Bricks}");
                return data;
            }

            return new WorldIndex(spec, palette, catalogue, features, manifest.Chunks, Loader, manifest.Islands, IslandLoader);
        }

        public static string Sha1Hex(byte[] data)
        {
            using var sha = SHA1.Create();
            byte[] h = sha.ComputeHash(data);
            var sb = new System.Text.StringBuilder(h.Length * 2);
            foreach (byte b in h) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }
    }
}
