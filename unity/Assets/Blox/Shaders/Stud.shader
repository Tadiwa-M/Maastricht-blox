// Instanced studs (StudRenderer, Graphics.RenderMeshIndirect). Same plastic look as
// Blox/BrickBody; the procedural stud mesh carries the real bevel geometry.
Shader "Blox/Stud"
{
    Properties
    {
        _Smoothness ("Smoothness", Range(0, 1)) = 0.75
        _ClearCoat ("Clear coat", Range(0, 1)) = 0.35
        _ClearCoatSmoothness ("Clear coat smoothness", Range(0, 1)) = 0.92
        _MetalSmoothness ("Metal smoothness", Range(0, 1)) = 0.6
        _BaseOcclusion ("Occlusion at stud base", Range(0, 1)) = 0.35
        [HDR] _WindowEmission ("Night emission of glass studs", Color) = (2.6, 1.75, 0.95, 1)
        _EmissiveIntensity ("Emissive intensity (HDR)", Range(0, 20)) = 4
        _EmissiveDay ("Emissive share by day", Range(0, 1)) = 0.15
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "RenderType" = "Opaque"
            "Queue" = "Geometry"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 4.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        CBUFFER_START(UnityPerMaterial)
            float _Smoothness;
            float _ClearCoat;
            float _ClearCoatSmoothness;
            float _MetalSmoothness;
            float _BaseOcclusion;
            float4 _WindowEmission;
            float _EmissiveIntensity;
            float _EmissiveDay;
        CBUFFER_END
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma vertex BloxStudVertex
            #pragma fragment StudForwardFrag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile _ _FORWARD_PLUS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fog

            #define _CLEARCOAT 1
            #include "Include/BloxStudCommon.hlsl"

            half4 StudForwardFrag(BloxStudVaryings input) : SV_Target
            {
                int cls = (int)round(input.colorClass.a);
                float3 normalWS = normalize(input.normalWS);
                float3 albedo = input.colorClass.rgb;

                SurfaceData sd = (SurfaceData)0;
                sd.albedo = albedo;
                sd.metallic = 0.0;
                sd.specular = half3(0.0, 0.0, 0.0);
                sd.smoothness = _Smoothness;
                sd.normalTS = half3(0.0, 0.0, 1.0);
                sd.occlusion = lerp(1.0 - _BaseOcclusion, 1.0, saturate(input.heightSeed.x / 0.04));
                sd.alpha = 1.0;
                sd.clearCoatMask = _ClearCoat;
                sd.clearCoatSmoothness = _ClearCoatSmoothness;

                if (cls == BLOX_CLASS_METAL)
                {
                    sd.metallic = 0.85;
                    sd.smoothness = _MetalSmoothness;
                    sd.clearCoatMask = 0.0;
                }
                else if (cls == BLOX_CLASS_EMISSIVE)
                {
                    sd.emission = albedo * _EmissiveIntensity * lerp(_EmissiveDay, 1.0, _BloxNight);
                }
                else if (cls == BLOX_CLASS_GLASS)
                {
                    sd.albedo = albedo * 0.65;
                    sd.smoothness = 0.95;
                    sd.emission = _WindowEmission.rgb * (_BloxNight * 0.3);
                }

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
                d.bakedGI = SampleSH(normalWS);
                d.normalizedScreenSpaceUV = GetNormalizedScreenSpaceUV(input.positionCS);
                d.shadowMask = half4(1.0, 1.0, 1.0, 1.0);

                half4 color = UniversalFragmentPBR(d, sd);
                color.rgb = MixFog(color.rgb, d.fogCoord);
                color.a = 1.0;
                return color;
            }
            ENDHLSL
        }

        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }
            ZWrite On
            ColorMask 0
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxStudVertex
            #pragma fragment BloxStudShadowFrag
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #define BLOX_SHADOW_CASTER_PASS 1
            #include "Include/BloxStudCommon.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "DepthOnly"
            Tags { "LightMode" = "DepthOnly" }
            ZWrite On
            ColorMask R
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxStudVertex
            #pragma fragment BloxStudDepthOnlyFrag
            #include "Include/BloxStudCommon.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxStudVertex
            #pragma fragment BloxStudDepthNormalsFrag
            #pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT
            #include "Include/BloxStudCommon.hlsl"
            ENDHLSL
        }
    }

    FallBack Off
}
