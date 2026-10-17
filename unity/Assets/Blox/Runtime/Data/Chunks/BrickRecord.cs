#nullable enable
using System.Runtime.InteropServices;

namespace Blox.Data
{
    /// <summary>
    /// One brick as stored in a .bxc chunk (CONTRACT section 4). 12 bytes, blittable; the
    /// file's reserved byte is the padding byte before <see cref="featureId"/>.
    /// Field names follow the contract's record layout.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct BrickRecord
    {
        public const byte RotMask = 0x03;
        public const byte FlagNoVariation = 0x04;
        public const byte ReservedFlagMask = 0xF8;

        public byte i;          // local 0..63 (east)
        public byte j;          // local 0..63 (north)
        public ushort k;        // global vertical level
        public byte type;       // brick_catalogue id
        public byte color;      // palette idx
        public byte rotFlags;   // bits0-1 rot, bit2 no_variation
        public uint featureId;  // 0 = none

        public BrickRecord(byte i, byte j, ushort k, byte type, byte color, int rot, bool noVariation = false, uint featureId = 0)
        {
            this.i = i; this.j = j; this.k = k; this.type = type; this.color = color;
            rotFlags = (byte)((rot & RotMask) | (noVariation ? FlagNoVariation : 0));
            this.featureId = featureId;
        }

        public int Rot => rotFlags & RotMask;
        public bool NoVariation => (rotFlags & FlagNoVariation) != 0;

        public override string ToString() => $"Brick(i={i}, j={j}, k={k}, type={type}, color={color}, rot={Rot}, noVar={NoVariation}, feature={featureId})";
    }
}
