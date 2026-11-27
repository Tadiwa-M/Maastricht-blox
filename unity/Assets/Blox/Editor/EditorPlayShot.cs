using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Blox.Editor
{
    /// <summary>
    /// Scripted "open a world, press Play in the Editor, look at it" (<c>scripts/unity.ps1 editorshot</c>).
    /// Started as <c>Unity -projectPath unity -executeMethod Blox.Editor.EditorPlayShot.Start
    /// -bloxOpenWorld &lt;dir&gt; -bloxShot &lt;file.png&gt;</c> (not batch mode: Play needs a window).
    /// <see cref="Start"/> runs exactly what <b>Blox/Open World...</b> runs after its dialog, then
    /// enters Play mode. In Play mode the scene's ShotRunner sees <c>-bloxShot</c>, waits for the
    /// chunks and saves the frame; this watcher (re-armed after the Play-mode domain reload by
    /// <c>InitializeOnLoad</c>) quits the Editor once the file is written: exit 0, or 1 on timeout.
    /// It deliberately does not pass <c>-bloxWorld</c>, so the world comes from the scene's
    /// WorldLoader field, which is what the menu sets.
    /// </summary>
    [InitializeOnLoad]
    internal static class EditorPlayShot
    {
        private const string StartedKey = "Blox.EditorPlayShot.Started";
        private const double TimeoutSeconds = 300;

        static EditorPlayShot()
        {
            if (Arg("-bloxShot") == null || Arg("-bloxOpenWorld") == null) return;
            EditorApplication.update += Watch;
            // The scripted Editor is never the focused window: without this, Play mode pauses when the
            // Editor is in the background and the shot never comes (first run 2026-11-27 stalled).
            EditorApplication.playModeStateChanged += s =>
            {
                if (s == PlayModeStateChange.EnteredPlayMode) Application.runInBackground = true;
            };
        }

        public static void Start()
        {
            string world = Arg("-bloxOpenWorld"), shot = Arg("-bloxShot");
            if (world == null || shot == null)
            {
                Debug.LogError("EditorPlayShot: pass -bloxOpenWorld <dir> and -bloxShot <file.png>.");
                EditorApplication.Exit(1);
                return;
            }
            if (File.Exists(shot)) File.Delete(shot);
            SessionState.SetFloat(StartedKey, (float)EditorApplication.timeSinceStartup);
            OpenWorldMenu.Open(Path.GetFullPath(world));
            Debug.Log($"EditorPlayShot: entering Play mode, shot -> {shot}");
            EditorApplication.EnterPlaymode();
        }

        private static void Watch()
        {
            string shot = Arg("-bloxShot");
            float started = SessionState.GetFloat(StartedKey, -1f);
            if (started < 0f) return;  // Start has not run yet
            if (File.Exists(shot) && new FileInfo(shot).Length > 0)
            {
                Debug.Log($"EditorPlayShot: saved {shot}; quitting.");
                Finish(0);
            }
            else if (EditorApplication.timeSinceStartup - started > TimeoutSeconds)
            {
                Debug.LogError($"EditorPlayShot: no shot after {TimeoutSeconds} s.");
                Finish(1);
            }
        }

        private static void Finish(int code)
        {
            EditorApplication.update -= Watch;
            SessionState.EraseFloat(StartedKey);
            EditorApplication.Exit(code);
        }

        private static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
    }
}
