#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Blox.Data.Json
{
    /// <summary>
    /// Minimal strict RFC 8259 JSON parser (System.Text.Json is not available in Unity's
    /// netstandard2.1 profile). Rejects trailing garbage, trailing commas, comments, leading
    /// zeros, unescaped control characters and lone surrogates are passed through as-is.
    /// Duplicate object keys: last one wins (as in most parsers).
    /// </summary>
    public static class JsonParser
    {
        private const int MaxDepth = 256;

        public static JsonNode Parse(string text)
        {
            if (text == null) throw new ArgumentNullException(nameof(text));
            var p = new Cursor(text);
            p.SkipBom();
            p.SkipWs();
            JsonNode root = p.ReadValue(0);
            p.SkipWs();
            if (!p.AtEnd) throw p.Error("trailing characters after JSON value");
            return root;
        }

        private struct Cursor
        {
            private readonly string _s;
            private int _pos;
            private readonly StringBuilder _sb;

            public Cursor(string s) { _s = s; _pos = 0; _sb = new StringBuilder(); }

            public bool AtEnd => _pos >= _s.Length;

            public void SkipBom() { if (_pos < _s.Length && _s[_pos] == '﻿') _pos++; }

            public void SkipWs()
            {
                while (_pos < _s.Length)
                {
                    char c = _s[_pos];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') _pos++;
                    else break;
                }
            }

            public JsonException Error(string msg)
            {
                int line = 1, col = 1;
                for (int i = 0; i < _pos && i < _s.Length; i++)
                {
                    if (_s[i] == '\n') { line++; col = 1; } else col++;
                }
                return new JsonException($"JSON parse error at line {line}, column {col}: {msg}");
            }

            public JsonNode ReadValue(int depth)
            {
                if (depth > MaxDepth) throw Error("nesting too deep");
                if (AtEnd) throw Error("unexpected end of input");
                char c = _s[_pos];
                switch (c)
                {
                    case '{': return ReadObject(depth);
                    case '[': return ReadArray(depth);
                    case '"': return JsonNode.FromString(ReadString());
                    case 't': Expect("true"); return JsonNode.True;
                    case 'f': Expect("false"); return JsonNode.False;
                    case 'n': Expect("null"); return JsonNode.Null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return JsonNode.FromNumber(ReadNumber());
                        throw Error($"unexpected character '{c}'");
                }
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(_s, _pos, word, 0, word.Length) != 0) throw Error($"expected '{word}'");
                _pos += word.Length;
            }

            private JsonNode ReadObject(int depth)
            {
                _pos++; // {
                var fields = new Dictionary<string, JsonNode>(StringComparer.Ordinal);
                var order = new List<string>();
                SkipWs();
                if (!AtEnd && _s[_pos] == '}') { _pos++; return JsonNode.FromObject(fields, order); }
                while (true)
                {
                    SkipWs();
                    if (AtEnd || _s[_pos] != '"') throw Error("expected object key string");
                    string key = ReadString();
                    SkipWs();
                    if (AtEnd || _s[_pos] != ':') throw Error("expected ':'");
                    _pos++;
                    SkipWs();
                    JsonNode value = ReadValue(depth + 1);
                    if (!fields.ContainsKey(key)) order.Add(key);
                    fields[key] = value;
                    SkipWs();
                    if (AtEnd) throw Error("unterminated object");
                    char c = _s[_pos++];
                    if (c == '}') return JsonNode.FromObject(fields, order);
                    if (c != ',') throw Error("expected ',' or '}'");
                }
            }

            private JsonNode ReadArray(int depth)
            {
                _pos++; // [
                var items = new List<JsonNode>();
                SkipWs();
                if (!AtEnd && _s[_pos] == ']') { _pos++; return JsonNode.FromArray(items); }
                while (true)
                {
                    SkipWs();
                    items.Add(ReadValue(depth + 1));
                    SkipWs();
                    if (AtEnd) throw Error("unterminated array");
                    char c = _s[_pos++];
                    if (c == ']') return JsonNode.FromArray(items);
                    if (c != ',') throw Error("expected ',' or ']'");
                }
            }

            private string ReadString()
            {
                _pos++; // opening quote
                _sb.Clear();
                while (true)
                {
                    if (AtEnd) throw Error("unterminated string");
                    char c = _s[_pos++];
                    if (c == '"') return _sb.ToString();
                    if (c < 0x20) throw Error("control character in string");
                    if (c != '\\') { _sb.Append(c); continue; }
                    if (AtEnd) throw Error("unterminated escape");
                    char e = _s[_pos++];
                    switch (e)
                    {
                        case '"': _sb.Append('"'); break;
                        case '\\': _sb.Append('\\'); break;
                        case '/': _sb.Append('/'); break;
                        case 'b': _sb.Append('\b'); break;
                        case 'f': _sb.Append('\f'); break;
                        case 'n': _sb.Append('\n'); break;
                        case 'r': _sb.Append('\r'); break;
                        case 't': _sb.Append('\t'); break;
                        case 'u': _sb.Append(ReadHex4()); break;
                        default: throw Error($"invalid escape '\\{e}'");
                    }
                }
            }

            private char ReadHex4()
            {
                if (_pos + 4 > _s.Length) throw Error("truncated \\u escape");
                int v = 0;
                for (int i = 0; i < 4; i++)
                {
                    char h = _s[_pos++];
                    int d = h >= '0' && h <= '9' ? h - '0'
                        : h >= 'a' && h <= 'f' ? h - 'a' + 10
                        : h >= 'A' && h <= 'F' ? h - 'A' + 10
                        : -1;
                    if (d < 0) throw Error("invalid hex digit in \\u escape");
                    v = (v << 4) | d;
                }
                return (char)v;
            }

            private double ReadNumber()
            {
                int start = _pos;
                if (_s[_pos] == '-') _pos++;
                if (AtEnd) throw Error("truncated number");
                if (_s[_pos] == '0')
                {
                    _pos++;
                }
                else if (_s[_pos] >= '1' && _s[_pos] <= '9')
                {
                    SkipDigits();
                }
                else throw Error("invalid number");

                if (!AtEnd && _s[_pos] == '.')
                {
                    _pos++;
                    int digits = SkipDigits();
                    if (digits == 0) throw Error("expected digits after '.'");
                }
                if (!AtEnd && (_s[_pos] == 'e' || _s[_pos] == 'E'))
                {
                    _pos++;
                    if (!AtEnd && (_s[_pos] == '+' || _s[_pos] == '-')) _pos++;
                    if (SkipDigits() == 0) throw Error("expected exponent digits");
                }
                string token = _s.Substring(start, _pos - start);
                if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double v))
                    throw Error($"invalid number '{token}'");
                return v;
            }

            private int SkipDigits()
            {
                int n = 0;
                while (!AtEnd && _s[_pos] >= '0' && _s[_pos] <= '9') { _pos++; n++; }
                return n;
            }
        }
    }
}
