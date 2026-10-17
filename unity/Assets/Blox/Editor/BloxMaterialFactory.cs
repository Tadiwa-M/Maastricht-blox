using UnityEditor;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>Material assets for the Blox shaders and the procedural sky.</summary>
    internal static class BloxMaterialFactory
    {
        public static Material BrickBody() => Ensure(BloxEditorPaths.BrickBodyMaterial, "Blox/BrickBody");
        public static Material BrickTransparent() => Ensure(BloxEditorPaths.BrickTransparentMaterial, "Blox/BrickTransparent");
        public static Material Stud() => Ensure(BloxEditorPaths.StudMaterial, "Blox/Stud");

        public static Material Sky()
        {
            var m = Ensure(BloxEditorPaths.SkyboxMaterial, "Skybox/Procedural");
            if (m == null) return null;
            m.SetFloat("_SunDisk", 2f);           // high quality sun disk
            m.SetFloat("_SunSize", 0.035f);
            m.SetFloat("_SunSizeConvergence", 6f);
            m.SetFloat("_AtmosphereThickness", 0.85f);
            m.SetColor("_SkyTint", new Color(0.52f, 0.56f, 0.62f));
            m.SetColor("_GroundColor", new Color(0.38f, 0.36f, 0.34f));
            m.SetFloat("_Exposure", 1.25f);
            EditorUtility.SetDirty(m);
            return m;
        }

        /// <summary>Loads the material, or creates it; re-points it to the shader if needed.</summary>
        private static Material Ensure(string path, string shaderName)
        {
            var shader = Shader.Find(shaderName);
            if (shader == null)
            {
                Debug.LogError($"Blox setup: shader '{shaderName}' not found (did it fail to compile? check the console).");
                return AssetDatabase.LoadAssetAtPath<Material>(path);
            }
            var m = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (m == null)
            {
                m = new Material(shader) { name = System.IO.Path.GetFileNameWithoutExtension(path) };
                AssetDatabase.CreateAsset(m, path);
            }
            else if (m.shader != shader)
            {
                m.shader = shader;
                EditorUtility.SetDirty(m);
            }
            return m;
        }
    }
}
