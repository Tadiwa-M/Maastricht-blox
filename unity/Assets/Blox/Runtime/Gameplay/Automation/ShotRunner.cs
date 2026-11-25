using System;
using System.Collections;
using System.IO;
using UnityEngine;

namespace Blox.Gameplay
{
    /// <summary>
    /// Automated screenshot for quality checks. Idle unless the player is started with
    /// <c>-bloxShot &lt;file.png&gt;</c>: it then waits <c>-bloxShotDelay</c> seconds (default 10, so
    /// chunks finish meshing and the camera settles), saves the frame with post-processing and
    /// quits. Used by <c>scripts/unity.ps1 shot</c> / <c>scripts/unity.sh shot</c>.
    /// </summary>
    public sealed class ShotRunner : MonoBehaviour
    {
        private IEnumerator Start()
        {
            string file = Arg("-bloxShot");
            if (file == null) yield break;
            float delay = float.TryParse(Arg("-bloxShotDelay"), out var d) ? d : 10f;
            yield return new WaitForSecondsRealtime(delay);
            yield return new WaitForEndOfFrame();
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file)) ?? ".");
            // Rendered straight from the camera: ScreenCapture.CaptureScreenshot returned a blank
            // frame under URP/D3D12 in the standalone player.
            SaveCameraShot(file);
            for (int n = 0; n < 5; n++) yield return null;  // the capture is written asynchronously
            Debug.Log($"Blox shot saved to {file}");
            Application.Quit(0);
        }

        private static void SaveCameraShot(string file)
        {
            var cam = Camera.main;
            if (cam == null) { Debug.LogError("ShotRunner: no main camera to capture."); return; }
            var rt = new RenderTexture(Screen.width, Screen.height, 24, RenderTextureFormat.ARGB32);
            var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
            var prevTarget = cam.targetTexture;
            var prevActive = RenderTexture.active;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
            tex.Apply();
            cam.targetTexture = prevTarget;
            RenderTexture.active = prevActive;
            File.WriteAllBytes(file, tex.EncodeToPNG());
            Debug.Log($"Blox camera shot saved to {file} (camera {cam.name}, clear {cam.clearFlags}, pos {cam.transform.position})");
            UnityEngine.Object.Destroy(rt);
            UnityEngine.Object.Destroy(tex);
        }

        private static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
    }
}
