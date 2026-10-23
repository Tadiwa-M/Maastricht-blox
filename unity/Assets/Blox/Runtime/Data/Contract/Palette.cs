#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data.Json;

namespace Blox.Data
{
    /// <summary>
    /// Palette material classes (CONTRACT section 3). The numeric values are what the mesher
    /// writes into UV2.x and what the shader switches on; they are part of the Unity-side API.
    /// </summary>
    public enum MaterialClass : byte
    {
        Solid = 0,
        Trans = 1,
        Glass = 2,
        Emissive = 3,
        Metal = 4,
        None = 255,
    }

    public static class MaterialClassExt
    {
        public static MaterialClass Parse(string s) => s switch
        {
            "solid" => MaterialClass.Solid,
            "trans" => MaterialClass.Trans,
            "glass" => MaterialClass.Glass,
            "emissive" => MaterialClass.Emissive,
            "metal" => MaterialClass.Metal,
            "none" => MaterialClass.None,
            _ => throw new FormatException($"unknown palette material '{s}'"),
        };

        /// <summary>Opaque classes hide what is behind them; trans and glass do not.</summary>
        public static bool IsOpaque(this MaterialClass m) =>
            m == MaterialClass.Solid || m == MaterialClass.Emissive || m == MaterialClass.Metal;

        /// <summary>Faces of these classes go to the transparent submesh.</summary>
        public static bool IsTransparent(this MaterialClass m) => m == MaterialClass.Trans || m == MaterialClass.Glass;
    }

    /// <summary>Blittable per-index palette data for Burst jobs: linear RGB + class.</summary>
    public struct PaletteColor
    {
        public float R, G, B;        // linear (sRGB decoded)
        public MaterialClass Material;
        public byte Defined;         // 1 when the palette has this index
    }

    public sealed class PaletteEntry
    {
        public byte Index { get; set; }
        public string Name { get; set; } = "";
        public string? SrgbHex { get; set; }
        public MaterialClass Material { get; set; }
        public byte SrgbR { get; set; }
        public byte SrgbG { get; set; }
        public byte SrgbB { get; set; }
    }

    /// <summary>contract/palette.json model (CONTRACT section 3).</summary>
    public sealed class Palette
    {
        public const int MaxEntries = 64;

        private readonly PaletteEntry?[] _byIndex = new PaletteEntry?[256];
        public int Version { get; private set; }
        public List<PaletteEntry> Entries { get; } = new List<PaletteEntry>();

        public PaletteEntry? this[int idx] => idx >= 0 && idx < 256 ? _byIndex[idx] : null;

        public static Palette Parse(string json) => FromJson(JsonParser.Parse(json));

        public static Palette FromJson(JsonNode n)
        {
            var p = new Palette { Version = n.OptInt("version") ?? 1 };
            foreach (var e in n["entries"].Items)
            {
                int idx = e["idx"].AsInt;
                if (idx < 0 || idx >= MaxEntries) throw new FormatException($"palette idx {idx} outside 0..{MaxEntries - 1}");
                if (p._byIndex[idx] != null) throw new FormatException($"duplicate palette idx {idx}");
                var entry = new PaletteEntry
                {
                    Index = (byte)idx,
                    Name = e["name"].AsString,
                    SrgbHex = e.OptString("srgb"),
                    Material = MaterialClassExt.Parse(e["material"].AsString),
                };
                if (entry.SrgbHex != null)
                {
                    ColorSpace.ParseHex(entry.SrgbHex, out byte r, out byte g, out byte b);
                    entry.SrgbR = r; entry.SrgbG = g; entry.SrgbB = b;
                }
                else if (idx != 0)
                {
                    throw new FormatException($"palette idx {idx} has no srgb colour");
                }
                p._byIndex[idx] = entry;
                p.Entries.Add(entry);
            }
            return p;
        }

        /// <summary>256-entry table (indexed by colorIdx) for meshing jobs.</summary>
        public PaletteColor[] ToTable()
        {
            var t = new PaletteColor[256];
            for (int i = 0; i < 256; i++)
            {
                var e = _byIndex[i];
                if (e == null || i == 0) { t[i].Material = MaterialClass.None; continue; }
                t[i] = new PaletteColor
                {
                    R = ColorSpace.SrgbToLinear(e.SrgbR),
                    G = ColorSpace.SrgbToLinear(e.SrgbG),
                    B = ColorSpace.SrgbToLinear(e.SrgbB),
                    Material = e.Material,
                    Defined = 1,
                };
            }
            return t;
        }
    }
}
