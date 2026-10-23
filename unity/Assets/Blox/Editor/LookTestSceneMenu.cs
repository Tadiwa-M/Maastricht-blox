using System;
using System.IO;
using System.Linq;
using Blox.Data;
using Blox.Gameplay;
using Blox.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Blox.Editor
{
    /// <summary>
    /// Menu <b>Blox/Create Look Test Scene</b>: a new scene with the sun (time of day), the
    /// sky, a global post-processing volume, the map camera rig (with shadow-range control)
    /// and a WorldLoader + StudRenderer pointed at <c>build/testscene</c>, framed on the
    /// world found there, plus a bus looping along the road and a walking figure
    /// (<see cref="LookTestActors"/>; press C in Play mode to walk it with WASD).
    /// Saved to Assets/Blox/Generated/Scenes/LookTest.unity.
    /// </summary>
    internal static class LookTestSceneMenu
    {
        private const string WorldDirectory = "../build/testscene";

        [MenuItem("Blox/Create Look Test Scene", priority = 20)]
        private static void CreateLookTestScene()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Build();
        }

        /// <summary>Builds and saves the scene without prompts (menu and batch mode share it).</summary>
        internal static void Build()
        {
            var assets = ProjectSetupMenu.EnsureAssets();
            var frame = WorldFrame.Read(WorldLoader.ResolveDirectory(WorldDirectory));

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var sun = CreateSun();
            ConfigureEnvironment(sun, assets.Sky);
            var volume = CreateVolume(assets.PostProcess);
            var camera = CreateCamera(volume, frame);
            var loader = CreateWorld(assets, camera);
            LookTestActors.Spawn(WorldLoader.ResolveDirectory(WorldDirectory), assets, camera, loader);
            new GameObject("ShotRunner").AddComponent<ShotRunner>();  // idle unless -bloxShot is passed

            EditorSceneManager.MarkSceneDirty(scene);
            EditorSceneManager.SaveScene(scene, BloxEditorPaths.LookTestScene);
            AddToBuildSettings(BloxEditorPaths.LookTestScene);
            if (!frame.Found)
                Debug.LogWarning($"Blox: no world at '{WorldLoader.ResolveDirectory(WorldDirectory)}' yet; generate it (see unity/README.md), then press Play.");
            Debug.Log($"Blox: look test scene saved to {BloxEditorPaths.LookTestScene}.");
        }

        private static Light CreateSun()
        {
            var go = new GameObject("Sun");
            var light = go.AddComponent<Light>();
            light.type = LightType.Directional;
            light.shadows = LightShadows.Soft;
            light.shadowStrength = 0.92f;
            light.useColorTemperature = true;
            light.colorTemperature = 5600f;
            light.intensity = 2f;
            go.transform.rotation = Quaternion.Euler(45f, 30f, 0f);
            if (!go.TryGetComponent<UniversalAdditionalLightData>(out _)) go.AddComponent<UniversalAdditionalLightData>();
            var tod = go.AddComponent<TimeOfDayController>();
            using (var s = new SerializedSettings(tod))
            {
                s.Ref("sun", light);
                s.EnumByName("clock", nameof(TimeOfDayController.ClockMode.RealTime));
            }
            return light;
        }

        private static void ConfigureEnvironment(Light sun, Material sky)
        {
            RenderSettings.sun = sun;
            if (sky != null) RenderSettings.skybox = sky;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.52f, 0.62f, 0.78f);
            RenderSettings.ambientEquatorColor = new Color(0.46f, 0.47f, 0.47f);
            RenderSettings.ambientGroundColor = new Color(0.24f, 0.22f, 0.19f);
            RenderSettings.defaultReflectionMode = DefaultReflectionMode.Skybox;
            // Light aerial haze: distant chunks fade into the sky, which sells the scale.
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.0006f;
            RenderSettings.fogColor = new Color(0.70f, 0.76f, 0.84f);
        }

        private static Volume CreateVolume(VolumeProfile profile)
        {
            var go = new GameObject("Global Volume");
            var volume = go.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.priority = 0f;
            volume.sharedProfile = profile;
            return volume;
        }

        private static Camera CreateCamera(Volume volume, WorldFrame frame)
        {
            var go = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = go.AddComponent<Camera>();
            cam.fieldOfView = 40f;
            cam.allowHDR = true;
            cam.allowMSAA = true;
            cam.clearFlags = CameraClearFlags.Skybox;
            if (!go.TryGetComponent<UniversalAdditionalCameraData>(out var data)) data = go.AddComponent<UniversalAdditionalCameraData>();
            data.renderPostProcessing = true;
            data.renderShadows = true;
            data.antialiasing = AntialiasingMode.None; // MSAA 4x comes from the URP asset
            data.dithering = true;
            data.stopNaN = true;

            var rig = go.AddComponent<MapCameraRig>();
            using (var s = new SerializedSettings(rig))
            {
                s.Vec3("target", frame.Target);
                s.Float("groundHeight", frame.Target.y);
                s.Float("distance", frame.Distance);
                s.Vec2("boundsMin", frame.BoundsMin);
                s.Vec2("boundsMax", frame.BoundsMax);
                s.Ref("postVolume", volume);
            }
            var shadows = go.AddComponent<ShadowDistanceController>();
            using (var s = new SerializedSettings(shadows))
                s.Float("groundHeight", frame.Target.y);
            return cam;
        }

        private static WorldLoader CreateWorld(BloxAssets assets, Camera cam)
        {
            var go = new GameObject("World");
            var studs = go.AddComponent<StudRenderer>();
            using (var s = new SerializedSettings(studs))
            {
                s.Ref("material", assets.Stud);
                s.Ref("cullShader", assets.StudCull);
                s.Ref("cullingCamera", cam);
            }
            var loader = go.AddComponent<WorldLoader>();
            using (var s = new SerializedSettings(loader))
            {
                s.Str("worldDirectory", WorldDirectory);
                s.Ref("opaqueMaterial", assets.BrickBody);
                s.Ref("transparentMaterial", assets.BrickTransparent);
                s.Ref("studRenderer", studs);
                s.Ref("viewCamera", cam);
            }
            return loader;
        }

        private static void AddToBuildSettings(string path)
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            if (scenes.Any(s => s.path == path)) return;
            scenes.Add(new EditorBuildSettingsScene(path, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }

        /// <summary>Where to point the camera: the centre of the world's chunks, on its ground.</summary>
        private readonly struct WorldFrame
        {
            public readonly bool Found;
            public readonly Vector3 Target;
            public readonly float Distance;
            public readonly Vector2 BoundsMin, BoundsMax;

            private WorldFrame(bool found, Vector3 target, float distance, Vector2 min, Vector2 max)
            {
                Found = found; Target = target; Distance = distance; BoundsMin = min; BoundsMax = max;
            }

            private static WorldFrame Default => new WorldFrame(false, new Vector3(1024f, 18f, 1024f), 250f, Vector2.zero, new Vector2(2048f, 2048f));

            public static WorldFrame Read(string dir)
            {
                if (!File.Exists(Path.Combine(dir, "manifest.json"))) return Default;
                try
                {
                    var world = WorldFiles.Open(dir);
                    var chunks = world.AvailableChunks.ToList();
                    if (chunks.Count == 0) return Default;
                    var spec = world.Spec;
                    float size = (float)(spec.ChunkStuds * spec.StudM);
                    float x0 = chunks.Min(c => (float)spec.ChunkOriginX(c.Coord)), z0 = chunks.Min(c => (float)spec.ChunkOriginZ(c.Coord));
                    float x1 = chunks.Max(c => (float)spec.ChunkOriginX(c.Coord)) + size, z1 = chunks.Max(c => (float)spec.ChunkOriginZ(c.Coord)) + size;
                    float cx = (x0 + x1) * 0.5f, cz = (z0 + z1) * 0.5f;
                    float ground = MedianGround(world, x0, z0, x1, z1) ?? (float)(chunks.Min(c => c.MinK) * spec.PlateM);
                    float extent = Mathf.Max(x1 - x0, z1 - z0);
                    float distance = Mathf.Clamp(extent * 1.6f, 40f, 2500f);
                    return new WorldFrame(true, new Vector3(cx, ground, cz), distance, new Vector2(x0, z0), new Vector2(x1, z1));
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"Blox: could not read the world at '{dir}' to frame the camera: {e.Message}");
                    return Default;
                }
            }

            /// <summary>
            /// Median brick-top height over a 9 x 9 grid of columns (via Blox.Data), so a tree
            /// or tower at the centre does not lift the ground plane.
            /// </summary>
            private static float? MedianGround(WorldIndex world, float x0, float z0, float x1, float z1)
            {
                var tops = new System.Collections.Generic.List<int>();
                for (int a = 0; a < 9; a++)
                    for (int b = 0; b < 9; b++)
                    {
                        float x = Mathf.Lerp(x0, x1, (a + 0.5f) / 9f), z = Mathf.Lerp(z0, z1, (b + 0.5f) / 9f);
                        int i = world.Spec.UnityXToI(x), j = world.Spec.UnityZToJ(z);
                        var c = world.Spec.ChunkOf(i, j);
                        if (!world.Exists(c)) continue;
                        world.Load(c);
                        int top = world.ColumnTop(i, j);
                        if (top >= 0) tops.Add(top);
                    }
                if (tops.Count == 0) return null;
                tops.Sort();
                return (float)(tops[tops.Count / 2] * world.Spec.PlateM);
            }
        }
    }
}
