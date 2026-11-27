# 22 · Unity: set up, run and debug (any machine)

From a fresh Windows machine with a GPU to "the whole city renders in Unity and there is a desktop icon".
The Unity code itself is explained in `07-unity.md`; general machine roles in `00-workstation-setup.md`.

## 1. Install

| What | Why | Notes |
|---|---|---|
| Git for Windows | clone, push; Git Bash runs `scripts/*.sh` | |
| Unity Hub + **Unity 6000.6.7f1** | the game | add **Windows Build Support**. Other `6000.*` versions usually work; `scripts/unity.ps1` picks the newest, or set `UNITY_EXE` |
| GPU driver | rendering | Unity uses DX12 on Windows |
| Python 3.11+, Edge or Chrome | the web-game icon (local file server + app window) | Windows has Edge already |

No admin rights? See the "No admin rights" note in `00-workstation-setup.md` (Unity needs a one-time admin step).

## 2. Repo and tools

```powershell
git clone https://github.com/Tadiwa-M/maastricht-blox.git
cd maastricht-blox
git checkout week1-foundation
.\scripts\setup-workstation.ps1        # uv, .NET 8, Node 22 per user + all dependencies (works on any machine)
.\scripts\check.ps1                    # non-Unity tests: should say ALL CHECKS PASSED
```

## 3. Get a world (not in git)

Worlds and site builds are too big for the repo (`build/` is ignored). Two ways:

- **Copy** from a machine that has them: `build\world_maastricht` (the whole municipality, 65,110 chunks) and, for the
  web-game icon, `build\site_maastricht`. Same paths under the new clone. Fastest.
- **Build** them (hours, needs the data hosts): the pipeline commands in the top-level `README.md`
  (`uv run blox --slice maastricht fetch`, `build`, `life`), then `.\scripts\site.ps1 build\world_maastricht build\site_maastricht`.

`build\testscene` (a 2-chunk diorama) is generated automatically when nothing else is given.

## 4. First run, headless

```powershell
.\scripts\unity.ps1 setup -World build\world_maastricht   # compile, URP setup, LookTest scene framed on that world
.\scripts\unity.ps1 test                                 # EditMode tests -> build\unity\editmode.xml
.\scripts\unity.ps1 build                                # player -> unity\Builds\StandaloneWindows64\ (+ contract\)
.\scripts\unity.ps1 shot -World build\world_maastricht -ShotArgs '-bloxShotDelay','60'
```
Then **open the picture** (`build\shots\unity_hero.png`, or the `-Out` name) and judge by it, not by the log. Notes:
- Shots are at 13:00 unless you pass `-bloxHour`; `-bloxCam x,z,dist` reframes the camera (Unity metres).
- The player's camera is framed on the world `setup` used (`build\unity\scene_world.txt`); `shot` warns on a mismatch.
- Every step prints its log path; the error lines are in it.

## 5. In the Editor

1. Unity Hub → **Add project from disk** → the `unity` folder. Open it (first import takes a while).
2. **Blox → Setup Project** once (URP asset, materials, settings), if `unity.ps1 setup` has not run on this machine.
3. **Blox → Open World...** → pick `build\world_maastricht` (the dialog starts at the last world, else `build\world`).
   It rebuilds the LookTest scene for that world. Then press **Play**.
4. Controls: left drag pan, right drag orbit/tilt, wheel zoom; WASD/QE/RF/ZX keys; **C** walks the figure.

Only one Unity instance can have the project open: close the Editor before `unity.ps1 setup|test|build|editorshot`.

## 6. Desktop icons

```powershell
.\scripts\desktop-icons.ps1
```
- **Maastricht Blox**: the web game (title, trailer, loading screen, looks) from `build\site_maastricht` in its own window,
  offline (`scripts\play.ps1`; a 127.0.0.1-only server that stops when the window closes). After viewer changes, refresh
  the site's code without touching its world files: `cd viewer; node build.mjs --viewer-only ..\build\site_maastricht`.
- **Maastricht Blox (Unity)**: the player on `build\world_maastricht`. Rebuild with `unity.ps1 build`; the icon stays valid.

## 7. When something looks wrong: the playbook

1. **Look at the image first.** What is missing tells you where to look: a dark *sky* cannot come from missing
   buildings, only from lighting; a sky with no city points at the chunks.
2. **Read the whole error, to the last stack lines.** They name the file and line (`ChunkMeshBuilder.cs:226`). Read the code
   there before changing anything.
3. **Change one thing per test.** Same camera, other hour; same hour, other camera; same everything, fresh build. The one
   that changes the picture is the cause. Keep the old binary/logs until you have looked at them.
4. **Make sure the new code is running.** If the stack trace points at a line that is now a comment, Unity has not
   recompiled: **Assets → Refresh** (Ctrl+R), wait for the spinner, check the Console for compile errors.
5. **If it hangs, find out why before retrying.** Check the log's last line and the window title
   (`(Get-Process -Id <pid>).MainWindowTitle`); a dialog waiting for a click looks exactly like a slow load.

## 8. Known problems

| Symptom | Cause | Fix |
|---|---|---|
| Near-black frame, sky included | night: the sun follows the real clock | `-bloxHour 13` (shots default to it) |
| Grey frame in Editor Play, `dstIndex is outside the range ... NativeArray` | chunks with no glass threw in mesh upload (Editor-only safety check) | fixed 2026-11-27 (`ChunkMeshBuilder`); pull |
| Editor fine, player shows no city | stale player build or scene framed on another world | `setup -World <dir>`, `build`, `shot` again |
| Stack trace points at a comment / fix has no effect | Editor did not recompile | Assets → Refresh |
| Bus and walker missing in the player (`brick_catalogue.json` not found) | `contract\` not next to the exe | fixed: `build` copies it |
| `unity.ps1` hangs after Unity finished | `Start-Process -Wait` waited for Unity's helper processes | fixed: it waits on Unity itself |
| Scripted Editor never starts; window title "Scene Backup Detected", 0 CPU | an Editor was killed while in Play mode. **Open (2026-11-27):** the dialog came back with `unity\Temp\__Backupscenes` empty, so the trigger is not just that file | open Unity normally once and answer the dialog (Discard is safe for the generated LookTest); `editorshot` stays unverified until diagnosed |
| `Permission denied` on `Library\Bee\...rsp`, "Scripts have compiler errors" | files held by a Unity process still exiting | wait until no `Unity.exe` / `Unity.ILPP.Trigger.exe` of yours runs, retry |
| Console: "GPU Resident Drawer requires BatchRendererGroup Variants = Keep All" | `Blox/Setup Project` cannot set it on 6000.6 | players render anyway; set it by hand in Project Settings → Graphics if a build ever misses meshes |

## 9. On a shared machine

Unity takes most of a GPU and many CPU cores. Watch long runs instead of waiting on them: check the log and window title
after a minute, stop only processes you started, clean up what they leave, and keep long experiments for when the machine
is free.
