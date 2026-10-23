#nullable enable
using System.Runtime.InteropServices;

namespace Blox.Data
{
    /// <summary>
    /// One brick as stored in a .bxc chunk (CONTRACT section 4). 12 bytes, blittable; the
    /// file's reserved byte is the padding byte before <see cref="featureId"/>.
    /// Field names follow the contract's record layout.
    ///
    /// rotFlags: bits 0-1 rot, bit 2 no_variation, bit 3 hide_studs (v2), bits 4-7 reserved.
    /// Prefer <see cref="Place"/> (by <see cref="Data.Facing"/>) over passing a raw rot.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct BrickRecord
    {
        public const byte RotMask = 0x03;
        public const byte FlagNoVariation = 0x04;
        /// <summary>v2: every stud cell is covered by a hollow-culled interior cell; renderers skip its studs.</summary>
        public const byte FlagHideStuds = 0x08;
        public const byte ReservedFlagMask = 0xF0;

        public byte i;          // local 0..63 (east)
        public byte j;          // local 0..63 (north)
        public ushort k;        // global vertical level
        public byte type;       // brick_catalogue id
        public byte color;      // palette idx
        public byte rotFlags;   // bits0-1 rot, bit2 no_variation, bit3 hide_studs
        public uint featureId;  // 0 = none

        public BrickRecord(byte i, byte j, ushort k, byte type, byte color, int rot, bool noVariation = false, uint featureId = 0, bool hideStuds = false)
        {
            this.i = i; this.j = j; this.k = k; this.type = type; this.color = color;
            rotFlags = (byte)((rot & RotMask) | (noVariation ? FlagNoVariation : 0) | (hideStuds ? FlagHideStuds : 0));
            this.featureId = featureId;
        }

        /// <summary>Creates a record whose front faces <paramref name="facing"/> (the readable way to rotate).</summary>
        public static BrickRecord Place(byte i, byte j, ushort k, byte type, byte color, Facing facing,
                                        bool noVariation = false, uint featureId = 0, bool hideStuds = false) =>
            new BrickRecord(i, j, k, type, color, Rotation.FacingToRot(facing), noVariation, featureId, hideStuds);

        public int Rot => rotFlags & RotMask;
        public Facing Facing => Rotation.RotToFacing(rotFlags);
        public bool NoVariation => (rotFlags & FlagNoVariation) != 0;
        public bool HideStuds => (rotFlags & FlagHideStuds) != 0;

        public override string ToString() => $"Brick(i={i}, j={j}, k={k}, type={type}, color={color}, facing={Facing}, noVar={NoVariation}, hideStuds={HideStuds}, feature={featureId})";
    }
}
