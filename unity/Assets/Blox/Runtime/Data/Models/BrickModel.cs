#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data.Json;

namespace Blox.Data
{
    /// <summary>An animated group of a model (e.g. "leg_l"); it rotates about its pivot's local i axis.</summary>
    public sealed class ModelPart
    {
        public string Name { get; set; } = "";
        /// <summary>Pivot in model-local cells (i, j in studs, k in plates; floats).</summary>
        public float PivotI { get; set; }
        public float PivotJ { get; set; }
        public float PivotK { get; set; }
    }

    /// <summary>One brick of a model: section 4 fields in model-local cells, plus an optional part.</summary>
    public struct ModelBrick
    {
        public int I, J, K;
        public byte Type, Color;
        public byte RotFlags;
        /// <summary>Index into <see cref="BrickModel.Parts"/>, or -1 for the static body.</summary>
        public int Part;

        public int Rot => RotFlags & BrickRecord.RotMask;
        public Facing Facing => Rotation.RotToFacing(RotFlags);
    }

    /// <summary>
    /// A brick model (CONTRACT section 7.1): a small assembly that moves as one object (bus,
    /// boat, character), read from <c>contract/models/&lt;name&gt;.json</c>. Models always face +j
    /// in their own cells; a <see cref="Pose"/> places and turns the whole thing in the world.
    ///
    /// Coordinates: bricks and pivots are in model-local cells (i along +x, j along +z in studs
    /// of 0.5 m, k up in plates of 0.2 m). <see cref="PivotI"/>/J/K is the model origin (ground
    /// centre) that ends up exactly at the pose position.
    /// </summary>
    public sealed class BrickModel
    {
        public string Name { get; set; } = "";
        public int Version { get; set; }
        public int SizeI { get; set; }
        public int SizeJ { get; set; }
        public int SizeK { get; set; }
        public float PivotI { get; set; }
        public float PivotJ { get; set; }
        public float PivotK { get; set; }
        public List<ModelPart> Parts { get; } = new List<ModelPart>();
        public List<ModelBrick> Bricks { get; } = new List<ModelBrick>();

        /// <summary>Index of a part by name, or -1.</summary>
        public int PartIndex(string name)
        {
            for (int n = 0; n < Parts.Count; n++) if (Parts[n].Name == name) return n;
            return -1;
        }

        public static BrickModel Parse(string json, Catalogue? catalogue = null) => FromJson(JsonParser.Parse(json), catalogue);

        /// <summary>Reads a model; with a catalogue it also checks types and that every brick fits in <c>size</c>.</summary>
        public static BrickModel FromJson(JsonNode n, Catalogue? catalogue = null)
        {
            var m = new BrickModel
            {
                Name = n["name"].AsString,
                Version = n.OptInt("version") ?? 1,
            };
            var size = n["size"];
            if (size.Count != 3) throw new FormatException($"model '{m.Name}': size must have 3 numbers");
            m.SizeI = size[0].AsInt; m.SizeJ = size[1].AsInt; m.SizeK = size[2].AsInt;
            if (m.SizeI < 1 || m.SizeJ < 1 || m.SizeK < 1) throw new FormatException($"model '{m.Name}': size must be positive");
            var pivot = n["pivot"];
            if (pivot.Count != 3) throw new FormatException($"model '{m.Name}': pivot must have 3 numbers");
            m.PivotI = pivot[0].AsFloat; m.PivotJ = pivot[1].AsFloat; m.PivotK = pivot[2].AsFloat;
            string forward = n.OptString("forward") ?? "+j";
            if (forward != "+j") throw new FormatException($"model '{m.Name}': forward must be \"+j\" (got \"{forward}\")");

            var parts = n.Get("parts");
            if (!parts.IsNull)
                foreach (string key in parts.Keys)
                {
                    var pv = parts[key]["pivot"];
                    if (pv.Count != 3) throw new FormatException($"model '{m.Name}': part '{key}' pivot must have 3 numbers");
                    m.Parts.Add(new ModelPart { Name = key, PivotI = pv[0].AsFloat, PivotJ = pv[1].AsFloat, PivotK = pv[2].AsFloat });
                }

            foreach (var b in n["bricks"].Items)
            {
                int rot = b.OptInt("rot") ?? 0;
                if (rot < 0 || rot > 3) throw new FormatException($"model '{m.Name}': rot {rot} outside 0..3");
                int type = b["type"].AsInt, color = b["color"].AsInt;
                if (type < 1 || type > 255) throw new FormatException($"model '{m.Name}': type {type} outside 1..255");
                if (color < 1 || color > 255) throw new FormatException($"model '{m.Name}': color {color} outside 1..255");
                string? partName = b.OptString("part");
                int part = partName == null ? -1 : m.PartIndex(partName);
                if (partName != null && part < 0) throw new FormatException($"model '{m.Name}': brick refers to unknown part '{partName}'");
                m.Bricks.Add(new ModelBrick
                {
                    I = b["i"].AsInt, J = b["j"].AsInt, K = b["k"].AsInt,
                    Type = (byte)type, Color = (byte)color, RotFlags = (byte)rot, Part = part,
                });
            }
            if (catalogue != null) m.Validate(catalogue);
            return m;
        }

        /// <summary>Throws when a brick has an unknown type or sticks out of the model's <c>size</c> box.</summary>
        public void Validate(Catalogue catalogue)
        {
            foreach (var b in Bricks)
            {
                var t = catalogue[b.Type] ?? throw new FormatException($"model '{Name}': unknown brick type {b.Type}");
                Rotation.RotatedExtent(t.W, t.D, b.Rot, out int ei, out int ej);
                if (b.I < 0 || b.J < 0 || b.K < 0 || b.I + ei > SizeI || b.J + ej > SizeJ || b.K + t.H > SizeK)
                    throw new FormatException($"model '{Name}': brick {t.Name} at ({b.I}, {b.J}, {b.K}) is outside size [{SizeI}, {SizeJ}, {SizeK}]");
            }
        }
    }
}
