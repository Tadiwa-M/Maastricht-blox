#nullable enable
using System;

namespace Blox.Data
{
    /// <summary>sRGB helpers (IEC 61966-2-1 transfer function, same as Unity's Color.linear).</summary>
    public static class ColorSpace
    {
        public static float SrgbToLinear(byte c) => SrgbToLinear(c / 255f);

        public static float SrgbToLinear(float c) =>
            c <= 0.04045f ? c / 12.92f : (float)Math.Pow((c + 0.055) / 1.055, 2.4);

        public static float LinearToSrgb(float c) =>
            c <= 0.0031308f ? c * 12.92f : (float)(1.055 * Math.Pow(c, 1.0 / 2.4) - 0.055);

        /// <summary>Parses "#RRGGBB" (leading '#' optional).</summary>
        public static void ParseHex(string hex, out byte r, out byte g, out byte b)
        {
            string s = hex.StartsWith("#", StringComparison.Ordinal) ? hex.Substring(1) : hex;
            if (s.Length != 6) throw new FormatException($"colour '{hex}' is not #RRGGBB");
            r = HexByte(s, 0, hex); g = HexByte(s, 2, hex); b = HexByte(s, 4, hex);
        }

        private static byte HexByte(string s, int at, string orig)
        {
            int hi = Nibble(s[at]), lo = Nibble(s[at + 1]);
            if (hi < 0 || lo < 0) throw new FormatException($"colour '{orig}' has non-hex digits");
            return (byte)((hi << 4) | lo);
        }

        private static int Nibble(char c) =>
            c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
    }
}
