# Maastricht Blox: Plan

Living plan. Update it when scope, tools or phase status change; log the change in
`docs/DEVLOG.md`.

## 1. What we're building (outline)

A brick-built, game-quality miniature of Maastricht for PC.
- **World:** real terrain, buildings and roads from open data (AHN, 3D BAG, OSM), turned
  into brick chunks by a Python pipeline. Detailed townhouses come from a facade grammar
  with custom pieces.
- **Look:** a premium brick diorama, with bevelled bricks, studs, plastic materials, ambient
  occlusion, soft shadows and tilt-shift.
- **Explore:** a Google Maps-style camera, click a building for info, and search.
- **Alive:** live buses on real routes, real weather, time of day and the Maas water level.
- **Play:** a third-person walk mode with an original blocky character, a photo mode, and
  collectibles.
- **Launch:** a Windows build, a demo video and a LinkedIn post.

## 2. Tools

| Need | Tool | Status |
|---|---|---|
| Data pipeline | Python 3.11+, uv, numpy/numba, shapely, rasterio, laspy, pyosmium, pyproj | in use |
| Live data | FastAPI proxy, httpx, gtfs-realtime-bindings | in use (fixtures only) |
| Game | Unity 6 LTS, URP 17, Burst/Collections/Mathematics, Input System | code written, not yet compiled |
| Fast preview | three.js viewer, esbuild, Playwright + headless Chromium | in use |
| Engine-free C# tests | .NET 8 SDK, xUnit | in use |
| Hero assets (later) | Blender, MagicaVoxel → pipeline importer | phase 3 |
| Quality gate | `scripts/check.sh`, GitHub Actions CI | in use |
| Unity automation | `scripts/unity.ps1` / `unity.sh` (headless compile, EditMode tests, player build, screenshot) | ready, first run on workstation |
| GPU workstation | Unity 6 LTS + GPU; setup via `scripts/setup-workstation.ps1` | being set up (laptop already verified) |
| Capture | `scripts/shots.sh` (viewer screenshots), OBS for the demo video | shots in use |
| Keys/accounts | NS API key (trains), PDOK/3D BAG/OVapi need none | NS key pending |

## 3. Phases

Each phase ends with a **quality gate**: `scripts/check.sh` green, screenshots reviewed, docs
and DEVLOG updated, and everything pushed.

### Phase 1: Foundation & look (current)
Contract-first data formats; a pipeline that outputs chunks; a viewer that shows the look;
facade grammar with custom pieces; movers (bus, boat, character); Unity code skeleton;
docs.
**Exit:** the look-test chunk looks like a detailed modular street in the viewer, all
three languages pass the shared rotation vectors, and the docs explain every subsystem.

### Phase 2: Real Maastricht in Unity
Fetch real data on the PC; build the 2×2 km slice; compile and tune Unity until it matches
the viewer; HLOD and chunk LOD at 60 fps / 1080p; Google Maps camera, building info and
search; proxy against live OVapi, Buienradar and RWS; live buses, weather, time of day and
water level; the first hero landmark (Sint-Janstoren).
**Exit:** you can fly over the real centre at 60 fps with live buses moving smoothly.

### Phase 3: Play & launch
Walk mode with the original character, photo mode, collectibles (only if time allows),
polish, a Windows build, the demo video and the LinkedIn post. Cut order if time runs out:
planes → collectibles → extra landmarks. Never cut visual quality or the character.
**Exit:** a shipped build, a video and a post.

## 4. Process (how we work)

1. **Outline → tools → plan → phases**: this file.
2. **Contract first**: shared formats live in `CONTRACT.md`; change it only with a version
   bump and update every component.
3. **Parallel tracks** with disjoint file ownership, then an integration and review pass.
4. **Quality**: tests for every reader and writer; `scripts/check.sh` before each push; CI
   on every push; visual review of screenshots for anything that affects the look.
5. **Docs as we build**: update the matching guide in `docs/guide/`, append a dated entry to
   `docs/DEVLOG.md`, and refresh `README.md`, `CLAUDE.md` and this plan whenever a decision,
   command or status changes.
