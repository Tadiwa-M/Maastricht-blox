using System;
using System.IO;
using Blox.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>
    /// Menu <b>Blox/Open World...</b>: pick a pipeline world folder (one with a manifest.json, e.g.
    /// <c>build/world</c>) and the Look Test scene is rebuilt for it: the WorldLoader's
    /// <c>worldDirectory</c> points there and the camera is framed on that world, so pressing
    /// Play in the Editor shows it. Folders inside the repository are stored relative to the
    /// Unity project (<c>../build/world</c>), so the scene works from any checkout location.
    /// The last choice is remembered for the next time the dialog opens.
    /// </summary>
    internal static class OpenWorldMenu
    {
        private const string LastWorldPref = "Blox.OpenWorld.Last";

        [MenuItem("Blox/Open World...", priority = 21)]
        private static void OpenWorld()
        {
            string picked = EditorUtility.OpenFolderPanel("Open a Blox world (folder with manifest.json)", StartFolder(), "");
            if (string.IsNullOrEmpty(picked)) return;
            if (!File.Exists(Path.Combine(picked, "manifest.json")))
            {
                EditorUtility.DisplayDialog("Blox: not a world", $"No manifest.json in\n{picked}\n\nPick a folder written by the pipeline (e.g. build/world).", "OK");
                return;
            }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Open(picked);
        }

        /// <summary>What the menu does after the dialog (also used by <see cref="EditorPlayShot"/>).</summary>
        internal static void Open(string worldFolder)
        {
            EditorPrefs.SetString(LastWorldPref, worldFolder);
            string stored = ProjectRelative(worldFolder);
            LookTestSceneMenu.Build(stored);
            Debug.Log($"Blox: Look Test scene now shows '{stored}'. Press Play.");
        }

        /// <summary>The last world opened, else build/world, else build/.</summary>
        private static string StartFolder()
        {
            string last = EditorPrefs.GetString(LastWorldPref, "");
            if (last.Length > 0 && Directory.Exists(last)) return last;
            string world = WorldLoader.ResolveDirectory("../build/world");
            if (Directory.Exists(world)) return world;
            return WorldLoader.ResolveDirectory("../build");
        }

        /// <summary>Relative to the Unity project folder when inside the repository, else absolute.</summary>
        internal static string ProjectRelative(string dir)
        {
            string project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            string repo = Path.GetFullPath(Path.Combine(project, ".."));
            string full = Path.GetFullPath(dir);
            if (!full.StartsWith(repo + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return full;
            return Path.GetRelativePath(project, full).Replace('\\', '/');
        }
    }
}
