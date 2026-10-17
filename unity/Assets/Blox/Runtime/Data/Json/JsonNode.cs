#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;

namespace Blox.Data.Json
{
    /// <summary>JSON value kinds produced by <see cref="JsonParser"/>.</summary>
    public enum JsonKind { Null, Bool, Number, String, Array, Object }

    /// <summary>
    /// Immutable JSON value tree. Small and allocation-light by design: it only has to read the
    /// contract files (manifest, palette, catalogue, features) and the live proxy responses.
    /// Accessors throw <see cref="JsonException"/> with the offending path-less message on type
    /// mismatch; use the <c>Try</c>/<c>Opt</c> variants for optional fields.
    /// </summary>
    public sealed class JsonNode
    {
        public static readonly JsonNode Null = new JsonNode(JsonKind.Null);
        public static readonly JsonNode True = new JsonNode(JsonKind.Bool) { _bool = true };
        public static readonly JsonNode False = new JsonNode(JsonKind.Bool) { _bool = false };

        private bool _bool;
        private double _number;
        private string? _string;
        private List<JsonNode>? _items;
        private Dictionary<string, JsonNode>? _fields;
        private List<string>? _keyOrder;

        public JsonKind Kind { get; }

        private JsonNode(JsonKind kind) { Kind = kind; }

        public static JsonNode FromNumber(double v) => new JsonNode(JsonKind.Number) { _number = v };
        public static JsonNode FromString(string v) => new JsonNode(JsonKind.String) { _string = v };
        public static JsonNode FromArray(List<JsonNode> items) => new JsonNode(JsonKind.Array) { _items = items };

        public static JsonNode FromObject(Dictionary<string, JsonNode> fields, List<string> order) =>
            new JsonNode(JsonKind.Object) { _fields = fields, _keyOrder = order };

        public bool IsNull => Kind == JsonKind.Null;

        public bool AsBool => Kind == JsonKind.Bool ? _bool : throw Mismatch("bool");
        public double AsDouble => Kind == JsonKind.Number ? _number : throw Mismatch("number");
        public float AsFloat => (float)AsDouble;
        public string AsString => Kind == JsonKind.String ? _string! : throw Mismatch("string");

        public int AsInt
        {
            get
            {
                double d = AsDouble;
                if (d != Math.Floor(d) || d < int.MinValue || d > int.MaxValue) throw new JsonException($"expected int, got {d.ToString(CultureInfo.InvariantCulture)}");
                return (int)d;
            }
        }

        public long AsLong
        {
            get
            {
                double d = AsDouble;
                if (d != Math.Floor(d) || Math.Abs(d) > 9007199254740992d) throw new JsonException($"expected integer, got {d.ToString(CultureInfo.InvariantCulture)}");
                return (long)d;
            }
        }

        public uint AsUInt
        {
            get
            {
                long v = AsLong;
                if (v < 0 || v > uint.MaxValue) throw new JsonException($"expected uint32, got {v}");
                return (uint)v;
            }
        }

        public IReadOnlyList<JsonNode> Items => Kind == JsonKind.Array ? _items! : throw Mismatch("array");
        public int Count => Kind == JsonKind.Array ? _items!.Count : Kind == JsonKind.Object ? _fields!.Count : 0;

        /// <summary>Object keys in document order.</summary>
        public IReadOnlyList<string> Keys => Kind == JsonKind.Object ? _keyOrder! : throw Mismatch("object");

        public JsonNode this[int index] => Items[index];

        /// <summary>Required object field.</summary>
        public JsonNode this[string key]
        {
            get
            {
                if (Kind != JsonKind.Object) throw Mismatch("object");
                return _fields!.TryGetValue(key, out var v) ? v : throw new JsonException($"missing field '{key}'");
            }
        }

        public bool Has(string key) => Kind == JsonKind.Object && _fields!.ContainsKey(key);

        /// <summary>Optional field: returns <see cref="Null"/> when absent.</summary>
        public JsonNode Get(string key)
        {
            if (Kind != JsonKind.Object) throw Mismatch("object");
            return _fields!.TryGetValue(key, out var v) ? v : Null;
        }

        public string? OptString(string key) { var n = Get(key); return n.IsNull ? null : n.AsString; }
        public double? OptDouble(string key) { var n = Get(key); return n.IsNull ? (double?)null : n.AsDouble; }
        public long? OptLong(string key) { var n = Get(key); return n.IsNull ? (long?)null : n.AsLong; }
        public int? OptInt(string key) { var n = Get(key); return n.IsNull ? (int?)null : n.AsInt; }
        public bool? OptBool(string key) { var n = Get(key); return n.IsNull ? (bool?)null : n.AsBool; }

        private JsonException Mismatch(string wanted) => new JsonException($"expected {wanted}, got {Kind}");

        public override string ToString() => Kind switch
        {
            JsonKind.Null => "null",
            JsonKind.Bool => _bool ? "true" : "false",
            JsonKind.Number => _number.ToString("R", CultureInfo.InvariantCulture),
            JsonKind.String => "\"" + _string + "\"",
            JsonKind.Array => $"[array of {_items!.Count}]",
            _ => $"{{object of {_fields!.Count}}}",
        };
    }

    public sealed class JsonException : Exception
    {
        public JsonException(string message) : base(message) { }
    }
}
