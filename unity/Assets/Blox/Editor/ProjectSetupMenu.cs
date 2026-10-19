using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Blox.Editor
{
    /// <summary>Everything Blox/Setup Project creates, for the scene builder.</summary>
    internal struct BloxAssets
    {
        public UniversalRenderPipelineAsset Pipeline;
        public VolumeProfile PostProcess;
        public Material BrickBody, BrickTransparent, Stud, Sky;
        public ComputeShader StudCull;
    }

    /// <summary>
    /// Menu <b>Blox/Setup Project</b>: creates the URP asset + renderer (with SSAO), the
    /// post-processing profile and the materials under Assets/Blox/Generated, and makes the
    /// project use them (Graphics + every Quality level, linear colour space, light colour
    /// temperature, GPU Resident Drawer variants, Input System backend). Safe to re-run.
    /// </summary>
    internal static class ProjectSetupMenu
    {
        [MenuItem("Blox/Setup Project", priority = 0)]
        private static void SetupProject()
        {
            bool restart = Apply();
            string msg = "URP asset, renderer (Forward+, SSAO), post-processing profile and materials are in "
                         + BloxEditorPaths.Generated + " and assigned to Graphics and Quality settings.";
            if (restart) msg += "\n\nThe Input System backend was enabled: restart the editor before pressing Play.";
            EditorUtility.DisplayDialog("Blox", msg, "OK");
        }

        /// <summary>
        /// The whole setup without dialogs (menu and batch mode share it). Returns true when the
        /// Input System backend was just enabled and the editor needs a restart.
        /// </summary>
        internal static bool Apply()
        {
            var assets = EnsureAssets();
            ApplyProjectSettings(assets.Pipeline);
            bool restart = EnsureInputSystemBackend();
            AssetDatabase.SaveAssets();
            return restart;
        }

        /// <summary>Creates or refreshes every generated asset (used by the scene builder too).</summary>
        public static BloxAssets EnsureAssets()
        {
            EnsureFolder(BloxEditorPaths.Settings);
            EnsureFolder(BloxEditorPaths.Materials);
            EnsureFolder(BloxEditorPaths.Scenes);
            var a = new BloxAssets
            {
                Pipeline = UrpAssetFactory.CreateOrUpdate(),
                PostProcess = PostProcessProfileFactory.CreateOrUpdate(),
                BrickBody = BloxMaterialFactory.BrickBody(),
                BrickTransparent = BloxMaterialFactory.BrickTransparent(),
                Stud = BloxMaterialFactory.Stud(),
                Sky = BloxMaterialFactory.Sky(),
                StudCull = AssetDatabase.LoadAssetAtPath<ComputeShader>(BloxEditorPaths.StudCullCompute),
            };
            if (a.StudCull == null) Debug.LogError($"Blox setup: {BloxEditorPaths.StudCullCompute} not found.");
            AssetDatabase.SaveAssets();
            return a;
        }

        private static void ApplyProjectSettings(UniversalRenderPipelineAsset pipeline)
        {
            PlayerSettings.colorSpace = ColorSpace.Linear;
            GraphicsSettings.defaultRenderPipeline = pipeline;
            GraphicsSettings.lightsUseLinearIntensity = true;
            GraphicsSettings.lightsUseColorTemperature = true;

            int current = QualitySettings.GetQualityLevel();
            for (int i = 0; i < QualitySettings.names.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                QualitySettings.renderPipeline = pipeline;
            }
            QualitySettings.SetQualityLevel(current, false);

            KeepBatchRendererGroupVariants();
        }

        /// <summary>
        /// The GPU Resident Drawer needs the BatchRendererGroup shader variants in builds
        /// (Project Settings > Graphics > BatchRendererGroup Variants = Keep All). Set by name
        /// so this compiles on editor versions where the property moved.
        /// </summary>
        private static void KeepBatchRendererGroupVariants()
        {
            Type type = null;
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
                if ((type = asm.GetType("UnityEditor.Rendering.EditorGraphicsSettings")) != null) break;
            var prop = type?.GetProperty("batchRendererGroupShaderStrippingMode", BindingFlags.Public | BindingFlags.Static);
            if (prop == null || !prop.CanWrite || !prop.PropertyType.IsEnum)
            {
                Debug.LogWarning("Blox setup: set Project Settings > Graphics > BatchRendererGroup Variants to 'Keep All' by hand (GPU Resident Drawer in builds).");
                return;
            }
            try
            {
                prop.SetValue(null, Enum.Parse(prop.PropertyType, "KeepAll"));
            }
            catch (Exception e)
            {
                Debug.LogWarning($"Blox setup: could not set BatchRendererGroup Variants ({e.GetBaseException().Message}); set it to 'Keep All' by hand.");
            }
        }

        /// <summary>Switches Player > Active Input Handling to the Input System package. Returns true if it changed.</summary>
        private static bool EnsureInputSystemBackend()
        {
            var playerSettings = Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings");
            if (playerSettings == null) return false;
            using var s = new SerializedSettings(playerSettings);
            var p = s.Find("activeInputHandler");
            if (p == null || p.intValue == 1) return false;   // 0 = old Input Manager, 1 = Input System, 2 = both
            p.intValue = 1;
            return true;
        }

        public static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            int slash = path.LastIndexOf('/');
            string parent = path.Substring(0, slash);
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, path.Substring(slash + 1));
        }
    }
}
