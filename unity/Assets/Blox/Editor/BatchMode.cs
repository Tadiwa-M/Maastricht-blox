using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>
    /// Entry points for headless automation (<c>Unity -batchmode -executeMethod ...</c>), driven by
    /// <c>scripts/unity.ps1</c> / <c>scripts/unity.sh</c>. Each method exits the editor with code 0
    /// on success and 1 on failure, so scripts and CI can gate on it. Compile errors stop Unity
    /// before any of these run, which is itself the "does it compile" check.
    /// </summary>
    internal static class BatchMode
    {
        /// <summary>Blox/Setup Project + Blox/Create Look Test Scene, no dialogs.</summary>
        public static void SetupAndScene() => Run(() =>
        {
            ProjectSetupMenu.Apply();
            LookTestSceneMenu.Build(LookTestSceneMenu.DefaultWorldDirectory);  // -bloxWorld still wins at runtime
        });

        /// <summary>Builds a standalone player of the look-test scene into unity/Builds/&lt;target&gt;/.</summary>
        public static void BuildPlayer() => Run(() =>
        {
            var target = EditorUserBuildSettings.activeBuildTarget;
            string exe = target == BuildTarget.StandaloneWindows64 ? "MaastrichtBlox.exe" : "MaastrichtBlox";
            string path = Path.Combine("Builds", target.ToString(), exe);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { BloxEditorPaths.LookTestScene },
                locationPathName = path,
                target = target,
                options = BuildOptions.None,
            });
            if (report.summary.result != BuildResult.Succeeded)
                throw new Exception($"player build {report.summary.result}: {report.summary.totalErrors} errors");
            ShipContract(Path.GetDirectoryName(Path.GetFullPath(path)));
            Debug.Log($"Blox batch: player built at unity/{path}");
        });

        /// <summary>
        /// Copies the repo's contract/ (catalogue, palette, brick models) next to the player executable:
        /// the bus and walker models read it at runtime (BrickModelLibrary.Resolve looks there in a player).
        /// </summary>
        private static void ShipContract(string playerDir)
        {
            string src = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "contract"));
            string dst = Path.Combine(playerDir, "contract");
            if (Directory.Exists(dst)) Directory.Delete(dst, true);
            foreach (var file in Directory.GetFiles(src, "*.json", SearchOption.AllDirectories))
            {
                string rel = Path.GetRelativePath(src, file);
                if (rel.StartsWith("test_vectors")) continue;
                string target = Path.Combine(dst, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target);
            }
            Debug.Log($"Blox batch: contract shipped to {dst}");
        }

        private static void Run(Action action)
        {
            try
            {
                action();
                Debug.Log("Blox batch: OK");
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                Debug.LogError($"Blox batch: FAILED: {e}");
                EditorApplication.Exit(1);
            }
        }
    }
}
