#ifndef BLOX_GLOBALS_INCLUDED
#define BLOX_GLOBALS_INCLUDED

// ---------------------------------------------------------------------------------------
// Contract constants (CONTRACT.md section 1) and the material classes written by the
// mesher into UV2.x (Blox.Data.MaterialClass).
// ---------------------------------------------------------------------------------------
#define BLOX_STUD_M          0.5
#define BLOX_PLATE_M         0.2
#define BLOX_STUD_RADIUS_M   0.15     // stud diameter = 0.6 stud pitch (4.8 / 8)
#define BLOX_STUD_HEIGHT_M   0.1125   // 1.8 / 3.2 plate
#define BLOX_WORLD_CHUNKS    64
#define BLOX_CHUNK_STUDS     64

#define BLOX_CLASS_SOLID     0
#define BLOX_CLASS_TRANS     1
#define BLOX_CLASS_GLASS     2
#define BLOX_CLASS_EMISSIVE  3
#define BLOX_CLASS_METAL     4

// ---------------------------------------------------------------------------------------
// Globals set from C# (Blox.Rendering.BloxShaderGlobals). They live outside UnityPerMaterial,
// which keeps every material SRP-Batcher and GPU-Resident-Drawer compatible.
// ---------------------------------------------------------------------------------------
float  _BloxNight;          // 0 = day .. 1 = night (TimeOfDayController)
float4 _BloxStudFade;       // x = fake-stud fade-in start (m), y = fade-in end (m), z = 1 when _BloxStudTops is bound
float  _BloxTime;           // seconds, for water animation (decoupled from Time.time pauses)

// Highest exposed stud level per world column, 16 bits per column, chunk-major:
// column index = ((cy * 64 + cx) << 12) | (lj << 6) | li, two columns per uint (low half first).
// 0 = no stud. Written by StudTopsBuffer from each chunk's stud list.
StructuredBuffer<uint> _BloxStudTops;

uint BloxStudTopAt(int I, int J)
{
    if (_BloxStudFade.z < 0.5) return 0u;
    const int worldStuds = BLOX_WORLD_CHUNKS * BLOX_CHUNK_STUDS;
    if (I < 0 || J < 0 || I >= worldStuds || J >= worldStuds) return 0u;
    uint ui = (uint)I, uj = (uint)J;
    uint chunk = (uj >> 6) * BLOX_WORLD_CHUNKS + (ui >> 6);
    uint idx = (chunk << 12) | ((uj & 63u) << 6) | (ui & 63u);
    uint word = _BloxStudTops[idx >> 1];
    return (idx & 1u) != 0u ? (word >> 16) : (word & 0xFFFFu);
}

// Two cheap decorrelated [0, 1) values from the brick seed (UV2.y = BrickVariation.Seed01).
float2 BloxSeedHash2(float seed01)
{
    return frac(float2(seed01 * 41.3713 + 0.1307, seed01 * 97.1127 + 0.7121));
}

#endif // BLOX_GLOBALS_INCLUDED
