#nullable enable
using System.Runtime.InteropServices;
using Blox.Data;

namespace Blox.Meshing.Core
{
    /// <summary>Minimal float3 for the engine-free core (Unity.Mathematics is not available in dotnet tests).</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct Float3
    {
        public float X, Y, Z;
        public Float3(float x, float y, float z) { X = x; Y = y; Z = z; }
        public static Float3 operator +(Float3 a, Float3 b) => new Float3(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static Float3 operator -(Float3 a, Float3 b) => new Float3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static Float3 operator *(Float3 a, float s) => new Float3(a.X * s, a.Y * s, a.Z * s);
        public static float Dot(Float3 a, Float3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
        public static Float3 Cross(Float3 a, Float3 b) => new Float3(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
        public float Length => (float)System.Math.Sqrt(X * X + Y * Y + Z * Z);
        public Float3 Normalized { get { float l = Length; return l > 1e-12f ? this * (1f / l) : this; } }
        public override string ToString() => $"({X:0.###}, {Y:0.###}, {Z:0.###})";
    }

    /// <summary>
    /// Brick mesh vertex, 64 bytes, laid out exactly as the Unity vertex buffer (stream 0):
    /// Position f32x3, Normal f32x3, Color f32x4 (linear), TexCoord0 f32x2, TexCoord1 f32x2, TexCoord2 f32x2.
    /// See Meshing/README.md for the attribute semantics.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct BrickVertex
    {
        public Float3 Position;   // chunk-local metres (x, z relative to chunk SW corner; y absolute)
        public Float3 Normal;
        public float R, G, B, A;  // linear colour, variation baked in
        public float U0, V0;      // UV0: face-local coordinates in metres (from the face's min corner)
        public float U1, V1;      // UV1: face size in metres (0 = no edge on that axis)
        public float U2, V2;      // UV2: x = MaterialClass, y = brick seed in [0, 1)
    }

    /// <summary>
    /// One exposed stud for instanced drawing, 32 bytes (fits a StructuredBuffer stride).
    /// Position is in absolute Unity world metres: the centre of the stud's base on the brick top.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct StudInstance
    {
        public float X, Y, Z;
        public float R, G, B;      // linear colour (same as the brick body)
        public float AngleDeg;     // rotation about +Y from the stud cell's variation seed
        public float Material;     // MaterialClass as float
    }

    /// <summary>A brick with global coordinates: mesher input (own chunk and neighbours).</summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct PlacedBrick
    {
        public int I, J, K;      // global min corner of the rotated box
        public byte Type, Color, RotFlags, Pad;

        public PlacedBrick(int i, int j, int k, byte type, byte color, byte rotFlags)
        {
            I = i; J = j; K = k; Type = type; Color = color; RotFlags = rotFlags; Pad = 0;
        }

        /// <summary>A brick whose front faces <paramref name="facing"/> (the readable way to rotate).</summary>
        public static PlacedBrick Place(int i, int j, int k, byte type, byte color, Facing facing, bool noVariation = false, bool hideStuds = false) =>
            new PlacedBrick(i, j, k, type, color, (byte)(Rotation.FacingToRot(facing)
                | (noVariation ? BrickRecord.FlagNoVariation : 0) | (hideStuds ? BrickRecord.FlagHideStuds : 0)));

        public int Rot => RotFlags & BrickRecord.RotMask;
        public Facing Facing => Rotation.RotToFacing(RotFlags);
        public bool NoVariation => (RotFlags & BrickRecord.FlagNoVariation) != 0;
        public bool HideStuds => (RotFlags & BrickRecord.FlagHideStuds) != 0;

        public static PlacedBrick From(in BrickRecord r, int chunkX, int chunkY) =>
            new PlacedBrick(chunkX * 64 + r.i, chunkY * 64 + r.j, r.k, r.type, r.color, r.rotFlags);
    }

    /// <summary>Receives mesher output. Implemented by the Burst job (NativeLists) and by tests (Lists).</summary>
    public interface IChunkMeshSink
    {
        int VertexCount { get; }
        void AddVertex(in BrickVertex v);
        /// <summary>Adds one triangle to submesh 0 (opaque) or 1 (transparent).</summary>
        void AddTriangle(int submesh, int a, int b, int c);
        void AddStud(in StudInstance s);
    }

    /// <summary>Contract metric constants used by the meshing core.</summary>
    public static class Units
    {
        public const float StudM = 0.5f;
        public const float PlateM = 0.2f;
        public const int ChunkStuds = 64;
    }

    /// <summary>Axis directions. Index order is shared by grids, cover masks and tests.</summary>
    public static class Dir
    {
        public const int PosX = 0, NegX = 1, PosZ = 2, NegZ = 3, PosY = 4, NegY = 5;
        // In grid terms: x = i (east), z = j (north), y = k (up).
        public static int Di(int d) => d == PosX ? 1 : d == NegX ? -1 : 0;
        public static int Dj(int d) => d == PosZ ? 1 : d == NegZ ? -1 : 0;
        public static int Dk(int d) => d == PosY ? 1 : d == NegY ? -1 : 0;
        public static int Opposite(int d) => d ^ 1;

        /// <summary>Brick-local direction -> world direction for rotation rot (clockwise from above).</summary>
        public static int LocalToWorld(int d, int rot)
        {
            if (d >= PosY) return d;
            Rotation.RotateDir(Di(d), Dj(d), rot, out float di, out float dj);
            return FromVector((int)di, (int)dj);
        }

        /// <summary>World direction -> brick-local direction.</summary>
        public static int WorldToLocal(int d, int rot) => LocalToWorld(d, (4 - (rot & 3)) & 3);

        public static int FromVector(int di, int dj) => di > 0 ? PosX : di < 0 ? NegX : dj > 0 ? PosZ : NegZ;
    }
}
