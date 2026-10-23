using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Blox.Editor
{
    /// <summary>
    /// The global post-processing profile of the toy-city look: subtle bloom (lamps, lit
    /// windows), ACES tonemapping, a slightly warm and punchy grade, a soft vignette, and a
    /// Bokeh depth of field that MapCameraRig turns into a tilt-shift effect at runtime.
    /// Re-running setup resets these values to the defaults below.
    /// </summary>
    internal static class PostProcessProfileFactory
    {
        public static VolumeProfile CreateOrUpdate()
        {
            var profile = AssetDatabase.LoadAssetAtPath<VolumeProfile>(BloxEditorPaths.VolumeProfile);
            if (profile == null)
            {
                profile = ScriptableObject.CreateInstance<VolumeProfile>();
                AssetDatabase.CreateAsset(profile, BloxEditorPaths.VolumeProfile);
            }

            var bloom = Get<Bloom>(profile);
            bloom.threshold.Override(1.05f);
            bloom.intensity.Override(0.32f);
            bloom.scatter.Override(0.55f);
            bloom.highQualityFiltering.Override(true);

            var tone = Get<Tonemapping>(profile);
            tone.mode.Override(TonemappingMode.ACES);

            var color = Get<ColorAdjustments>(profile);
            color.postExposure.Override(0.15f);
            color.contrast.Override(10f);
            color.saturation.Override(12f);
            color.colorFilter.Override(new Color(1f, 0.965f, 0.92f));

            var dof = Get<DepthOfField>(profile);
            dof.mode.Override(DepthOfFieldMode.Bokeh);
            dof.focusDistance.Override(200f);
            dof.focalLength.Override(190f);
            dof.aperture.Override(2.2f);
            dof.bladeCount.Override(6);
            dof.bladeCurvature.Override(1f);

            var vignette = Get<Vignette>(profile);
            vignette.intensity.Override(0.18f);
            vignette.smoothness.Override(0.45f);
            vignette.color.Override(Color.black);

            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
            return profile;
        }

        private static T Get<T>(VolumeProfile profile) where T : VolumeComponent
        {
            if (profile.TryGet(out T existing)) return existing;
            var c = profile.Add<T>(true);
            c.name = typeof(T).Name;
            c.hideFlags = HideFlags.HideInInspector | HideFlags.HideInHierarchy;
            AssetDatabase.AddObjectToAsset(c, profile);
            return c;
        }
    }
}
