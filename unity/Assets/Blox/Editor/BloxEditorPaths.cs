namespace Blox.Editor
{
    /// <summary>Asset locations used by the Blox editor menus.</summary>
    internal static class BloxEditorPaths
    {
        public const string Generated = "Assets/Blox/Generated";
        public const string Settings = Generated + "/Settings";
        public const string Materials = Generated + "/Materials";
        public const string Scenes = Generated + "/Scenes";

        public const string PipelineAsset = Settings + "/Blox_URP.asset";
        public const string RendererAsset = Settings + "/Blox_URP_Renderer.asset";
        public const string VolumeProfile = Settings + "/Blox_PostProcess.asset";

        public const string BrickBodyMaterial = Materials + "/BrickBody.mat";
        public const string BrickTransparentMaterial = Materials + "/BrickTransparent.mat";
        public const string StudMaterial = Materials + "/Stud.mat";
        public const string SkyboxMaterial = Materials + "/Sky.mat";

        public const string StudCullCompute = "Assets/Blox/Shaders/StudCull.compute";
        public const string LookTestScene = Scenes + "/LookTest.unity";

        public const string DefaultPostProcessData = "Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset";
    }
}
