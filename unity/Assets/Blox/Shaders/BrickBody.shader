// Opaque brick bodies (submesh 0 of every chunk mesh): moulded-plastic PBR with analytic
// bevels, seams and crevice occlusion, fake studs in the distance, metal and emissive
// classes. Hand-written URP 17 HLSL; SRP Batcher and GPU Resident Drawer compatible.
Shader "Blox/BrickBody"
{
    Properties
    {
        [Header(Plastic)]
        _Smoothness ("Smoothness", Range(0, 1)) = 0.75
        _SmoothnessJitter ("Per-brick smoothness jitter", Range(0, 0.3)) = 0.06
        _ClearCoat ("Clear coat", Range(0, 1)) = 0.35
        _ClearCoatSmoothness ("Clear coat smoothness", Range(0, 1)) = 0.92
        _BrickTilt ("Per-brick normal tilt", Range(0, 0.05)) = 0.012
        _MetalSmoothness ("Metal smoothness", Range(0, 1)) = 0.6

        [Header(Edges (widths in studs))]
        _BevelWidth ("Bevel width", Range(0.005, 0.1)) = 0.04
        _BevelStrength ("Bevel strength", Range(0, 1)) = 0.9
        _SeamWidth ("Seam width", Range(0, 0.05)) = 0.012
        _SeamDarkness ("Seam darkness", Range(0, 1)) = 0.55
        _CreviceWidth ("Crevice width", Range(0, 0.4)) = 0.12
        _CreviceAO ("Crevice occlusion", Range(0, 1)) = 0.35

        [Header(Studs)]
        _FakeStudStrength ("Fake stud strength", Range(0, 1)) = 1
        _StudRingAO ("Stud contact ring occlusion", Range(0, 1)) = 0.35
        _StudShadow ("Fake stud sun shadow", Range(0, 1)) = 0.8

        [Header(Emissive class)]
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
            "UniversalMaterialType" = "Lit"
            "IgnoreProjector" = "True"
        }

        HLSLINCLUDE
        #pragma target 4.5
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

        CBUFFER_START(UnityPerMaterial)
            float _Smoothness;
            float _SmoothnessJitter;
            float _ClearCoat;
            float _ClearCoatSmoothness;
            float _BrickTilt;
            float _MetalSmoothness;
            float _BevelWidth;
            float _BevelStrength;
            float _SeamWidth;
            float _SeamDarkness;
            float _CreviceWidth;
            float _CreviceAO;
            float _FakeStudStrength;
            float _StudRingAO;
            float _StudShadow;
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
            ZTest LEqual

            HLSLPROGRAM
            #pragma vertex BloxBrickVertex
            #pragma fragment BrickForwardFrag

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _SCREEN_SPACE_OCCLUSION
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION
            #pragma multi_compile _ _FORWARD_PLUS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma instancing_options renderinglayer
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #define _CLEARCOAT 1
            #include "Include/BloxBrickCommon.hlsl"

            half4 BrickForwardFrag(BloxBrickVaryings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                BloxBrickSurface s = BloxEvaluateBrick(input);
                InputData inputData = BloxInputData(input, s.normalWS);
                SurfaceData surfaceData = BloxSurfaceData(s, 1.0);
                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFog(color.rgb, inputData.fogCoord);
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
            ZTest LEqual
            ColorMask 0
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxBrickVertex
            #pragma fragment BloxShadowCasterFrag
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"
            #define BLOX_SHADOW_CASTER_PASS 1
            #include "Include/BloxBrickCommon.hlsl"
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
            #pragma vertex BloxBrickVertex
            #pragma fragment BloxBrickDepthOnlyFrag
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"
            #include "Include/BloxBrickCommon.hlsl"
            ENDHLSL
        }

        Pass
        {
            Name "DepthNormals"
            Tags { "LightMode" = "DepthNormals" }
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxBrickVertex
            #pragma fragment BloxBrickDepthNormalsFrag
            #pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"
            #include "Include/BloxBrickCommon.hlsl"
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
