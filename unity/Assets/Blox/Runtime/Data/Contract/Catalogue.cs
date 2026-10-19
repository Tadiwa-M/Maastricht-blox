#nullable enable
using System;
using System.Collections.Generic;
using Blox.Data.Json;

namespace Blox.Data
{
    /// <summary>
    /// Shape family of a brick type (catalogue <c>kind</c>). Kinds up to Round are extrusions of a
    /// simple profile; Arch and later (v2, CONTRACT 2.1) are detail pieces with their own geometry.
    /// </summary>
    public enum BrickKind : byte
    {
        Brick = 0, Plate = 1, Tile = 2, Slope = 3, SlopeDouble = 4, Round = 5,
        Arch = 6, Window = 7, Door = 8, Fence = 9, RoundTile = 10, Jumper = 11, TileGrille = 12,
    }

    /// <summary>Catalogue <c>studs</c>: which footprint cells carry a top stud. Center = one stud on the footprint centre (jumper).</summary>
    public enum StudPattern : byte { None = 0, All = 1, BackRows = 2, Center = 3 }

    /// <summary>Blittable brick type description (indexed by typeId in a 256 table) for jobs.</summary>
    public struct BrickTypeInfo
    {
        public byte Defined;   // 1 when the catalogue has this id
        public BrickKind Kind;
        public byte W;         // studs along +i at rot 0
        public byte D;         // studs along +j at rot 0
        public byte H;         // plates
        public StudPattern Studs;
        public byte StudRows;  // slopes: number of studded back rows

        public bool IsSlope => Kind == BrickKind.Slope || Kind == BrickKind.SlopeDouble;

        /// <summary>Round prisms (round brick/plate and the round tile).</summary>
        public bool IsRound => Kind == BrickKind.Round || Kind == BrickKind.RoundTile;

        /// <summary>v2 detail pieces with hand-built geometry (arch, window, door, fence, grille).</summary>
        public bool IsDetail => Kind == BrickKind.Arch || Kind == BrickKind.Window || Kind == BrickKind.Door
                                || Kind == BrickKind.Fence || Kind == BrickKind.TileGrille;
    }

    public sealed class BrickType
    {
        public byte Id { get; set; }
        public string Name { get; set; } = "";
        public BrickKind Kind { get; set; }
        public int W { get; set; }
        public int D { get; set; }
        public int H { get; set; }
        public StudPattern Studs { get; set; }
        public int StudRows { get; set; }

        public BrickTypeInfo Info => new BrickTypeInfo
        {
            Defined = 1, Kind = Kind, W = (byte)W, D = (byte)D, H = (byte)H, Studs = Studs, StudRows = (byte)StudRows,
        };
    }

    /// <summary>contract/brick_catalogue.json model (CONTRACT sections 2 and 2.1).</summary>
    public sealed class Catalogue
    {
        private readonly BrickType?[] _byId = new BrickType?[256];
        private readonly Dictionary<string, BrickType> _byName = new Dictionary<string, BrickType>(StringComparer.Ordinal);

        public int Version { get; private set; }
        public List<BrickType> Types { get; } = new List<BrickType>();

        public BrickType? this[int id] => id > 0 && id < 256 ? _byId[id] : null;
        public BrickType ByName(string name) => _byName.TryGetValue(name, out var t) ? t : throw new KeyNotFoundException($"no brick type '{name}'");

        public static Catalogue Parse(string json) => FromJson(JsonParser.Parse(json));

        public static Catalogue FromJson(JsonNode n)
        {
            var c = new Catalogue { Version = n.OptInt("version") ?? 1 };
            foreach (var e in n["types"].Items)
            {
                int id = e["id"].AsInt;
                if (id <= 0 || id > 255) throw new FormatException($"brick id {id} outside 1..255 (0 is reserved)");
                var t = new BrickType
                {
                    Id = (byte)id,
                    Name = e["name"].AsString,
                    Kind = ParseKind(e["kind"].AsString),
                    W = e["w"].AsInt,
                    D = e["d"].AsInt,
                    H = e["h"].AsInt,
                    Studs = ParseStuds(e["studs"].AsString),
                    StudRows = e.OptInt("studRows") ?? 0,
                };
                Validate(t);
                if (c._byId[id] != null) throw new FormatException($"duplicate brick id {id}");
                if (c._byName.ContainsKey(t.Name)) throw new FormatException($"duplicate brick name '{t.Name}'");
                c._byId[id] = t;
                c._byName[t.Name] = t;
                c.Types.Add(t);
            }
            return c;
        }

        private static void Validate(BrickType t)
        {
            if (t.W < 1 || t.D < 1 || t.H < 1 || t.W > 64 || t.D > 64 || t.H > 255)
                throw new FormatException($"brick '{t.Name}' has invalid size {t.W}x{t.D}x{t.H}");
            // studRows 0 is allowed (v2 slope30: a slope without studs).
            if (t.Studs == StudPattern.BackRows && (t.StudRows < 0 || t.StudRows >= t.D))
                throw new FormatException($"brick '{t.Name}' studRows {t.StudRows} must be in 0..d-1");
            if (t.Kind == BrickKind.Slope && t.D < 2)
                throw new FormatException($"slope '{t.Name}' needs d >= 2");
        }

        public static BrickKind ParseKind(string s) => s switch
        {
            "brick" => BrickKind.Brick,
            "plate" => BrickKind.Plate,
            "tile" => BrickKind.Tile,
            "slope" => BrickKind.Slope,
            "slope_double" => BrickKind.SlopeDouble,
            "round" => BrickKind.Round,
            "arch" => BrickKind.Arch,
            "window" => BrickKind.Window,
            "door" => BrickKind.Door,
            "fence" => BrickKind.Fence,
            "round_tile" => BrickKind.RoundTile,
            "jumper" => BrickKind.Jumper,
            "tile_grille" => BrickKind.TileGrille,
            _ => throw new FormatException($"unknown brick kind '{s}'"),
        };

        public static StudPattern ParseStuds(string s) => s switch
        {
            "all" => StudPattern.All,
            "none" => StudPattern.None,
            "backRows" => StudPattern.BackRows,
            "center" => StudPattern.Center,
            _ => throw new FormatException($"unknown stud pattern '{s}'"),
        };

        /// <summary>256-entry table (indexed by typeId) for meshing jobs.</summary>
        public BrickTypeInfo[] ToTable()
        {
            var t = new BrickTypeInfo[256];
            foreach (var bt in Types) t[bt.Id] = bt.Info;
            return t;
        }
    }
}
