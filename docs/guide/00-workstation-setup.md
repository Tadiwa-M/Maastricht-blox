# 00 · Workstation setup (GPU machine)

The cloud session can't run Unity or reach the data hosts. The GPU workstation does both. This
page gets a fresh machine from zero to "Unity compiles, tests pass, and a screenshot of the
look test exists" with as few manual steps as possible.

## 1. Install (manual, once)

| Tool | Why | Notes |
|---|---|---|
| Git | clone/push | Windows: Git for Windows (also gives Git Bash for `scripts/*.sh`) |
| Unity Hub + **Unity 6 LTS (6000.x)** | the game | add the **Windows Build Support** module (Linux: Linux Build Support) |
| GPU driver | rendering | latest NVIDIA/AMD driver; Unity uses DX12/DX11 on Windows and Vulkan on Linux |
| Claude Code CLI | let Claude work on this machine | `npm i -g @anthropic-ai/claude-code`, then `claude` in the repo |

uv, the .NET 8 SDK and Node 22 are installed by the setup script (Windows via `winget`).

## 2. Clone and set up

```powershell
git clone https://github.com/Tadiwa-M/maastricht-blox.git
cd maastricht-blox
git checkout week1-foundation          # until it is merged
.\scripts\setup-workstation.ps1        # Windows  (Linux/macOS: scripts/setup-workstation.sh)
```
The script installs missing tools and all Python, Node and .NET dependencies, prints your GPU,
and lists the next commands.

## 3. Verify

```powershell
bash scripts/check.sh                  # all non-Unity tests (Git Bash on Windows)
.\scripts\unity.ps1 all                # Unity: setup → EditMode tests → player build → screenshot
```
`unity.ps1` / `unity.sh` steps (each can run alone):

| Step | What happens | Output |
|---|---|---|
| `setup` | opens the project headless; **compile errors fail here**; runs Blox/Setup Project and Create Look Test Scene (`Blox.Editor.BatchMode.SetupAndScene`) | `build/unity/setup.log` |
| `test` | Unity EditMode tests | `build/unity/editmode.xml`, `.log` |
| `build` | standalone player of the look-test scene (`BatchMode.BuildPlayer`) | `unity/Builds/<target>/` |
| `shot` | runs the player with `-bloxWorld build/testscene -bloxShot …`; `ShotRunner` waits 10 s, captures and quits | `build/shots/unity_hero.png` |

Unity is found through `UNITY_EXE`, or else the newest `6000.*` in the default Hub folder.
When something fails, the log path is printed; paste the error lines to Claude.

## 4. Real data (needs this machine's network)

```powershell
cd pipeline
uv run blox fetch                      # AHN, 3D BAG, OSM for the slice (cached in data/raw/)
uv run blox build --out ../build/world # voxelise + lay out the real slice
```
Check `docs/DATA_SOURCES.md` first: the AHN and Rijkswaterstaat endpoints changed in 2026,
and some URLs are still UNVERIFIED.

## 5. Working with Claude on the workstation

- **Local session:** run `claude` in the repo. It reads `CLAUDE.md` and can run `scripts/unity.ps1`
  itself, read the logs and the screenshot, and fix compile errors in a loop.
- **From the app:** run `claude remote-control` in the repo folder. The session then shows up
  in the Claude Code app, so you can drive the workstation from your laptop or phone.
- Always push to `week1-foundation` (or a feature branch). The cloud session and the
  workstation stay in sync through GitHub.
