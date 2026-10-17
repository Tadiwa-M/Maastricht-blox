#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data.Json;

namespace Blox.Data
{
    public enum FeatureKind : byte { Building, Landmark, Poi, Street, Water, Park, Station, Stop, Unknown }

    /// <summary>One clickable/searchable feature (CONTRACT section 6).</summary>
    public sealed class Feature
    {
        public uint Id { get; set; }
        public FeatureKind Kind { get; set; }
        public string KindRaw { get; set; } = "";
        public string Name { get; set; } = "";
        public string? BagId { get; set; }
        public string? OsmId { get; set; }
        public string? Address { get; set; }
        public int? Year { get; set; }
        public double? HeightM { get; set; }
        public int CentroidI { get; set; }
        public int CentroidJ { get; set; }
        /// <summary>[I0, J0, I1, J1] or null when absent.</summary>
        public int[]? BboxIJ { get; set; }
        public Dictionary<string, string> Tags { get; } = new Dictionary<string, string>(StringComparer.Ordinal);
    }

    /// <summary>features.json model with id lookup and a simple name/address search.</summary>
    public sealed class FeatureSet
    {
        private readonly Dictionary<uint, Feature> _byId = new Dictionary<uint, Feature>();
        public List<Feature> All { get; } = new List<Feature>();

        public Feature? Get(uint id) => _byId.TryGetValue(id, out var f) ? f : null;

        public static FeatureSet Parse(string json) => FromJson(JsonParser.Parse(json));

        public static FeatureSet FromJson(JsonNode n)
        {
            var set = new FeatureSet();
            foreach (var e in n["features"].Items)
            {
                uint id = e["id"].AsUInt;
                if (id == 0) throw new FormatException("feature id 0 is reserved");
                if (set._byId.ContainsKey(id)) throw new FormatException($"duplicate feature id {id}");
                string kind = e["kind"].AsString;
                var f = new Feature
                {
                    Id = id,
                    KindRaw = kind,
                    Kind = ParseKind(kind),
                    Name = e.OptString("name") ?? "",
                    BagId = e.OptString("bagId"),
                    OsmId = e.OptString("osmId"),
                    Address = e.OptString("address"),
                    Year = e.OptInt("year"),
                    HeightM = e.OptDouble("heightM"),
                };
                var c = e.Get("centroid");
                if (!c.IsNull) { f.CentroidI = c[0].AsInt; f.CentroidJ = c[1].AsInt; }
                var b = e.Get("bboxIJ");
                if (!b.IsNull)
                {
                    if (b.Count != 4) throw new FormatException($"feature {id}: bboxIJ needs 4 ints");
                    f.BboxIJ = new[] { b[0].AsInt, b[1].AsInt, b[2].AsInt, b[3].AsInt };
                }
                var tags = e.Get("tags");
                if (!tags.IsNull)
                    foreach (var k in tags.Keys)
                    {
                        var v = tags[k];
                        f.Tags[k] = v.Kind == JsonKind.String ? v.AsString : v.ToString();
                    }
                set._byId[id] = f;
                set.All.Add(f);
            }
            return set;
        }

        public static FeatureKind ParseKind(string s) => s switch
        {
            "building" => FeatureKind.Building,
            "landmark" => FeatureKind.Landmark,
            "poi" => FeatureKind.Poi,
            "street" => FeatureKind.Street,
            "water" => FeatureKind.Water,
            "park" => FeatureKind.Park,
            "station" => FeatureKind.Station,
            "stop" => FeatureKind.Stop,
            _ => FeatureKind.Unknown, // forward compatible: unknown kinds are kept, not fatal
        };

        /// <summary>Case-insensitive substring search over name and address; name-prefix hits first.</summary>
        public List<Feature> Search(string query, int max = 20)
        {
            var hits = new List<(int rank, Feature f)>();
            if (string.IsNullOrWhiteSpace(query)) return new List<Feature>();
            string q = query.Trim();
            foreach (var f in All)
            {
                int rank;
                if (f.Name.StartsWith(q, StringComparison.OrdinalIgnoreCase)) rank = 0;
                else if (f.Name.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) rank = 1;
                else if (f.Address != null && f.Address.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0) rank = 2;
                else continue;
                hits.Add((rank, f));
            }
            hits.Sort((a, b) => a.rank != b.rank ? a.rank.CompareTo(b.rank) : string.CompareOrdinal(a.f.Name, b.f.Name));
            var result = new List<Feature>();
            for (int i = 0; i < hits.Count && i < max; i++) result.Add(hits[i].f);
            return result;
        }
    }
}
