using System;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering.Universal;

namespace Blox.Editor
{
    /// <summary>
    /// Creates (or re-tunes) the Blox URP asset and its Universal Renderer: Forward+, HDR,
    /// MSAA 4x, soft shadows with 4 cascades, depth texture (water), GPU Resident Drawer, and an
    /// SSAO renderer feature tuned for the small crevices between bricks.
    /// </summary>
    internal static class UrpAssetFactory
    {
        public static UniversalRenderPipelineAsset CreateOrUpdate()
        {
            var rendererData = AssetDatabase.LoadAssetAtPath<UniversalRendererData>(BloxEditorPaths.RendererAsset) ?? CreateRendererData();
            ConfigureRenderer(rendererData);

            var asset = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(BloxEditorPaths.PipelineAsset);
            if (asset == null)
            {
                asset = UniversalRenderPipelineAsset.Create(rendererData);
                AssetDatabase.CreateAsset(asset, BloxEditorPaths.PipelineAsset);
            }
            ConfigurePipeline(asset);
            EditorUtility.SetDirty(asset);
            EditorUtility.SetDirty(rendererData);
            AssetDatabase.SaveAssets();
            return asset;
        }

        private static UniversalRendererData CreateRendererData()
        {
            // Preferred: URP's own (internal) factory, which also fills every default resource.
            var factory = typeof(UniversalRenderPipelineAsset).GetMethod("CreateRendererAsset", BindingFlags.NonPublic | BindingFlags.Static);
            if (factory != null)
            {
                try
                {
                    // (string path, RendererType type, bool relativePath, string suffix); the enum is
                    // resolved by name so this compiles whatever URP calls/obsoletes it.
                    var ps = factory.GetParameters();
                    var args = ps.Length == 4 && ps[1].ParameterType.IsEnum
                        ? new object[] { BloxEditorPaths.RendererAsset, Enum.Parse(ps[1].ParameterType, "UniversalRenderer"), false, "Renderer" }
                        : null;
                    if (args != null && factory.Invoke(null, args) is UniversalRendererData created)
                    {
                        if (created.postProcessData == null) created.postProcessData = LoadDefaultPostProcessData();
                        return created;
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"Blox setup: URP's CreateRendererAsset failed ({e.GetBaseException().Message}); creating the renderer manually.");
                }
            }

            var data = ScriptableObject.CreateInstance<UniversalRendererData>();
            data.postProcessData = LoadDefaultPostProcessData();
            AssetDatabase.CreateAsset(data, BloxEditorPaths.RendererAsset);
            return data;
        }

        private static PostProcessData LoadDefaultPostProcessData()
        {
            var ppd = AssetDatabase.LoadAssetAtPath<PostProcessData>(BloxEditorPaths.DefaultPostProcessData);
            if (ppd == null)
                Debug.LogWarning("Blox setup: URP's default PostProcessData was not found; assign it on the renderer (Post-processing > Data) or post-processing stays off.");
            return ppd;
        }

        private static void ConfigureRenderer(UniversalRendererData data)
        {
            data.renderingMode = RenderingMode.ForwardPlus; // required by the GPU Resident Drawer
            if (data.postProcessData == null) data.postProcessData = LoadDefaultPostProcessData();
            AddOrUpdateSsao(data);
        }

        private static void ConfigurePipeline(UniversalRenderPipelineAsset asset)
        {
            asset.supportsHDR = true;
            asset.msaaSampleCount = 4;
            asset.renderScale = 1f;
            asset.supportsCameraDepthTexture = true;   // water depth tint
            asset.supportsCameraOpaqueTexture = false;
            asset.shadowDistance = 300f;              // ShadowDistanceController adapts at runtime
            asset.shadowCascadeCount = 4;
            asset.cascade4Split = new Vector3(0.04f, 0.12f, 0.35f);
            asset.shadowDepthBias = 0.8f;
            asset.shadowNormalBias = 0.5f;

            using var s = new SerializedSettings(asset);
            s.Bool("m_MainLightShadowsSupported", true);
            s.Int("m_MainLightShadowmapResolution", 4096);
            s.EnumByName("m_AdditionalLightsRenderingMode", "PerPixel");
            s.Bool("m_AdditionalLightShadowsSupported", true);
            s.Bool("m_SoftShadowsSupported", true);
            s.EnumByName("m_SoftShadowQuality", "High");
            s.EnumByName("m_ColorGradingMode", "HighDynamicRange");
            s.Bool("m_UseSRPBatcher", true);
            s.EnumByName("m_GPUResidentDrawerMode", "InstancedDrawing");
        }

        // ---- SSAO ---------------------------------------------------------------------------

        private const string SsaoTypeName = "UnityEngine.Rendering.Universal.ScreenSpaceAmbientOcclusion";

        private static void AddOrUpdateSsao(UniversalRendererData data)
        {
            // The SSAO feature class is internal in URP 17, so it is created by name.
            var type = typeof(UniversalRendererData).Assembly.GetType(SsaoTypeName);
            if (type == null)
            {
                Debug.LogWarning("Blox setup: URP's ScreenSpaceAmbientOcclusion feature type was not found; add 'Screen Space Ambient Occlusion' to the renderer by hand.");
                return;
            }

            var feature = data.rendererFeatures.FirstOrDefault(f => f != null && f.GetType() == type);
            if (feature == null)
            {
                feature = (ScriptableRendererFeature)ScriptableObject.CreateInstance(type);
                feature.name = "ScreenSpaceAmbientOcclusion";
                AssetDatabase.AddObjectToAsset(feature, data);
                AssetDatabase.TryGetGUIDAndLocalFileIdentifier(feature, out _, out long localId);
                using var r = new SerializedSettings(data);
                var list = r.Find("m_RendererFeatures");
                var map = r.Find("m_RendererFeatureMap");
                if (list != null && map != null)
                {
                    list.arraySize++;
                    list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = feature;
                    map.arraySize++;
                    map.GetArrayElementAtIndex(map.arraySize - 1).longValue = localId;
                }
            }

            // Small radius + strong intensity: darkens the seams and the bases of studs and
            // walls without haloing whole buildings.
            using var s = new SerializedSettings(feature);
            s.EnumByName("m_Settings.Source", "DepthNormals");
            s.EnumByName("m_Settings.NormalSamples", "High");
            s.Bool("m_Settings.Downsample", false);
            s.Bool("m_Settings.AfterOpaque", false);
            s.Float("m_Settings.Intensity", 2.4f);
            s.Float("m_Settings.DirectLightingStrength", 0.35f);
            s.Float("m_Settings.Radius", 0.12f);
            s.Float("m_Settings.Falloff", 180f);
            s.EnumByName("m_Settings.Samples", "High");
            s.EnumByName("m_Settings.BlurQuality", "High");
        }
    }
}
