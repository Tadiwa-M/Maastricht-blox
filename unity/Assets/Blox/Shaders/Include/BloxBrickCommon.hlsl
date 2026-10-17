#ifndef BLOX_BRICK_COMMON_INCLUDED
#define BLOX_BRICK_COMMON_INCLUDED

// Shared by BrickBody and BrickTransparent. The including shader declares its
// UnityPerMaterial CBUFFER first; every property used here must be in it.
//
// Vertex layout (Blox.Meshing BrickVertex, stream 0):
//   POSITION  chunk-local metres (object transform = chunk SW corner)
//   NORMAL    flat face normal
//   COLOR     linear palette colour, per-brick variation already baked in (BrickVariation)
//   TEXCOORD0 face coordinates in metres, TEXCOORD1 face size in metres (0 = no edge)
//   TEXCOORD2 x = MaterialClass, y = brick seed01

#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"
#include "BloxGlobals.hlsl"
#include "BloxEdges.hlsl"
#include "BloxFakeStuds.hlsl"

struct BloxBrickAttributes
{
    float4 positionOS : POSITION;
    float3 normalOS   : NORMAL;
    float4 color      : COLOR;
    float2 uv0        : TEXCOORD0;
    float2 uv1        : TEXCOORD1;
    float2 uv2        : TEXCOORD2;
    UNITY_VERTEX_INPUT_INSTANCE_ID
};

struct BloxBrickVaryings
{
    float4 positionCS : SV_POSITION;
    float3 positionWS : TEXCOORD0;
    float3 normalWS   : TEXCOORD1;
    float4 color      : TEXCOORD2;
    float4 faceUV     : TEXCOORD3;   // xy = UV0, zw = UV1 (metres)
    nointerpolation float2 classSeed : TEXCOORD4;
    float  fogFactor  : TEXCOORD5;
#if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
    float4 shadowCoord : TEXCOORD6;
#endif
    UNITY_VERTEX_INPUT_INSTANCE_ID
    UNITY_VERTEX_OUTPUT_STEREO
};

// Set by URP for the shadow caster pass.
float3 _LightDirection;
float3 _LightPosition;

float4 BloxShadowCasterClip(float3 positionWS, float3 normalWS)
{
#if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
    float3 lightDirectionWS = normalize(_LightPosition - positionWS);
#else
    float3 lightDirectionWS = _LightDirection;
#endif
    float4 positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirectionWS));
#if UNITY_REVERSED_Z
    positionCS.z = min(positionCS.z, UNITY_NEAR_CLIP_VALUE);
#else
    positionCS.z = max(positionCS.z, UNITY_NEAR_CLIP_VALUE);
#endif
    return positionCS;
}

BloxBrickVaryings BloxBrickVertex(BloxBrickAttributes input)
{
    BloxBrickVaryings o = (BloxBrickVaryings)0;
    UNITY_SETUP_INSTANCE_ID(input);
    UNITY_TRANSFER_INSTANCE_ID(input, o);
    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

    float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
    float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
    o.positionWS = positionWS;
    o.normalWS = normalWS;
#if defined(BLOX_SHADOW_CASTER_PASS)
    o.positionCS = BloxShadowCasterClip(positionWS, normalWS);
#else
    o.positionCS = TransformWorldToHClip(positionWS);
#endif
    o.color = input.color;
    o.faceUV = float4(input.uv0, input.uv1);
    o.classSeed = input.uv2;
    o.fogFactor = ComputeFogFactor(o.positionCS.z);
#if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
    o.shadowCoord = TransformWorldToShadowCoord(positionWS);
#endif
    return o;
}

struct BloxBrickSurface
{
    float3 albedo;
    float3 normalWS;
    float3 faceNormalWS;
    float  smoothness;
    float  metallic;
    float  occlusion;
    float3 emission;
    int    materialClass;
    float  seed;
    float  seam;
};

int BloxMaterialClass(BloxBrickVaryings input) { return (int)round(input.classSeed.x); }

