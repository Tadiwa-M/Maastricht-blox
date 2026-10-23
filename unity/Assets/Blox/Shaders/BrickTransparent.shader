// Transparent brick faces (submesh 1 of every chunk mesh): palette classes "trans" (water,
// e.g. the Maas: animated ripples, depth-tinted) and "glass" (windows: dark and reflective
// by day, a hashed share of them glowing warm at night via _BloxNight).
// Premultiplied alpha so reflections stay bright on see-through surfaces.
// Needs the URP asset's Depth Texture (Blox/Setup Project enables it).
Shader "Blox/BrickTransparent"
{
    Properties
    {
        [Header(Plastic and edges (as BrickBody))]
        _Smoothness ("Smoothness", Range(0, 1)) = 0.8
        _SmoothnessJitter ("Per-brick smoothness jitter", Range(0, 0.3)) = 0.04
        _ClearCoat ("Clear coat", Range(0, 1)) = 0.3
        _ClearCoatSmoothness ("Clear coat smoothness", Range(0, 1)) = 0.95
        _BrickTilt ("Per-brick normal tilt", Range(0, 0.05)) = 0.01
        _MetalSmoothness ("Metal smoothness (unused here)", Range(0, 1)) = 0.6
        _BevelWidth ("Bevel width (studs)", Range(0.005, 0.1)) = 0.04
        _BevelStrength ("Bevel strength", Range(0, 1)) = 0.8
        _SeamWidth ("Seam width (studs)", Range(0, 0.05)) = 0.01
        _SeamDarkness ("Seam darkness", Range(0, 1)) = 0.35
        _CreviceWidth ("Crevice width (studs)", Range(0, 0.4)) = 0.08
        _CreviceAO ("Crevice occlusion", Range(0, 1)) = 0.2
        _FakeStudStrength ("Fake stud strength", Range(0, 1)) = 1
        _StudRingAO ("Stud contact ring occlusion", Range(0, 1)) = 0.25
        _StudShadow ("Fake stud sun shadow", Range(0, 1)) = 0.5
        _EmissiveIntensity ("Emissive intensity (unused here)", Range(0, 20)) = 0
        _EmissiveDay ("Emissive share by day (unused here)", Range(0, 1)) = 0

        [Header(Water)]
        _WaterDeepColor ("Deep colour", Color) = (0.05, 0.13, 0.16, 1)
        _WaterAlphaShallow ("Alpha shallow", Range(0, 1)) = 0.45
        _WaterAlphaDeep ("Alpha deep", Range(0, 1)) = 0.93
        _WaterDensity ("Depth density (1/m)", Range(0, 10)) = 2.5
        _WaterSmoothness ("Smoothness", Range(0, 1)) = 0.93
        _WaveScale ("Wave scale", Range(0.1, 4)) = 1
        _WaveSpeed ("Wave speed", Range(0, 3)) = 0.6
        _WaveStrength ("Wave strength", Range(0, 4)) = 1.5

        [Header(Glass)]
        _GlassAlpha ("Alpha", Range(0, 1)) = 0.88
        _GlassSmoothness ("Smoothness", Range(0, 1)) = 0.95
        _GlassDarken ("Day darkening", Range(0, 1)) = 0.35
        [HDR] _WindowEmission ("Night window emission", Color) = (2.6, 1.75, 0.95, 1)
        _WindowLitFraction ("Share of lit windows", Range(0, 1)) = 0.55
    }

    SubShader
    {
        Tags
        {
            "RenderPipeline" = "UniversalPipeline"
            "RenderType" = "Transparent"
            "Queue" = "Transparent"
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
            float4 _WaterDeepColor;
            float _WaterAlphaShallow;
            float _WaterAlphaDeep;
            float _WaterDensity;
            float _WaterSmoothness;
            float _WaveScale;
            float _WaveSpeed;
            float _WaveStrength;
            float _GlassAlpha;
            float _GlassSmoothness;
            float _GlassDarken;
            float4 _WindowEmission;
            float _WindowLitFraction;
        CBUFFER_END
        ENDHLSL

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }
            Blend One OneMinusSrcAlpha
            ZWrite Off
            ZTest LEqual
            Cull Back

            HLSLPROGRAM
            #pragma vertex BloxBrickVertex
            #pragma fragment TransparentFrag

            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _ADDITIONAL_LIGHT_SHADOWS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BLENDING
            #pragma multi_compile_fragment _ _REFLECTION_PROBE_BOX_PROJECTION
            #pragma multi_compile _ _FORWARD_PLUS
            #pragma multi_compile _ _CLUSTER_LIGHT_LOOP
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma instancing_options renderinglayer
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DOTS.hlsl"

            #define _SURFACE_TYPE_TRANSPARENT 1
            #define _ALPHAPREMULTIPLY_ON 1
            #define _CLEARCOAT 1
            #include "Include/BloxBrickCommon.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"
            #include "Include/BloxWater.hlsl"

            half4 TransparentFrag(BloxBrickVaryings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                BloxBrickSurface s = BloxEvaluateBrick(input);
                float alpha = 1.0;
                float2 h = BloxSeedHash2(s.seed);

                // Derivatives and the depth-texture sample stay outside the per-class branch
                // (gradient operations in divergent flow control are undefined).
                float pixelM = BloxPixelFootprint(input.positionWS);
                float2 screenUV = GetNormalizedScreenSpaceUV(input.positionCS);
                float sceneEye = LinearEyeDepth(SampleSceneDepth(screenUV), _ZBufferParams);
                float surfaceEye = LinearEyeDepth(input.positionCS.z, _ZBufferParams);

                if (s.materialClass == BLOX_CLASS_GLASS)
                {
                    // Day: dark, glossy; night: some windows lit (stable per brick via its seed).
                    s.albedo *= 1.0 - _GlassDarken;
                    s.smoothness = _GlassSmoothness;
                    alpha = _GlassAlpha;
                    float lit = step(h.x, _WindowLitFraction);
                    s.emission = _WindowEmission.rgb * (lit * _BloxNight * (0.55 + 0.45 * h.y));
                }
                else
                {
                    // Water (and any other "trans" colour).
                    if (s.faceNormalWS.y > 0.5)
                        s.normalWS = BloxWaterNormal(s.normalWS, input.positionWS, _BloxTime, _WaveScale, _WaveSpeed, _WaveStrength, pixelM);

                    float depthT = 1.0 - exp(-max(sceneEye - surfaceEye, 0.0) * _WaterDensity);
                    s.albedo = lerp(s.albedo, _WaterDeepColor.rgb, depthT * 0.7);
                    s.smoothness = _WaterSmoothness;
                    s.metallic = 0.0;
                    alpha = lerp(_WaterAlphaShallow, _WaterAlphaDeep, depthT);
                }

                InputData inputData = BloxInputData(input, s.normalWS);
                SurfaceData surfaceData = BloxSurfaceData(s, alpha);
                half4 color = UniversalFragmentPBR(inputData, surfaceData);
                color.rgb = MixFogColor(color.rgb, unity_FogColor.rgb * color.a, inputData.fogCoord);
                return color;
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
