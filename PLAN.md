# Maastricht Blox: Plan

Living plan. Update it when scope, tools or phase status change; log the change in
`docs/DEVLOG.md`.

## 1. What we're building (outline)

A brick-built, game-quality miniature of Maastricht, playable in the browser.
- **World:** real terrain, buildings and roads from open data (AHN, 3D BAG, OSM), turned
  into brick chunks by a Python pipeline. Detailed townhouses come from a facade grammar
  with custom pieces.
- **Look:** a premium brick diorama, with bevelled bricks, studs, plastic materials, ambient
  occlusion, soft shadows and tilt-shift.
- **Explore:** a Google Maps-style camera, click a building for info, and search.
- **Alive:** live buses on real routes, real weather, time of day and the Maas water level.
- **Play:** a third-person walk mode with an original blocky character, a photo mode, and
  collectibles.
- **Launch:** a public web link, a demo video and a LinkedIn post.

## 2. Tools

| Need | Tool | Status |
|---|---|---|
| Data pipeline | Python 3.11+, uv, numpy/numba, shapely, rasterio, laspy, pyosmium, pyproj | in use |
| Live data | FastAPI proxy, httpx, gtfs-realtime-bindings | in use (fixtures only) |
| Game (launch) | three.js web engine (`viewer/`), Gamepad API, GitHub Pages (`scripts/publish.*`) | in use |
| Game (later) | Unity 6 LTS, URP 17, Burst/Collections/Mathematics, Input System | parked after launch; code in repo |
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

### Phase 1: Foundation & look: done
Contract-first data formats, pipeline, facade grammar with detail pieces, rotated building
islands, movers, viewer with LOD, real 2×2 km Maastricht built (4096 chunks, 2448 islands),
docs. Unity code is written but parked (see the decision below).

**Decision (2026-10-23): launch in the browser, not as a Unity download.** A LinkedIn audience
clicks a link; it doesn't install an .exe. The three.js engine already renders real Maastricht
with islands, LOD and movers, and it runs on phones too. Unity is parked until after launch (a
later high-end desktop/AR version), and its code stays in the repo and in CI.

### Phase 2: Playable web city: done (2026-10-26)
Three parallel tracks plus hosting:
1. **Whole-city streaming:** the world is served as files and loaded around the camera.
   Pre-baked far meshes keep the whole 2×2 km visible.
2. **Life:** buses on real routes driven by the published GTFS timetable (no server needed),
   pedestrians walking OSM footways and squares, boats on the Maas.
3. **Player:** drop into third-person walk mode anywhere; keyboard, gamepad (Gamepad API)
   and touch; collision with bricks and islands.
4. **Hosting:** a static site (GitHub Pages or similar) built by one script.
**Exit:** a link opens Maastricht in the browser at 30+ fps on a laptop, with buses and people
moving, and you can walk the Markt with a controller.

### Phase 3: Launch & after (current)
Status 2026-10-26: the whole `city` slice is built (22,355 chunks, 8,050 islands, 265 MB site)
and published with `scripts/publish.ps1` to https://tadiwa-m.github.io/Maastricht_larper/.
Next: laptop performance check on the city, the demo video and the LinkedIn post. After that:
real 3D BAG roofs for the outskirts (refetch when the API is reachable), shopfronts from OSM,
fake interiors, cross-border transit.

**Post-launch backlog (owner, 2026-10-26)**, in rough priority order:
1. Bugs: NPC behaviour (walkers), cars disappearing.
2. Real-time buses: positions from OVapi GTFS-RT through a small hosted relay (e.g. a Cloudflare
   Worker), because the browser can't call the feed directly; falls back to the timetable.
   Today the buses follow the published GTFS timetable.
3. Ride a bus: board at a stop, follow the bus's route path with the camera, show the next
   stop; leave at any stop.
4. Real 3D BAG roofs for the outskirts, OSM shopfronts (Peter's Irish Pub, Mosae Forum),
   fake interiors, cross-border transit (De Lijn, TEC, DB).
Polish, the demo video (captured from the web build), the LinkedIn post. Then: live GPS buses
through a hosted proxy, weather, controller polish, the Unity desktop/AR version.
**Exit:** a public link, a video and a post.

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
