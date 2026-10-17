#ifndef BLOX_STUD_COMMON_INCLUDED
#define BLOX_STUD_COMMON_INCLUDED

// Instanced studs drawn by Blox.Rendering.StudRenderer with Graphics.RenderMeshIndirect.
// Each draw binds _StudInstances to the culled, visible list of one LOD; SV_InstanceID
// indexes it directly (one indirect command per draw, startInstance = 0).
// The including shader declares its UnityPerMaterial CBUFFER first.

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
#include "BloxGlobals.hlsl"

// Mirrors Blox.Meshing.Core.StudInstance (32 bytes, tightly packed in a structured buffer).
struct BloxStudInstance
{
    float3 position;      // absolute Unity metres, centre of the stud base
    float3 color;         // linear, brick variation baked in
    float  angleDeg;      // rotation about +Y
    float  materialClass; // Blox.Data.MaterialClass
};

StructuredBuffer<BloxStudInstance> _StudInstances;

struct BloxStudAttributes
{
    float4 positionOS : POSITION;
    float3 normalOS   : NORMAL;
    uint   instanceID : SV_InstanceID;
};

struct BloxStudVaryings
{
    float4 positionCS : SV_POSITION;
    float3 positionWS : TEXCOORD0;
    float3 normalWS   : TEXCOORD1;
    nointerpolation float4 colorClass : TEXCOORD2; // rgb colour, a = material class
    float2 heightSeed : TEXCOORD3;                 // x = height above base (m), y = seed
    float  fogFactor  : TEXCOORD4;
#if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
    float4 shadowCoord : TEXCOORD5;
#endif
};

float3 _LightDirection;
float3 _LightPosition;

// Same convention as Quaternion.Euler(0, angle, 0): (1, 0, 0) -> (cos a, 0, -sin a).
float3 BloxRotateY(float3 p, float sinA, float cosA)
{
    return float3(p.x * cosA + p.z * sinA, p.y, -p.x * sinA + p.z * cosA);
}

BloxStudVaryings BloxStudVertex(BloxStudAttributes input)
{
    BloxStudVaryings o = (BloxStudVaryings)0;
    BloxStudInstance inst = _StudInstances[input.instanceID];
    float sinA, cosA;
    sincos(radians(inst.angleDeg), sinA, cosA);
    float3 positionWS = inst.position + BloxRotateY(input.positionOS.xyz, sinA, cosA);
    float3 normalWS = BloxRotateY(input.normalOS, sinA, cosA);

    o.positionWS = positionWS;
    o.normalWS = normalWS;
#if defined(BLOX_SHADOW_CASTER_PASS)
  #if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
    float3 lightDirectionWS = normalize(_LightPosition - positionWS);
  #else
    float3 lightDirectionWS = _LightDirection;
  #endif
    o.positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirectionWS));
  #if UNITY_REVERSED_Z
    o.positionCS.z = min(o.positionCS.z, UNITY_NEAR_CLIP_VALUE);
  #else
    o.positionCS.z = max(o.positionCS.z, UNITY_NEAR_CLIP_VALUE);
  #endif
#else
    o.positionCS = TransformWorldToHClip(positionWS);
#endif
    o.colorClass = float4(inst.color, inst.materialClass);
    o.heightSeed = float2(input.positionOS.y, frac(inst.angleDeg / 360.0));
    o.fogFactor = ComputeFogFactor(o.positionCS.z);
#if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
    o.shadowCoord = TransformWorldToShadowCoord(positionWS);
#endif
    return o;
}

half4 BloxStudDepthNormalsFrag(BloxStudVaryings input) : SV_Target
{
#if defined(_GBUFFER_NORMALS_OCT)
    float2 oct = saturate(PackNormalOctQuadEncode(normalize(input.normalWS)) * 0.5 + 0.5);
    return half4(PackFloat2To888(oct), 0.0);
#else
    return half4(NormalizeNormalPerPixel(input.normalWS), 0.0);
#endif
}

half BloxStudDepthOnlyFrag(BloxStudVaryings input) : SV_Target
{
    return input.positionCS.z;
}

half BloxStudShadowFrag(BloxStudVaryings input) : SV_Target
{
    return 0;
}

#endif // BLOX_STUD_COMMON_INCLUDED