// Bevel, seams, crevices, fake studs and per-class base parameters (solid / metal / emissive).
// Glass and water specifics are layered on top by BrickTransparent.
BloxBrickSurface BloxEvaluateBrick(BloxBrickVaryings input)
{
    BloxBrickSurface s;
    s.faceNormalWS = normalize(input.normalWS);
    s.materialClass = BloxMaterialClass(input);
    s.seed = input.classSeed.y;

    float pixelM = BloxPixelFootprint(input.positionWS);
    float camDist = distance(input.positionWS, _WorldSpaceCameraPos.xyz);

    BloxEdgeParams ep;
    ep.bevelM = max(_BevelWidth * BLOX_STUD_M, 1e-4);
    ep.bevelStrength = _BevelStrength;
    ep.seamM = _SeamWidth * BLOX_STUD_M;
    ep.seamDarkness = _SeamDarkness;
    ep.creviceM = _CreviceWidth * BLOX_STUD_M;
    ep.creviceAO = _CreviceAO;
    BloxEdgeResult e = BloxEvaluateEdges(s.faceNormalWS, input.faceUV.xy, input.faceUV.zw, pixelM, ep);

    float3 n = normalize(e.normalWS + BloxBrickTiltOffset(s.faceNormalWS, s.seed, _BrickTilt));
    float occlusion = e.occlusion;
    float shade = 1.0;

    BloxStudParams sp;
    sp.strength = _FakeStudStrength;
    sp.ringAO = _StudRingAO;
    sp.shadow = _StudShadow;
    BloxApplyFakeStud(input.positionWS, s.faceNormalWS, camDist, pixelM, sp, n, occlusion, shade);

    float2 h = BloxSeedHash2(s.seed);
    s.normalWS = n;
    s.seam = e.seam;
    s.albedo = input.color.rgb * shade * (1.0 - e.seam);
    s.occlusion = occlusion;
    s.metallic = 0.0;
    s.smoothness = saturate(_Smoothness + (h.y - 0.5) * _SmoothnessJitter) * (1.0 - 0.6 * e.seam);
    s.emission = 0.0;

    if (s.materialClass == BLOX_CLASS_METAL)
    {
        s.metallic = 0.85;
        s.smoothness = saturate(_MetalSmoothness + (h.y - 0.5) * _SmoothnessJitter);
    }
    else if (s.materialClass == BLOX_CLASS_EMISSIVE)
    {
        s.emission = input.color.rgb * _EmissiveIntensity * lerp(_EmissiveDay, 1.0, _BloxNight);
    }
    return s;
}

InputData BloxInputData(BloxBrickVaryings input, float3 normalWS)
{
    InputData d = (InputData)0;
    d.positionWS = input.positionWS;
    d.positionCS = input.positionCS;
    d.normalWS = normalWS;
    d.viewDirectionWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
#if defined(REQUIRES_VERTEX_SHADOW_COORD_INTERPOLATOR)
    d.shadowCoord = input.shadowCoord;
#elif defined(MAIN_LIGHT_CALCULATE_SHADOWS)
    d.shadowCoord = TransformWorldToShadowCoord(input.positionWS);
#else
    d.shadowCoord = float4(0.0, 0.0, 0.0, 0.0);
#endif
    d.fogCoord = input.fogFactor;
    d.vertexLighting = half3(0.0, 0.0, 0.0);
    d.bakedGI = SampleSH(normalWS);
    d.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
    d.shadowMask = half4(1.0, 1.0, 1.0, 1.0);
    return d;
}

SurfaceData BloxSurfaceData(BloxBrickSurface s, float alpha)
{
    SurfaceData d = (SurfaceData)0;
    d.albedo = s.albedo;
    d.specular = half3(0.0, 0.0, 0.0);
    d.metallic = s.metallic;
    d.smoothness = s.smoothness;
    d.normalTS = half3(0.0, 0.0, 1.0);
    d.emission = s.emission;
    d.occlusion = s.occlusion;
    d.alpha = alpha;
    // Thin clear coat = the tight second highlight of moulded ABS. Metal parts skip it.
    d.clearCoatMask = s.metallic > 0.5 ? 0.0 : _ClearCoat * (1.0 - s.seam);
    d.clearCoatSmoothness = _ClearCoatSmoothness;
    return d;
}

// ---- depth-only and depth-normals fragments (opaque passes, used by SSAO) -------------

half BloxBrickDepthOnlyFrag(BloxBrickVaryings input) : SV_Target
{
    UNITY_SETUP_INSTANCE_ID(input);
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
    return input.positionCS.z;
}

half4 BloxPackDepthNormal(float3 normalWS)
{
#if defined(_GBUFFER_NORMALS_OCT)
    float2 octNormalWS = PackNormalOctQuadEncode(normalWS);
    float2 remapped = saturate(octNormalWS * 0.5 + 0.5);
    return half4(PackFloat2To888(remapped), 0.0);
#else
    return half4(NormalizeNormalPerPixel(normalWS), 0.0);
#endif
}

half4 BloxBrickDepthNormalsFrag(BloxBrickVaryings input) : SV_Target
{
    UNITY_SETUP_INSTANCE_ID(input);
    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
    BloxBrickSurface s = BloxEvaluateBrick(input);
    return BloxPackDepthNormal(s.normalWS);
}

half BloxShadowCasterFrag(BloxBrickVaryings input) : SV_Target
{
    return 0;
}

#endif // BLOX_BRICK_COMMON_INCLUDED
