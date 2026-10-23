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
            LookTestSceneMenu.Build();
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
            Debug.Log($"Blox batch: player built at unity/{path}");
        });

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
