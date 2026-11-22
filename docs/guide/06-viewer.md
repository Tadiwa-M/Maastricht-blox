# 06: Browser viewer (three.js)

Folder: `viewer/`. The three.js engine: since phase 2 it is **the game** (the playable web city,
streamed from a static site), and it stays the look-development renderer and screenshot tool. It also checks data and rotations
independently of Unity. The full file table is in `viewer/README.md`.

## How to run

```bash
cd viewer
npm i
node build.mjs ../build/testscene     # bundles src/ + embeds the world and contract/models -> dist/
open dist/index.html                  # file:// works (self-contained bundle)
npm test                              # 123 tests (2026-10-23, all tracks): readers, rotation, picking, movers, LOD, streaming, query API, far bake, camera, life, player
node screenshot.mjs ../build/shots hero t=20.5   # headless Chromium (Playwright) -> hero_t_20_5.png
node tools/perf.mjs hero,facade quality=low      # draw calls + triangles per frame (renderer.info)
node tools/tile-world.mjs ../samples/markt_v3 ../build/tiled8 8  # 8x8 copies (chunks + islands): a synthetic city

# the playable city: a static site that streams the world (see "Streamed city" below)
node build.mjs ../build/world --site ../build/site    # or: scripts/site.sh [world] [out] [--serve [port]]
python3 -m http.server 8000 --directory ../build/site # open http://localhost:8000/  (file:// can't stream)
node screenshot.mjs ../build/shots city,hero,street --site ../build/site
node tools/perf.mjs city,hero,street hooks=0 --site ../build/site   # + load times and memory
node tools/bake-far.mjs <world> <out>                  # just the far bake (out/far/)
```

Place views of a built area: `node screenshot.mjs <out> markt,station --site <site>` (place presets
only exist in the streamed city, not in the diorama `dist/`), or any spot with
`city "at=<x>,<y>&dist=<m>"` (x, y = RD minus the slice origin). Where the pinned Playwright's own
browser is missing (cloud containers), point it at another one: `BLOX_CHROMIUM=/opt/pw-browsers/chromium`.

Or from the repo root: `scripts/shots.sh` regenerates the models and the test scene, then
takes `hero`, `facade`, `gallery` and a night hero shot into `build/shots/`.

URL hash: `#view=hero|map|facade|river|island|islandmap|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47&quality=auto&zoom=0.5`.
`island` looks at the street facade of the biggest island, `islandmap` straight down on all
islands (compare with the pipeline's `preview.png`). `t` is the sun time in hours (after 18:30 lamps and windows glow); `ids` limits the gallery;
`quality` is `auto|high|medium|low` (also in the HUD); `zoom` scales the preset camera distance.
Controls: left drag pans, right drag orbits, wheel zooms, and a click shows a brick's feature,
type, colour, cell and facing.
**Walk mode** (third-person player, keyboard/gamepad/touch, `#mode=walk&at=x,z`): see
[guide 09](09-player.md).

## Module map

```
build.mjs: world dir + contract/models -> dist/world.js (embedded data) + dist/viewer.js
           --site: index.html, viewer.js, stream-worker.js, world/ (files, index.json, far/, life/)
tools/bake-far.mjs -> far/l1..l3/r_X_Y.bin + far/index.json  (farbake.js)

main.js ── boot: site build -> citymode.js (streamed city), else the embedded diorama below;
   │       initHooks(ctx): [player hook] src/player/, [life hook] src/life/ (both modes)
   │  citymode.js ── loader.js CityLoader ── stream.js StreamScheduler (priority, abort, unload)
   │       │             ├─ source.js (HTTP / embedded bytes), workers.js -> stream-worker.js
   │       │             │     -> prepare.js (parse, far look, solid map; no DOM)
   │       │             └─ city.js CityQuery (query API) over solidmap.js bitsets
   │       ├── cityview.js near (bricks.js) / mid (prepare.js output) / covers baked chunks
   │       ├── farregion.js FarRegions: baked levels 1-3 by distance, per-chunk ranges
   │       └── citycam.js   map camera: zoom to cursor, tilt by zoom, ground following

main.js ── world.js (World: typed arrays, cell -> brick map, bounds)  <- bxc.js (chunk reader)
   │   island.js (one World per island, local cells; pose)                <- bxi.js (island reader)
   │          ├─ exterior.js   occupancy grid (1 byte/cell) + flood fill of outside air
   │          ├─ glow.js       which windows are lit at night (per window, hashed)
   │          └─ picking.js    click -> brick via 3D DDA through the grid
   ├── lod.js     ChunkLOD: per chunk and per island a near look (bricks.js) or far look (farmesh.js)
   ├── quality.js tiers high/medium/low, auto step-down (FrameGovernor), FpsMeter
   ├── bricks.js  BrickBatcher: one InstancedMesh per (geometry, material); colour variation,
   │              stud exposure, hide_studs; worldContext (occupancy grid, glows) shared by all
   ├── farmesh.js far LOD: merged flat boxes/prisms, hidden faces culled via the grid
   │       ├─ geometry.js   bricks, plates, tiles, slopes (0.05 m lip), round  ─┐
   │       ├─ details.js    pieces 38-47                                       ├─ shapes.js
   │       └─ placement.js  record -> matrix (rotation.js)                      ┘
   ├── materials.js (+ ripples.js)  plastic / glass / water / metal / emissive
   ├── scene.js  Stage: renderer, sun + time of day, shadows, sky.js, ground.js, post.js
   ├── presets.js  camera presets from bounds and building features
   ├── demo.js  bus, boat, walkers: models.js + mover.js (+ placeholders.js)
   ├── gallery.js (+ labels.js)  every piece at N/E/S/W with a yellow marker in front
   └── ui.js  HUD: time slider, tilt/AO/anim toggles, info panel
```

Coordinates: three.js `x = I·0.5`, `y = K·0.2`, `z = −J·0.5` (north is −z, so the scene isn't
mirrored). All geometry is modelled with its front toward −z (+j). `placement.js: brickMatrix`
rotates by `−rot·90°` about +y. See [guide 01](01-coordinates-and-rotation.md).

## Streamed city (site build, phase 2)

The world (the 2x2 km centre: 4096 chunks + ~2500 islands, ~80 MB; the 4.1x5.6 km `city` slice: 22,355 chunks + 8,050 islands, 265 MB as a site) can't be one embedded page. The
site build serves the world as files and the viewer streams them around the camera; a pre-baked
silhouette keeps the whole city visible from the first second.

**Site layout** (`node build.mjs <world> --site <out>`, wrapped by `scripts/site.sh` / `.ps1`,
defaults `build/world` -> `build/site`, which also print how to serve and publish):

```
<out>/index.html, viewer.js, stream-worker.js
<out>/world.js            window.BLOX_SITE = { base: 'world/', life: true|false }
<out>/world/              manifest, palette, catalogue, features (hard links, else copies)
           chunks/, islands/   the world files, unchanged (hard links, else copies)
           index.json     stream index: chunks [{cx, cy, file, minK, maxK, bytes}],
                          islands [{id, file, cx, cy, rect: [x0, z0, x1, z1] Unity m, minK, maxK, bytes}]
           far/index.json, far/l1|l2|l3/r_X_Y.bin   baked far regions
           models.json    contract/models + contract catalogue/palette (gallery)
           life/          the world's life export (Track L), when present
```
The embed mode (no `--site`) is unchanged: small worlds, samples, the artifact, `file://`.
It embeds `<world>/life/` as `BLOX_WORLD.life` (null when absent).

**Three rings around the camera** (`cityview.js`):
- **near:** the full look (bevelled instanced bricks, studs) for the closest items, built on the
  main thread from the item's records, one per frame, capped by count *and* triangles
  (`nearTriCap`: one big island can be 30k bricks / 8M lite triangles; the closest item may use
  2x the budget, beyond that it stays mid).
- **mid:** every streamed chunk and island in the far look of `farmesh.js` (exact boxes, hidden
  faces culled within the item), one mesh per family: all opaque classes share ONE material
  (`materials.js: cityFar`) with per-vertex `aExtra` = glow rgb + shine (plastic/metal/glass), so
  a chunk is usually one draw call.
- **far:** the baked regions (`farregion.js`); a baked chunk's index range is hidden once the
  streamed chunk and every island it owns are on screen (geometry groups, as `lod.js` clusters).

**Streaming** (`stream.js` + `loader.js`): items = chunks and islands with three.js boxes.
Wanted = within `streamRadius` (3D distance, so a camera high above wants nothing), nearest
first, halved priority for boxes in the view frustum, `concurrency` fetches in flight, in-flight
loads beyond 1.25x the radius are aborted (`AbortController`; a late result is dropped), loaded
items beyond 1.5x are unloaded, `maxLoaded` caps the count, failures retry after 5 s. Several
"eyes" are supported (`city.focus(x, z)`: the player while the camera is elsewhere). Streaming
starts after the coarsest baked level is in (silhouette first). Radii shrink to 60 % with the
camera at street level (`applyRadii`), where buildings block the view.

**Workers** (`workers.js`): `stream-worker.js` runs `prepare.js` (inflate, decode, World,
occupancy grid + flood fill, window glow, far geometry, solid map) and transfers typed arrays.
On `samples/markt_v3` that is ~26 ms per chunk and ~54 ms per island (max 490 ms) of main-thread
work saved; on the synthetic city the street view is ready in 14.2 s with workers vs 18.2 s
without (headless, SwiftShader on the same CPU), and the main thread no longer hitches.
`#worker=0` or `file://` prepare on the main thread.

**Memory:** streamed and baked geometry drops its CPU arrays after GPU upload (`farmesh.js:
releaseAfterUpload`; new meshes are drawn once unculled so they upload at once, `uploadSoon`);
an item keeps its records (~13 B/brick) and a 1-bit solid map; a World with its cell map exists
only for near items and picking; baked looks keep their compact quads until first shown.

**Query API** (`city.js`, JSDoc there): `isSolid(x, y, z)`, `isWater`, `groundHeight(x, z,
fromY?)` in three.js metres over chunks and islands (island cells through the inverse pose),
`'unknown'` where a chunk or an island overlapping it is not loaded, plus `approxGround(x, z)`
(baked per-chunk ground, always known), `box`, `focus(x, z)`. The embedded diorama offers the
same API (`cityFromWorlds`).

**Far bake** (`farbake.js`, `tools/bake-far.mjs`, run by the site build): per region of 8x8
chunks and per level (1: 2x2 studs x 3 plates = 1 m x 0.6 m; 2: 4x4x5 = 2 m x 1 m; 3: 8x8x10 =
4 m x 2 m) every brick cell (islands through their pose) votes for its coarse cell; any vote
makes it solid (thin walls and roof shells survive), the colour is the majority, top faces use
the highest fine cell's colour (paving over earth), windows vote glass. Faces into outside air
(flood fill from the sky, not into the air under the terrain shell) or into water are kept and
greedy-merged per (colour, owner chunk); glass stays per cell so windows glow individually.
Neighbouring chunks/islands are rasterised for culling but not emitted. File `BXF1`: 40-byte
header + owner table + 12-byte quads, raw-DEFLATE (format in `farbake.js`). Level 3 of every
region is always resident; levels 2/1 stream in within `farDist` (medium: 280 / 900 m).

**Camera** (`citycam.js`): MapControls + zoom to cursor; tilt allowed from 87° (street, 3° above
the horizon so the sky shows) to 52° (whole city), and while zooming it eases toward a preferred
tilt for that distance; the target rides on the ground (eye height when close), stays inside the
city box, the camera never goes under the bricks; near/far planes scale with distance. Fog,
shadow box (around the target, 45 m-1.6 km) and AO (`aoDist`) follow the zoom.

**City presets** (`#view=`): `city` (whole city), `map` (top down), `hero` (3/4 over the Markt
or the data centre), `street` (street level: once streamed, `findStreetSpot` picks open ground
near the Markt and the side with the longest free line of sight), `markt|vrijthof|brug|station|
bonnefanten` when present, and `#at=x,z&dist=m` (Unity metres). Debug: `#stream=0` (bake only),
`#farlevel=1|2|3`, `#worker=0`, `#hooks=0` (no life/player).

**Measured** (`tools/perf.mjs ... hooks=0`, headless Chromium + SwiftShader, 1600x1000, medium;
calls/triangles over all passes: shadow, AO normals, main; memory after a forced GC: V8 heap +
ArrayBuffers; "silhouette" = whole city drawable, "ready" = everything wanted streamed + near
built (SwiftShader rendering dominates)):

| world / view | draws | triangles | silhouette / ready | memory |
|---|---|---|---|---|
| `samples/markt_v3` embed (before), hero | 362 | 3.49 M | - / 6.1 s | 55 + 107 MB |
| `samples/markt_v3` embed (before), facade | 524 | 6.26 M | - / 5.8 s | 55 + 108 MB |
| `samples/markt_v3` site, city | 19 | 0.36 M | 0.55 / 2.2 s | 4 + 2 MB |
| `samples/markt_v3` site, hero | 320 | 2.66 M | 0.32 / 8.1 s | 7 + 17 MB |
| `samples/markt_v3` site, street | 318 | 5.18 M | 0.35 / 8.2 s | 11 + 25 MB |
| town fixture site, city / street | 35 / 276 | 0.16 / 3.72 M | 0.48 / 1.6, 2.9 s | 4 + 2 / 8 + 7 MB |
| synthetic city (8x8 markt_v3: 3136 chunks, 2560 islands, 18.5 M bricks, 58 MB), city | 131 | 1.44 M | 1.0-2.0 / 1.7-3.0 s | 8 + 1 MB |
| synthetic city, hero | 315 | 5.72 M | 1-2 / 9-19 s | 10 + 74 MB |
| synthetic city, street | 464 | 8.28 M | 1.4 / 14.8 s | 22 + 66 MB |

Before this work the synthetic city could not be opened at all (embedding 58 MB as base64);
street level on it first measured 28 M triangles and 538 MB (one giant island near, CPU copies
of every vertex array). The synthetic city is the Markt centre repeated: denser than the real
city everywhere, so it is the worst case. Bake: 93 s, level 1/2/3 = 8.7 M / 2.6 M / 0.72 M
triangles, 17.5 / 5.4 / 1.5 MB.

### Notable choices

- **Real bevels:** bricks are `RoundedBoxGeometry` (radius 0.02 m) with a 3 mm seam inset per
  side (`shapes.js`). Glass and water use a seamless box, so stacks read as one pane or one
  surface.
- **Instancing:** the whole chunk is a handful of draw calls. Per-instance colour gets a ±3 %
  hashed variation (`hash.js`), skipped for `no_variation`.
- **Studs:** drawn where the cell above is empty, the record has no `hide_studs`, and the cell
  above is *exterior* air (`exterior.js`). The flood fill is skipped for worlds over 64 M
  cells, in which case every exposed stud is drawn. On the test chunk: 967 exposed studs →
  824 after the flood fill.
- **Performance (LOD and quality tiers):** see the next section.
- **Picking** steps cell by cell along the ray (Amanatides & Woo), so the cost depends on ray
  length, not brick count (`picking.js`, tested in `test/picking.test.mjs`).

### Title screen (`src/loading.js`, `#loading` in `index.html`)
Modelled on console-game title screens (Spider-Man PS4, FIFA: the live game world behind the logo;
GTA V: minimal UI, tips in one corner, a small spinner in the other).
- **Key art while loading:** a dark backdrop with the logo: MAASTRICHT in Anton (Google Fonts,
  OFL; falls back to Impact-like system fonts), BLOX on a yellow brick with studs, a thin Limburg
  stripe (white, blue, yellow) and "A brick-built Limburg city". The Province of Limburg logo
  is deliberately not used: its brand guide requires the province's written consent, and a logo
  would suggest an endorsement. Limburg flag colours are accents only.
- **Key art slides:** `src/title/*.jpg` (copied to the site by `build.mjs`) crossfade behind the
  logo while loading; missing images are dropped. Render them with `tools/keyart.mjs` (views in
  `VIEWS`) on a PC with a GPU: `node tools/keyart.mjs --url https://tadiwa-m.github.io/Maastricht_larper/`
  renders from the published site (about a minute a view), `--site <dir>` from a local site
  build. The browser encodes the JPEGs (no ffmpeg needed). Each view waits in real time (up to
  240 s) until it has streamed in, printing progress every 10 s; `--quality medium` for weaker PCs. In a GPU-less container (software
  rendering) a 1080p view of the city takes hours.
- **Key art all the way (2026-11-06):** the slides (rotating in-game shots of the city) stay up
  until start; the 3D city no longer shows behind the logo (the owner: a whole-city overview in
  3D "takes you out of it"); the city appears when you press start.
- **Corners:** "DID YOU KNOW" tips bottom-left, crossfading every 5.5 s (`TIPS`); a flipping brick
  spinner with the phase message bottom-right; a thin progress line along the bottom edge.
- **Ready:** PRESS ANY KEY (TAP TO START on touch) with button prompts (Drag: Explore,
  2x Click/Tap: Walk, M/Map: Back to map). Any key, click, tap or gamepad button starts; the
  start key is swallowed. On start the logo lifts and fades, and the game UI (hidden under
  `body.title`) appears.
- Phases are the pure `loadState()`: index -> silhouette -> first ring (90%, settled or 8 s) ->
  8 drawn frames. Notices wait for `whenGone()`; load errors show on the screen. Skipped under
  `?shot=1` and webdriver, so the screenshot, perf and film tools are unchanged.
- **After start:** you are above the old town (preset `above`: the Markt from 650 m, 38 degrees up,
  so the map's edges stay out of sight; `#view=city` still shows the whole map) and zoom in yourself (the owner prefers it to a
  scripted start; a camera fly-in and a straight cut to the street were both tried on 2026-11-06
  and dropped).
- **Full screen (2026-11-06):** the title's start (key, click or tap) also asks for full screen on
  every device (`loading.js` `goFullscreen`: no address bar or tabs; Esc leaves it, as in any
  browser). On touch screens only the finger lifting counts as a tap for this (Chrome's user
  activation), so it is asked again on that `pointerup`.
  On phones full screen also turns the screen to landscape (`screen.orientation.lock`, allowed only
  while full screen; released when leaving it); the home-screen app is landscape too. Portrait
  in the browser stays as it is.
  Full screen on a phone draws under the status bar and the gesture bar (`viewport-fit=cover`):
  every pinned panel and button is offset by the safe-area insets (`--st/--sb/--sl/--sr` in
  `index.html`); on phones the footer line sits above the Transit button. iPhones' Safari has no page
  full screen; "Add to Home Screen" opens the game full screen (`game.webmanifest`,
  `apple-mobile-web-app-capable`).
- **Quality tiers** (`quality.js` TIERS) change detail, never how busy it is: render resolution,
  near brick detail, stream and far-level distances (High shows the finest far city out to 800 m,
  so the map view is crisp), shadows, ambient occlusion, bloom. People, bikes and cars keep the same
  density on every tier; the tier only sets how far out they live (`LIFE_RADIUS_BY_TIER`).
- **The settings panel** (sun, quality, views, stats) is one 600 px wide rectangle in the top-left
  corner on every screen; on small screens it keeps that layout and is scaled down (`ui.js` `fitHud`:
  at most 70 % of the width and 50 % of the height), never re-flowed into a column. It starts collapsed for everyone: the game
  opens on the city, not on a map tool. "show" or U opens it; the choice is remembered.

### Panel (HUD) toggle
The top-left panel collapses to its title with the **hide/show** button or the **U** key
(`bindHudToggle` in `ui.js`). It starts collapsed on screens up to 600 px wide, and the choice is
kept in `localStorage`. This is for clean recordings and phone play.

### Filming (`tools/film.mjs`, `scripts/film.ps1|sh`)
`.\scripts\film.ps1 -Site build\site_city` renders the demo video frame by frame and writes
`build/film/maastricht-blox.mp4` (1080p, 30 fps) plus a still of each shot in `build/film/stills/`.
The page opens with `?film=1`: the render loop is off, and the tool drives
`window.__bloxFilm` (`step(dt)`, `pose(cam, target, fov)`, `time(h)`, `settled()`, `presets()`).
Every frame advances life by exactly 1/fps and is captured only after its area has streamed in,
so the video is smooth and free of pop-in however slow the GPU is. A browser window opens
(the real GPU renders); `--headless` uses software rendering, which is very slow (cloud tests).
Shots live in `SHOTS` at the top of `film.mjs`: `orbit` (turn around a preset at a zoom) or
`move` (fly from one preset to another, rising in the middle), each with a scene hash (`t`, `day`)
and an optional sun time-lapse (`hours`). Edit that list to re-cut the film. `-Quick` makes a 10 fps
quarter-length test cut. ffmpeg comes from PATH or is installed on the spot as `ffmpeg-static`
(an npm package; no admin needed).

### Reporting mistakes (`src/report/`)
A flag button (bottom right) opens "Report a mistake": a category, the player's description, a
screenshot of the current view (on by default, previewed), and an optional photo of their own
(scaled to 1280 px JPEG on the device). `report.js` (pure, tested) adds what a fixer needs: a link
that reopens the exact view (map `#at=x,z&dist=` or walk `#mode=walk&at=x,z&yaw=`), the street,
Unity, RD and grid-cell coordinates, and the build. With the relay
(`window.BLOX_SITE.relay`: the deployed relay by default, `BLOX_RELAY` overrides it at site build, `BLOX_RELAY=none` builds without) it POSTs to `/report`, which files a
GitHub issue: no GitHub account needed, images committed to the `map-reports` branch. If the relay
has no `GITHUB_TOKEN` (it answers 501) or can't be reached, it falls back as without one. Without a
relay it opens GitHub's pre-filled new-issue page and downloads the images to attach.
Issues labelled `map-report` are triaged by hand: fixes that fit `corrections/corrections.json`
go there, others need code.

### Live buses (`src/life/live.js`, `relay/`)
`LiveFeed` polls the relay's `/live` every 20 s for the lines in the timetable (OVapi line bases
from `transit.json` `realtimeIds`) and sets per-row delays on the `Timetable` (`setDelays`); a
delayed bus is drawn that much further back on its route and marked live (LIVE badge in the
Transit panel and the ride HUD). Delays apply only while the game clock is within 5 minutes of real
Maastricht time at 1x speed (`delaysOn`); a feed silent for 150 s falls back to the timetable.

## Publishing (GitHub Pages)

The live site is the separate repo `Tadiwa-M/Maastricht_larper`, served at
https://tadiwa-m.github.io/Maastricht_larper/. It holds only the built site.
`scripts/publish.ps1 -Site build\site_city` (or `scripts/publish.sh build/site_city`) copies the
site to a temp dir, adds `.nojekyll` and a README, and force-pushes ONE commit to `main`. Each
release replaces the last, so the repo never grows with old builds, and the code repo never
carries the 250+ MB of city files. Pages setting (once): Settings -> Pages -> Deploy from a
branch -> `main` / root. All site URLs are relative, so it works under the `/Maastricht_larper/`
sub-path; this was verified by serving a site from a sub-folder.
Hosting limits: GitHub Pages allows a 1 GB site and 100 MB per file. The city is 265 MB, ~30,400
files, the biggest well under 1 MB. Cloudflare Pages' free plan (20,000 files) does not fit.

## Islands (rotated buildings, CONTRACT 5.1)

Buildings more than 3° off the world grid come as `islands/i_XXXXXX.bxi`: a 40-byte `BXI1`
header with the pose (origin in Unity metres, yaw clockwise from north) and the usual 12-byte
records with **local** `i, j` and global `k` (`src/bxi.js`, tested against the pipeline's
golden file `pipeline/tests/fixtures/golden/i_000001.bxi` + `golden_island.json`).

- **One World per island, in local cells** (`src/island.js: islandWorld`): `I = i`, `J = j`,
  `K = k`. Everything that reads a World then works in island space with no special cases:
  occupancy grid and exterior flood fill (stud exposure, far hidden faces), stud positions,
  window glow, picking, and colour variation hashed on the island-local `(i, j, k)` as the
  contract asks (same as Unity's `IslandMesherCore`). Nothing in the viewer looks at world
  axes inside an island; the chunk grid never sees island cells.
- **Pose in three.js** (`applyIslandPose`): local cells map to three.js `(u, y, -v)` exactly
  like chunks, and the island's `THREE.Group` sits at `(originX, 0, -originZ)` turned by
  **`-yaw`** about +Y (clockwise from above is negative about +Y in three.js; Unity uses
  `+yaw` because it is left-handed). `test/island.test.mjs` pushes every point of
  `contract/test_vectors/islands.json` through a real group, checks local +j lands on
  `(sin yaw, cos yaw)` in (east, north), and that the inverse used by picking round-trips.
- **LOD** (`src/lod.js`): each island is one extra "chunk" whose source is its own World,
  near/far looks are built by the same code and hung under the posed group; the near/far
  choice uses the island's world-space bounding box (local box through the pose). Near and
  stud caps are shared with the chunks. Far meshes: one cluster per island.
- **Picking** (`pickNearest`): the ray is turned into each island's local frame (rigid, so
  distances compare) and run through that island's grid; the nearest hit over chunks and
  islands wins. The highlight box is parented to the island group, so it turns with it. The
  info panel shows the feature name (or kind + address / BAG id when the feature has no name)
  and `island N (yaw°) · i j K`.
- **Check that islands sit on their plots**: `test/island.test.mjs` loads the committed
  `pipeline/tests/fixtures/town_world` (terrace at yaw +20°, house at -30°) and asserts that
  > 85 % of each island's plinth cells stand on the pavement plot the pipeline wrote into
  the chunks (measured: 91 % and 93 %; the rest is the half-stud growth over the staircased
  plot edge; flipping the yaw sign drops this to < 25 %). Visually: `#view=islandmap` against
  the pipeline's `preview.png`.
- `build.mjs` embeds the islands listed in the manifest; with `--around` it keeps the islands
  whose owning chunk `(cx, cy)` is in range. Worlds without islands load as before (the
  look-test chunk renders with the same draw calls/triangles/studs; `samples/markt` too).

## Performance: per-chunk LOD and quality tiers

Built for one 4k-brick chunk, the viewer drew a real 7x7 neighbourhood (265k bricks) at ~0 fps
on a laptop: every brick is a 300-triangle bevelled box, studs are 360 triangles, and the scene
was drawn three times a frame (shadow map twice, because the AO pass's normal render redrew
it, plus the main pass). Now:

- **Shadow map once per frame** (`scene.js`: `shadowMap.autoUpdate = false`, `needsUpdate`
  set in `render()`). Same image, a quarter fewer triangles everywhere.
- **Per-chunk LOD** (`lod.js`). Bricks are grouped by chunk. Near chunks (camera within
  `nearDist` of the chunk box, leaving at 1.3x that, at most `maxNear`, nearest first) get the
  full look, built lazily one chunk per frame (~40-90 ms) and kept in a small LRU. All other
  chunks are drawn by the **far look** (`farmesh.js`), built once at load (~1.5 s for 49 chunks):
  bricks/plates/tiles as their cell box, slopes as 5-sided prisms, windows/doors as a box plus
  a flat glass quad (night glow kept), arches as two posts and a lintel, no studs; vertex
  colours with the same ±3 % variation; `MeshStandardMaterial` (no clearcoat) for opaque plastic.
- **Hidden-face culling:** a far polygon lying on its brick's bounding-box side is dropped if
  every cell across that side is a full opaque brick, interior air (flood fill), the bottom of
  the world, or a see-through brick of the same kind. On the real Markt sample this drops
  72 % of faces (1.16M of 1.61M); the far look is ~19k triangles per chunk.
- **Exterior air from above** (`exterior.js`): the flood fill now starts from the sky above
  each column and never enters "bottomless" air (below a column's lowest brick and below all
  four neighbours' tops). Real data's terrain is a thin shell, and the air under it used to
  count as outside (reachable from the world's edge), keeping every terrain underside and
  buried side face; it also walked ~46M sky cells (7 s on the Markt sample, now 0.3 s). On the
  look-test chunk 7 studs inside closed wall cavities are no longer drawn (824 -> 817; the old
  fill reached them through the air under the world).
- **Draw calls:** far meshes are merged per 2x2 chunk cluster and material; each chunk is an
  index range and a cluster draws its far chunks as geometry groups. Near instanced meshes hold
  one chunk each, so their bounding spheres frustum-cull whole chunks.
- **Studs** only on near chunks, capped (`studCap`, nearest chunk first); with LOD they cast no
  shadow (the shadow map then spans the whole town, ~11 cm texels).
- **Quality tiers** (`quality.js`, HUD selector, `#quality=`):

  | tier | near look | AO | pixel ratio | bloom | shadow map | near zone |
  |---|---|---|---|---|---|---|
  | high | full bevels (2 segments) | full res | ≤ 2 | always | 4096 | 70 m, ≤ 9 chunks |
  | medium | 1 bevel segment, 12-sided studs | half res | 1 | night only | 2048 | 40 m, ≤ 3 chunks |
  | low | same as medium | off | 1 | night only | 2048 | 22 m, ≤ 2 chunks |

  `auto` starts at **high without LOD for a one-chunk world** (the look-test chunk renders
  exactly as before) and at **medium** for anything bigger, then drops a tier when the mean
  frame time over 2 s exceeds 40 ms (never steps back up by itself; ignored for 3 s after a
  change and across hidden-tab gaps). Tilt-shift stays full resolution: at pixel ratio 1 its two
  9-tap passes are cheap, and a half-res version would need its own down/upsample passes.
- **fps readout** (`FpsMeter`): mean of real `requestAnimationFrame` intervals over 1 s, shown
  with frame ms. The old readout was measured correctly but rounded to whole fps, so anything
  slower than one frame per 2 s showed "0 fps".
- **Big-world hero camera** (`presets.js`): worlds over ~100 m square (half-diagonal > 70 m) get a 3/4 view over the
  centre from 33° at 90-170 m instead of fitting the whole world in (which put the camera far up).
  Presets also ignore features outside the embedded chunks (`build.mjs --around` keeps the whole
  `features.json`, so the facade view used to look at a building outside the neighbourhood).

Numbers per frame (`tools/perf.mjs`, renderer.info: all passes; 7x7 = look-test chunk tiled,
208k bricks):

| world / view | before: calls / triangles | after (auto) |
|---|---|---|
| look-test chunk, hero | 498 / 6.53 M | 380 / 4.89 M (high, same image) |
| `samples/markt` (real, 49 chunks, 265,761 bricks), hero | 224 / 341.3 M (71,817 studs) | 90 / 2.67 M (medium, 0 near) |
| `samples/markt`, hero `zoom=0.4` (3 near chunks) | | 271 / 5.31 M (medium) |
| `samples/markt`, facade (street level, 3 near chunks) | | 380 / 5.89 M (medium); low: 200 / 2.91 M |
| 7x7 tiled look-test chunk (208k bricks), hero | 500 / 283.7 M | 315 / 2.42 M (medium) |

Load time of the Markt sample in headless Chromium: ~4.5 s to the first frame (was ~21 s).
Estimate for a laptop iGPU (a few hundred M triangles/s in practice, fill-limited at 1600x1000):
the medium overview (2.7 M triangles, 90 draws, half-res AO, no bloom by day) should run well
above 30 fps; street level with 3 near chunks (~6 M) is the heavy case, and `auto` falls back
to low (~1.8-2.9 M) if it is not. Not yet measured on the real laptop.

**City-scale pass (2026-10-27, the 4.1 x 5.6 km city, `tools/perf.mjs --site`, medium tier,
calls / triangles per frame incl. shadows and life):**

| view | before | after |
|---|---|---|
| city overview | 1,509 / 7.9 M | 73 / 3.9 M |
| Markt | 796 / 11.9 M | 588 / 7.8 M |
| street level | 1,310 / 12.8 M | 628 / 9.2 M |

What did it:
- **Merged far blocks** (`farregion.js` `blockMeshes`/`showBlock`, `FarRegions` `blockRegions: 4`).
  The coarsest level of every 4x4 regions is one mesh per family. Each region is an index range,
  and only regions wanted at that level and inside the camera frustum are drawn, with contiguous
  ranges as one group. 352 regions x ~3 families (~1,050 calls) became ~70.
- **Life budget** (`life/index.js`): parked bikes only the nearest within a tier range
  (`PARKED_BIKES_BY_TIER`; 640 bikes at ~2,200 triangles each were 2.8 M per frame with shadows),
  no life beyond 650 m camera-to-target, single figures culled beyond 320 m, and life shadows on
  high/medium only.
- **Tiers:** per-tier `shadowRange`; a `lite` tier (0.75 resolution, no shadows or bloom) used only
  for software rendering or by hand, because `auto` stops at `low` on a real GPU; the start tier
  comes from the GPU class (`gpu.js`); no canvas MSAA.

**Performance mode** (panel checkbox, `#perf=0|1`, remembered in `localStorage`, on by default)
switches the merged far blocks and the life budget on or off. Off draws exactly as before them,
so the two can be compared on a real device (city overview, medium: off 1,249 calls / 6.5 M
triangles, on 76 / 3.9 M). Changing it reloads the page, because the far city is built at load.

Measure a world: `node build.mjs <world> && node tools/perf.mjs hero,map,facade`. SwiftShader fps
is meaningless; compare triangles and draw calls.

## Where to change the look

| Want to change | File | Knob |
|---|---|---|
| ambient occlusion | `src/post.js` | `AO = { radius: 0.18, distanceExponent, thickness: 0.35, scale: 1.9, samples }` |
| tilt-shift | `src/post.js` | `TILT_NEAR = 15`, `TILT_FAR = 110` (m), `TILT_MAX = 2.4`; off below 15 m; `#tilt=0` |
| bloom | `src/post.js` `setNight` | strength 0.18 (day) to 0.55 (night), threshold 0.92 to 0.82, radius 0.4 to 0.45 |
| time-of-day look (light, sky, exposure, grade) | `src/render/look.js` | the colour keys in `C`, `lookAt` (day, golden, blue hour, night) |
| colour grade, vignette, edge smoothing | `src/render/grade.js` | the final pass; values from `lookAt().grade`; `aa` per tier in `quality.js` |
| sun glow in the haze | `src/render/haze.js` | the two weights in the patched fog chunk; strength = `lookAt().haze` |
| sun path, shadows | `src/scene.js` | `MIN_DAY_ELEVATION` 22°, `MAX_ELEVATION` 52°, shadow map 4096, bias |
| sky colours, stars, moon, reflections | `src/render/look.js` (colours), `src/sky.js` (same shader feeds the PMREM env map; stars and moon only in the visible sky) | |
| plastic, glass, metal | `src/materials.js` | roughness, clearcoat, `envMapIntensity` |
| water ripples | `src/ripples.js` | wave count/size; water = `trans` palette entries named `water*` |
| lit windows at night | `src/glow.js` | `LIT_SHARE = 0.6`, warm colours, TV-blue share |
| ground baseplate | `src/ground.js` | `BASE` colour, stud tile drawing |
| colour variation | `src/bricks.js` | `VARIATION = 0.03` |
| stud size | `src/geometry.js` | `STUD_R = 0.15`, `STUD_H = 0.09` |
| slope lip | `src/geometry.js` | `LIP_PLATES = 0.25` (contract v2) |
| LOD distances, tiers | `src/quality.js` | `TIERS` (`nearDist`, `maxNear`, `studCap`, `ao`, `bloom`, ...) |
| far look | `src/farmesh.js` (shapes), `src/materials.js` (`farFor`) | `src/lod.js`: `CLUSTER`, `HYSTERESIS` |
| piece shapes | `src/details.js` | `BAR`, `PANE_BACK`, per-piece builders |

## Tests

| File | Checks |
|---|---|
| `test/bxc.test.mjs` | chunk header and records |
| `test/rotation.test.mjs` | `contract/test_vectors/rotation.json` |
| `test/picking.test.mjs` | DDA picking and the exterior-air flood fill (closed box, overhang, terrain shell) |
| `test/mover.test.mjs` | PathMover poses, corners, loops |
| `test/models.test.mjs` | every `contract/models/*.json` builds with the right parts, size and pivot, facing forward |
| `test/farmesh.test.mjs` | far LOD hidden-face counts: lone brick, neighbours, solid block, sealed interior, glass/water, slope caps, window glass |
| `test/quality.test.mjs` | starting tier and LOD switch by world size, tier ordering, auto step-down, fps meter |
| `test/stream.test.mjs` | scheduler: nearest first, frustum priority, concurrency, abort (late result dropped), unload radius + maxLoaded, retry, several eyes |
| `test/city.test.mjs` | query API on the town fixture through the real path (bake index, CityLoader, prepare.js): unknown before load, chunk and island cells solid, groundHeight, an unloaded island makes its chunks unknown, nearest-first loading and unloading, floor under an overhang |
| `test/farbake.test.mjs` | coarse block -> 6 merged quads, top colour, owners + context culling, water/glass rules, BXF1 round trip (raw + deflate) into geometry ranges, bad input, the bake tool on the town fixture |
| `test/citycam.test.mjs` | tilt limits by distance, target clamping, street spot on open ground beside a tower |
| `test/island.test.mjs` | `.bxi` golden file (compressed + raw), bad input, pose vs `islands.json` through a THREE.Group, island picking + nearest hit, LOD wiring on the town fixture, islands on their paved plots |

## Trip planner (`plan.html`, `src/plan/`, phase R3a, 2026-11-05)

A phone-first page in every site build, next to the 3D city: `plan.html` + `plan.js` (15 KB) +
`plan.webmanifest` (add to the home screen: it opens like an app). It loads only
`world/life/transit.json` (no 3D city) and `world.js` (relay address, map origin).

- **From:** "📍 Me" (the browser's location API; `plan/geo.js` converts GPS to RD with the standard
  Dutch approximation polynomial, within 2 m of pyproj; the position never leaves the phone) or a
  stop name. **To:** a stop name (suggestions from the timetable). **Leave:** now or a time.
- **Search** (`plan/raptor.js`, RAPTOR): rounds of at most 4 buses over today's trips (after-
  midnight trips of yesterday included), walking access/egress up to 1.2 km and transfers up to
  350 m (straight line x 1.25 at 1.3 m/s; a same-stop transfer needs 60 s), live delays from the
  relay shifting their trips. Results: the fastest, a fewer-transfers one if within 10 min, and the
  next departures; each a card with "leave in", duration, lines, walking time, transfers and LIVE,
  expanding to the legs. 3-14 ms per search on the test area. Refreshes every 30 s with live data.
- The Transit panel in the 3D city links to it ("Plan a trip"). The last trip is remembered on the
  phone (`localStorage`). The relay only answers the published site's origin, so local test builds
  show scheduled times.
- **Map (R3b, 2026-11-05):** planning draws the best route at once, like a maps app; tapping another
  card switches to it. Leaflet 1.9.4 (bundled; `leaflet.css` copied into the site) over PDOK's
  free base map (BRT achtergrondkaart, Web Mercator tiles, CC BY 4.0, credited). Bus legs follow
  their line's shape between the stops in the line colour (`plan/route.js`); walk legs follow the
  walk graph (`plan/walk.js`, A*, `world/life/walkways.json` loaded in the background) as the green
  chevron "racing line"; "Walk all the way" is always offered, timed on the real footpaths. With
  "📍 Me" a blue dot follows your GPS (`watchPosition`, on the phone only). `plan/geo.js` also
  converts back (RD -> GPS). The page grew to 173 KB (Leaflet), ~50 KB gzipped.
- The search no longer lets walking prune the buses: bus options are listed even when walking is
  quicker (it was hiding every bus on short trips).
- **In the 3D city (R3b, 2026-11-05): "Start trip", navigation like a maps app.** The Transit
  panel's "Plan a trip" opens the in-game planner (`plan/ingame.js`, the `trip` hook after `ride`):
  From = where you stand (walk mode) or the map's centre, or a stop; To = a stop. Each option has
  **Start trip** and **Teleport onto the bus**. During a trip (`plan/trip.js`, pure, tested):
  1. walk: a green chevron racing line on the ground (`plan/groundline.js`: one InstancedMesh,
     chevrons every 1.6 m flowing toward the target at 2.2 m/s, on the walkable surface incl.
     bridge decks) leads to the boarding stop, re-routed on the walk graph as you move;
  2. wait: the HUD counts down to the bus; when it is within 30 m of the stop and so are you,
     **F** (or the button) boards it through `ride/`;
  3. ride: the guide tells ride to get off at the planned stop (`wantOff`, `offK`); you land there
     in walk mode;
  4. the line leads on to the destination; "You have arrived". A bus that left 90 s ago without
     you: "Missed: plan again from here".
  **Teleport** skips the game clock to 3 s before the first bus leaves and seats you on it; the
  rest of the trip continues as above. **End trip** stops guiding. `window.__bloxTrip` for tests.
- **Any place (R3c part 1, 2026-11-05):** From and To search shops, cafés, pubs and other named
  places, landmarks, streets, BAG addresses ("Papenstraat 5") and stops (`plan/places.js`:
  accent- and case-blind, word starts match, stations/landmarks/stops rank higher), with a
  suggestion list under the field (`plan/suggest.js`; tap, or arrows + Enter). The site build writes
  `world/places.json` from `features.json` (phone page; the test area's is 174 KB); the game builds
  the same index from the features it already loads. The in-game planner has **📍 Me** too: your
  real GPS position as the start, and "Start trip" puts you there in the city.
- **Phones:** inputs are 16 px (iOS zooms into smaller ones), no double-tap zoom, and the phone
  page's map stays at the top while you scroll the options (fits at most zoom 16). On touch
  screens one finger scrolls the page; two fingers move and zoom the map.
- **Start trip** puts you facing the first leg (the stop or the destination). The walk camera
  fits the screen: on portrait phones the view widens (`fitFov`) and the shoulder offset shrinks
  (`shoulderScale`, `player/camera.js`).
- **Start where the trip starts:** "Start trip" from 📍 Me (or a typed start) far from the camera
  moves the map there, streams it (`city.focus`) and then stands the player on open ground near
  it (`player/spot.js` `standSpot`: street level, open sky, room for the camera, within 30 m);
  up to 45 s on a slow connection. `window.__bloxTrip.state` exposes the planner for tests.
- **Built city only (in the game):** the bus network runs past the built part of the city, so
  the in-game planner only uses stops that have city around them (`TripPlanner.setUsable`, from
  the streaming index's chunks); 📍 Me outside the built part says so instead of planning there.
- **Rides stay in the built city (2026-11-06):** the Transit panel's Running now list marks buses
  outside the built city (or about to leave it) "Outside the built city" with no Ride button, stop
  search lists only stops inside, and `board()` refuses a vehicle out on the baseplate. A bus whose
  next stop is outside drops you at its last stop inside (`wantOff` at the edge). Getting off puts
  you beside the doors on open pavement (`player.enterNearUnity` -> `player/spot.js` `standSpot`):
  GTFS stop points often fall inside a building's footprint, which put people on roofs. The ride
  re-applies its own lens (fov, near) every frame.
- **Bridges:** vehicles and people never stand on the river under a bridge: the ground lookup
  (`life/ground.js`) retries higher when it lands on water and takes the dry deck above; route
  lines that run beside a deck over the water snap across onto it (`makeDeck`).
- **Riding owns the camera:** boarding leaves walk mode instantly (`exitWalk(true)`), and the
  player's draw-time tick ignores input while `__bloxRide.state.ride` is set; the page itself never
  zooms (pinch/double tap on panels).
- Next: postcodes, saved places (home, university).

## The look by time of day (2026-11-13)

`scene.js` `setTime` asks `render/look.js` `lookAt(sunAt(hours))` for every light and colour value;
`look.js` is plain numbers (tested in `test/render-look.test.mjs`: sane at every hour, no jumps).

- **Four keys, blended:** day (white-warm sun, vivid), golden hour (orange low sun, warm horizon),
  blue hour (deep blue sky over a pink horizon, windows starting to glow) and night (cool moonlight
  with readable shadows). Twilight is longer than before (`sunAt`: night 0 to 1 over about an hour).
- **Sun to moon without a jump:** the light direction switches half way through twilight, where the
  direct light is dimmed to almost nothing, its colour has already reached the moon's and the haze
  glow is gone.
- **Haze with sun glow** (`render/haze.js`): the distance fog brightens and warms toward the sun.
  One patch of three.js's fog shader chunks before any material compiles; two shared uniforms
  updated once per frame. Cost: a dot product and a pow per fogged pixel.
- **Grade pass** (`render/grade.js`) replaces three.js's OutputPass: tone mapping, a little
  saturation and contrast (an S-curve that keeps black: a straight line crushed the night), cool shadows and warm highlights, a soft vignette, and on High a compact
  edge smoothing (the scene targets have no MSAA), all in the one pass that was already there.
- **Sky:** stars (a few bright) and a moon disc fade in at night; not in the reflection map.
- **Bloom** follows the night factor: by day a faint glow on glints, at night the threshold drops so
  warm windows get a halo, not only the lamp heads.

## Leaves in the wind (2026-11-14)

Tree foliage near the camera moves. `bricks.js` flags every brick (and stud) in a leaf colour
(`isLeaf`: palette names starting with `leaf`) with a per-instance attribute `aSway`; leaf bricks
get their own meshes, so nothing else pays for it. `materials.js` `addSway` patches the solid
material's vertex shader: a flagged brick drifts in a slow wave whose phase comes from where it
stands, so the wave runs through a canopy instead of the tree shaking as one block. Strength is
`swayAmp(wind)`: 1.2 cm in still air, +1.6 mm per km/h of the real wind (life/weather.js), capped
at 9 cm; `life/index.js` sets it and the shared time each frame. Trunks, grass and hedges in other
greens stand still. Only the instanced near zone sways (the far city is merged geometry); shadows
do not follow. Tests: `test/sway.test.mjs`. Checked on the look-test scene: canopies change
between two frames, buildings and trunks do not.

## The silhouette must hold every coarse region (2026-11-14)

Chunk streaming waits for `FarRegions.silhouetteReady()`: the coarsest level loaded for the
whole city and settled. Its scheduler used the default `maxLoaded` of 600; the whole-Maastricht
bake has 1,020 regions, so it unloaded regions as fast as it loaded them, never settled, and
no chunk was ever requested: the loading screen stayed up on PC, and on phones the camera came
down onto the coarse far look ("No ground there", grass slabs where buildings should be). The
coarsest level now has no cap (it is the whole silhouette by design; about 10 MB here).
`test/farregion.cap.test.mjs` fails with the old cap. Checked against the published site's
data with the fixed code: past the loading screen in 21 s, chunks streaming, walking on the Markt.

## Rooms with people in them: windows by the hour (2026-11-14)

Every window used to glow the same way all night (60 % lit, always the same ones). Now:
- `glow.js` `litShare(hours)`: the share of rooms with the light on, from the clock (about 68 %
  at 20:00, 32 % at midnight, 6 % at 03:00, a bump to 32 % before work at 06:30). `scene.js`
  sets it with the time of day (`windowUniforms`); `life/index.js` feeds the game clock.
- Near glass (`materials.js` `windowGlass`): every window has its room colour (`windowGlow(...,
  { all: true })`); the shader decides which are on (per window, on its own 6 to 18 game-minute
  schedule, so lights go on and off as you watch), TV rooms flicker, and the light falls off from
  the ceiling toward the sill. The far city (`cityFar`) keeps the same share per metre cell.
- Room light is weaker than a lamp (glass emissive x1.15, far x1.2 at night, were x1.6), so lit
  windows no longer wash out the street. Checked on the full city at 21:00 and 03:00.

## Street lamps light the street (2026-11-15)

Every double-lantern lamp post (`lamp_double_1x3`) in the streamed area casts a warm pool of
light on the street under it and glows round both lanterns at night (`render/lamps.js`): found in
each streamed item's raw records when it arrives (`lampsFromRecords`, so every chunk in the stream
radius, not only the full-detail ones; islands through their pose), the nearest 240 drawn as two
additive instanced meshes (pools on the ground, camera-facing glows), fading in between night
0.12 and 0.45. No real light sources, so the cost does not grow with the lamps' light. Part of the
look work toward a cinematic night (owner's reference: warm lamp pools between deep shade).
Tests: `test/lamps.test.mjs`. Checked on the full city at 21:00 east of the Markt.

## The comic-print focus (test flag `#look=verse`, 2026-11-15)

Work toward the owner's Spider-Verse reference; not a menu setting until it is right. With
`#look=verse` in the address: `render/verse.js` adds a pass before the grade that reads the depth
the AO pass renders anyway. What is in focus (the player, or the orbit target) stays a clean
render; what is in front of or beyond it is "printed badly" instead of blurred: the colour plates
slip apart, a halftone screen and fine diagonal hatching come in, more the further from focus.
Figures animate on twos: `figure/crowd.js` poses them 12 times a second (between ticks the last
pose stays) while the camera moves smoothly. Needs the AO pass (High and Medium).
Open: style-aware lighting (hard light shapes, rim light), neon accents, and the night.

## Night is night, not darkness (2026-11-15)

Owner: the night was too dark; the reference keeps night scenes bright, colourful and striking.
- `render/look.js` night key: a strong blue-violet fill (hemisphere #6f74e0 at 1.0, was #5068a8
  at 0.5), a violet city glow on the horizon (#3b3f8c), a bluer, brighter moon (1.15), reflections
  kept at 0.62 (were 0.3), and more saturation at night than by day (1.14). `test/render-look.test.mjs`
  fails if the fill light, the sky glow or the saturation at any night hour drops below a floor.
- **Street lights on every road** (`life/roadlamps.js`): planned from the cars' road graph
  (`roadLampPlan`, every 30 m, alternating sides, the head on an arm over the road edge; car parks
  and drives stay dark), the nearest 200 within 220 m drawn as a post, an arm and a glowing head,
  with a warm pool and glow (render/lamps.js). Posts are kept out of walls (`isSolid`) and
  re-placed every ~3 s while the ground streams in. `test/roadlamps.test.mjs`.
- **Windows in colour** (`glow.js` `windowColor`): besides warm rooms (71 %) and TV blue (8 %),
  cool LED white (12 %), teal (5 %) and pink (4 %).
- Checked on the full city at 21:00, 03:00 (Stationsstraat) and 21:30 (Markt).

## Maastricht's colours, comic handling (2026-11-15)

Owner: not a violet filter over the city, but the city's own colours handled the comic way.
- Night fill made neutral again (`look.js`: hemisphere #9298bc, moon #b4c0f0): the blue stays in
  the sky and the distance, lamps and windows carry the colour; the night stays bright (the floor
  test still holds).
- `render/verse.js` (test flag `#look=verse`) now treats the graded image's own colours: values
  in clear groups (a soft three-step blended with the original), a lifted toe (no crushed black),
  chroma kept with the colour as the value moves (red brick stays red in the shade), more punch
  for coloured surfaces but not for a colourless shade, and a slight cool-in-shade / warm-in-light
  hue shift. The print slip and halftone apply only where clearly out of focus (span 0.55..2.6 of
  the focus distance, at most 2.6 px) and never on bright lights. Checked at 13:00, 18:00, 21:00.
- Open: the comic night still leans blue in the streets; lit shopfronts and neon; style-aware lighting.

## Crisp and modelled (2026-11-15)

Owner: the crisp, detailed look of a comic film (the train in the reference stills: a detailed 3D
model, coloured and drawn). `render/verse.js` now runs after the grade and adds:
- a light unsharp mask (not on bright lights), so brick and window detail reads at full resolution;
- fine lines where one shape passes in front of another (depth edges from the AO pass) and lighter
  ones at creases (its normals), drawn in a darker shade of the surface's own colour, fading out by
  260 m and out of focus; a faint warm rim on edges turning away from the eye;
- people in front of the focus count half (a passer-by stays readable), the sky is never printed,
  and the halftone and hatching sit only in the shade of out-of-focus areas (a zero-size dot drew a
  speck at every grid point; fixed);
- the cool/warm hue shift scales with the value, and only clearly coloured surfaces get the extra
  chroma, so moonlit and sky-lit paving stays grey instead of turning navy or violet.
- In verse mode `post.js` turns the tilt-shift blur off and the AO blend up (1.2).
- Night brighter for every look (`look.js`): blue-hour fill #6f7fb4, night fill #a4a3bc, ground
  bounce #4c4652, night exposure 2.15. Checked at 13:00 and 21:00 (Stationsstraat), both looks.
- Open: lit shopfronts and neon; style-aware lighting; the night streets in the comic look still
  read a little blue.


## Painted surfaces and film lighting (comic test look, 2026-11-15)

Owner: closer, but not there. Diagnosis against the reference stills: the post pass is not the gap;
the reference has painted, weathered surfaces, motivated light (a strong key, coloured shade, pools
of light at night), a restrained palette with accent colours, depth haze and far more geometric
detail. First steps, all behind `#look=verse`:
- `render/surface.js` `installSurface`: world-space paint on opaque materials (near solid, far
  solid, city far): a value shift per brick, large soft stains and vertical run-off streaks on
  walls, greying the surface's own colour; matte (no clearcoat, roughness >= 0.72).
- `scene.js`: sun x1.15, hemisphere fill x0.78, fog from 70 m to 1.1 km (depth haze).
- `render/verse.js`: a restrained palette (only clearly coloured surfaces gain chroma), fine
  hatching in the shadows (also in focus), the colour slip halved (1.3 px, from 1x to 4x the
  focus distance), no lines or rim in the sky.
- Open (the bigger gap): facade detail (frames, sills, cornices, shopfronts, signs), light pools
  and shop spill at night, a warmer brick palette, dramatic camera framing.

## Material textures, and the comic pass's depth fixed (2026-11-15)

Owner: "it's the textures". `render/surface.js` now textures each surface by its material, in
world space, behind `#look=verse`:
- brick walls: stretcher bond (22 x 6.8 cm courses), light mortar, a tone per brick (some cooler);
- marl / limestone walls: 50 x 26 cm blocks, fine joints, a soft mottle; plaster: grain and mottle;
- setts and pavement on the ground: 20 x 10 cm setts, dark joints, rounded edges; asphalt: speckle
  and patches; any sloped face: rows of tiles with a shadow line under each row.
- The material is found by matching the surface colour's chromaticity (and value within -18/+20 %)
  to the palette colours of those materials, registered as entries are used (`registerSurfaceEntry`,
  names in `KIND_OF`). Other colours (cars, signs) only get the weathering. Texture fades out where
  a pixel spans more than half a course. `test/surface.test.mjs`.
- **Bug found:** the comic pass reads depth and normals from the AO pass, but city mode turns AO
  off at street level (camera below 40 m), so the depth was stale: sky detection, focus and edge
  lines never worked in walk mode. In verse mode `post.js` keeps the AO pass rendering (a light
  0.55 contact shade where AO would be off) and the pass treats everything as in focus when there
  is no depth (AO tier off). Depth haze (fog from 70 m) moved to `citymode.js`, which sets the fog
  every frame.

## Figures, living textures, window bars, real night pools (comic test look, 2026-11-15)

All behind `#look=verse`.
- **Figures** (`render/figuresurface.js`, used by `figure/crowd.js` `materialFor`): each part kind
  gets its own clone of the figure material: skin (matte, warm sheen at the edges), hair (strand
  streaks, sheen), tops (fold shading, side seams, hem and cuff, a fabric sheen), trousers (front
  crease, side seams, worn knees, twill), shoes (a sole band). Patterns in the part's own space.
- **More materials** (`render/surface.js`): foliage (leaf clusters with dark gaps, sunlit tops),
  bark furrows, grass blades, soil clods, copper verdigris runs; texture fades also at grazing
  angles (no stripes).
- **Window bars** (`materials.js` `paneBars`): every pane gets a painted frame, a middle bar and a
  transom (not emissive), so windows read as sash windows by day and by night.
- **Real pools of light** (`render/pools.js`): the nearest 48 street-lamp heads and shop windows
  (`shop_window_1x2x4`, `window_1x2x3`; a spot 1.5 m out from the front, 0.9 m up) are shadowless
  point lights evaluated in the painted surface and figure shaders, so they light paving, walls
  and people in their own colours. Shops: 60 % warm, 18 % soft white, a few pink, teal or cool
  (neon accents). The additive pool discs are off in this look (glows stay). `test/pools.test.mjs`.

## Characters and vehicles finished like film props (comic test look, 2026-11-15)

Owner: object textures for people, bikes and cars, the player above all (the camera follows them).
- Shared plumbing `render/pools.js` `addPartVaryings`: local position, normal and vertex colour,
  world position for the night pools, and small pattern helpers (lines, stitched boxes).
- Figures (`render/figuresurface.js`; figures face -z, the earlier crease was on the back, fixed):
  face (brows, warm cheeks, matte skin), hands (knuckle lines), hair strands, tops (zip with teeth,
  collar, stitched pockets, side seams, back yoke and centre seam, neck label, waist wrinkles, hem),
  sleeves (ribbed cuffs), hips (belt and buckle, front pockets, stitched back pockets and yoke),
  trousers (crease, seams with light stitching, worn knees, twill), shoes (sole and welt, laces,
  toe cap). Detail is sized for a figure 2 to 5 m away and fades where it would be under a pixel.
- Vehicles (`render/vehiclesurface.js`, `VehicleFleet.materialFor`): paint vs trim from the vertex
  colours: deep clear-coated paint with sharp reflections and road dirt up from the sills, matte
  trims, mirror-dark glass, tyres with tread and a sidewall ring, metal rims with five spokes, an
  enamelled bike frame. `test/partsurface.test.mjs`.

## Lessons shared across the looks, and the manga look (2026-11-15)

Owner: carry what works in the comic look over to the toy look and the manga look. One switch
(`render/verse.js` `LOOK`, `PAINTED_LOOK`): `#look=verse`, `#look=manga`, or neither (the toy look).
- **Every look** now gets: glazing bars in windows (`materials.js` `paneBars`); lamps and shop
  windows as real night lights (`render/pools.js`; the additive pool discs are off, glows stay);
  printed figure detail (seams, zip, pockets, brows, laces; `render/figuresurface.js`) on the toy
  plastic; tyres with tread, spoked rims, paint vs trim (`render/vehiclesurface.js`).
- **Painted looks** (verse, manga) also get the material textures and weathering
  (`render/surface.js`), matte cloth and skin sheen on figures, clear-coat paint and road dirt on
  cars, the stronger key light, depth haze and the AO pass kept on for depth (the bug found in
  the comic look: AO off at street level left the pass without depth).
- Not carried to the toy look on purpose: brick-course and sett textures (the toy look is smooth
  plastic bricks; the textures are what makes the painted looks read as a film set).
- **The manga look** (`#look=manga`, the same pass with `MANGA` defined): black ink on paper.
  The value picks a tone (paper; fine 45-degree screentone; dense screentone; cross-hatching;
  solid black), ink lines at silhouettes (bold) and creases (fine) from the AO pass's depth and
  normals, lighter far away, the sky as paper, distance going pale, night lifted (L^0.55) so it
  stays readable. Material textures show up as tone. Figures animate on twos as in the comic look.
- Comic look: no colour split on lit things (threshold 0.55..0.8 luma), so night windows glow cleanly.
- Open: manga screentone pitch (4 px) to check at 1080p+; manga accents (speed lines, a single
  spot colour?) if wanted; buses, boats and street props still use the plain materials.

## The comic look ships: menu switch, speed, the film's grade (2026-11-15)

Owner (after a workstation test): good, best at night; it lags; a little too bright and cartoonish
next to the film; ship it as a pause-menu option.
- **Menu:** pause menu > "Look: Classic / Comic" (`menu/items.js`, `menu/index.js`). The choice is
  saved (`localStorage blox.look`) and the page reloads (materials compile for one look). The
  address wins: `#look=verse`, `#look=manga` (test only, not in the menu), `#look=classic`
  (`render/verse.js` `chooseLook`, `hashWithLook`, `switchLook`; tests in `test/verse.test.mjs`).
  The menu says "Comic", not the film's title (its name is the studio's trademark).
- **Speed:** the comic pass took its depth and normals from the AO pass, so AO had to run at
  street level, and its normal render drew the whole scene a second time (847 -> 1700 draws in the
  owner's screenshots). Now `render/depthpass.js` renders the scene into a target with a depth
  texture and copies it on (one full-screen copy); the pass rebuilds normals from that depth; AO
  is back to the toy look's rule. Same view: 154 draw calls in Comic vs 206 in Classic.
- **The film's grade:** a muted palette (only clearly coloured things keep full colour), mids a
  touch deeper (gamma 1.1), highlights rolled off, blacks lifted toward a cool ink, a paler sky,
  and split toning: light amber, shade teal by day and violet at night; denser depth haze (fog from
  45 m). Checked at 13:00, 17:30 and 21:00.
- Owner on the first build: people looked yellow and glowing at golden hour (an amber split tone on
  top of the warm sun, plus cloth and skin sheen catching the low sun); the split tone is now gentle
  (shade a touch cool, light near neutral) and sheen is low (skin 0.1, cloth 0.1-0.12, hair 0.25).
- Street lights (every look): lantern halos 0.42 m with a steep fall-off (were 0.9 m soft blobs);
  pools as a street light falls off, strong under the lamp and soft at the edge
  (att = (1 - d/r)^2 / (1 + 0.06 d^2), r 10 m), not a flat bright disc.

## Grounded figures and inked hatching (2026-11-15)

Owner passed on outside advice (written for Unity; the ideas that apply to this web renderer):
- **Contact shadows, every look** (`figure/crowd.js` `CONTACT`): a soft black disc (alpha map,
  normal blending) under each standing or walking figure's feet, so people stand on the street
  (AO is off at street level). Riders and sitters get none. Note: a multiply-blended or
  vertex-alpha version blacked out the whole frame in headless Chromium; the alpha-map version
  is the one that works.
- **Figures in the painted palette** (`render/figuresurface.js` `FILM_PALETTE`): toy colours 20 %
  toward grey and 6 % darker in the painted looks, so people belong to the scene.
- **Inked hatching like the film** (`render/verse.js` `inkHatch`): parallel lines whose direction
  follows the surface (screen-space normal snapped to 45-degree steps), width growing with the
  shade, tapered and broken by a slow noise, a second set across only in the deepest shade; drawn
  in a darker shade of the colour, in focus too, stronger out of focus. Pitch ~res.y/260 px.
- **Manga** (test flag): mostly paper and solid blacks (tones only where they shape), a finer 3 px
  screentone, and the same inked hatching instead of screen-aligned lines.

## Owner's play-test fixes (2026-11-15, evening)

- **Gun held on twos:** the comic look poses figures 12 times a second, but the gun followed the
  hand's live position every frame, so between poses it drifted ("floats, sways"). The player's and
  other players' figures now animate every frame (`FigureCrowd` option `twos: false`); crowds keep
  the twos.
- **Phone on Low looked like a filter:** on phones only (touch screen, short side <= 520 px; `isPhone`), fine detail (crease lines, hatching, dots) fades out when the
  render is under ~600 px tall (`detail` in `render/verse.js`); a laptop on Low (700+ px) keeps it
  all and laptops and desktops are never changed, as the owner wanted. Outlines always stay.
- **Room panel on phones:** a close button that survives every re-render, and the panel closes by
  itself when the match starts (the Play button that toggled it is hidden in a match).
- **Guns feel like guns** (`mp/weapons.js` `feel`, `mp/combat.js`): part of each kick recovers (rifle
  climbs, shotgun punches and settles, scout snaps), a short camera shake per shot, muzzle flash
  sized per weapon, the gun jumps back in the hands, and per-weapon sounds with a street echo
  (`SHOT_SOUND`: rifle crack and thump, scout loud crack with a long tail, shotgun boom and pump).
- `scripts/check.sh viewer` now also bundles the whole game (a syntax error in a module no test
  imports had slipped through); CI runs it.

## The comic look reacts to the action (2026-11-15)

Owner, with a clip of the film's headphones scene (cuts and colour shifts on the beat, tilted
camera on the action, the colour plates splitting on fast foreground motion): make the look react,
big on a hit or knock-out, small but noticeable when you run someone over.
`render/comicfx.js` (`comicFx(kind, at)` fires a window event; `ComicFx` in `post.js` decays the
state and feeds the comic pass): hit (action lines from the target, a ring of halftone dots, the
plates jump apart), headshot (stronger, "PATS!"), knock-out (plus a magenta-violet two-colour
flash, a few degrees of camera tilt, a 70 ms held frame and a Dutch sound word: KNAL!, BOEM!,
KRAK!), hurt / knocked out (a red flash, tilt), running someone over (a small dot burst and a jolt
of the plates), brushing past (a slight jolt), firing (the plates twitch, the shotgun more), a raid
wave (the palette swings to red-violet and settles), a capture (a flash). Hooks: `mp/index.js`
(hits, hurts, waves, captures), `mp/combat.js` (my shots), `life/index.js` (walker bumps, now with
where they happened). Painted looks only; the classic look is unchanged. Everything fades in
under a second.
- (2026-11-15) Running someone over now reads: a dot burst with a few short lines, a stronger jolt
  of the plates and a small word (PATS!, BONK!, OEPS!). On a phone, Low renders at 1x and the fine
  detail fades (by design); High looks like the desktop.

## Weather you can see and hear (2026-11-15)

Owner: people carried umbrellas (the real Maastricht weather said rain) but there was no rain to
see or hear. `render/weatherfx.js` (`WeatherFx`, updated by `life/index.js` with the weather life
already uses: live Open-Meteo, or `#rain=`, `#snow=1`, `#storm=1`):
- **Rain:** streaks falling round the camera (up to 9000 on High, 1500 on Lite), slanted by the real
  wind, as many as the rain is heavy; one draw call, moved on the GPU (wrapping round the camera).
- **Wet streets** (`render/surface.js` `uWet`, every look): ground darkens and gets a sheen, puddles
  nearly mirror the sky and the lamps; wets in seconds, dries over minutes.
- **Snow:** flakes drifting; roofs and streets slowly turn white while it snows (`uSnowCover`) and
  thaw after. Snow comes from the weather code (71-77, 85-86) or snowfall.
- **Overcast:** a grey or wet sky dims the sun (`scene.js` `weatherSun`, `sunFactor`).
- **Storms** (weather code 95-99): lightning every 8-30 s (the city flashes and flickers), thunder
  0.5-3 s later (`audio`, 'blox:lightning'), a white flash in the comic look.
- **Sound fix:** the rain sound read only `#rain=` and never the live weather; it now follows the
  weather life uses (snow is silent).
Tests: `test/life.weather.test.mjs` (snow/storm codes, test flags, sun dimming, wind drift).
- Owner: drops too long, flakes too thick. Raindrops are now short dashes (7-20 cm, varied), finer
  and a little fainter, fading with distance; flakes are fine specks (1-3 px far off, a little
  larger and softer right by the camera), denser (1.3x the rain count) and varied in size.
- The sky shows the real cloud cover only in rain or snow, or always with Settings > "Real cloud cover" (off by default; `weatherfx.js` `skyCloud`) (Open-Meteo `cloud_cover`, `sky.js` `clouds` 0 clear .. 1
  overcast; greyer in rain or snow; at night dark clouds hide the stars instead of glowing). Snow
  settles on upward faces over a few minutes while it snows and thaws after (`uSnowCover`).

## Seasons, festive lights and the Christmas market (2026-11-21)

From the owner's photos (Bosscherweg, Markt, Maagdendries, the Vrijthof). No world rebuild.
- **Seasons** (`render/season.js`, from the date; `#date=YYYY-MM-DD` or `#season=` to test): leaf
  bricks (found by their palette colour in `render/surface.js`, every look and level of detail)
  turn yellow, orange and brown from 20 September to 5 November, fall from 25 October to
  10 December (92 % bare, each leaf cell on its own day), come back light green in April; bare
  trees cast no leafy shadow (`bricks.js`). Fallen leaves fleck the ground in autumn, clumped.
- **Festive light crowns** (`render/festive.js`, `life/roadlamps.js`): from 14 November to 6 January,
  a pole with a white wire crown strung with warm bulbs beside each street lamp in the old town;
  the bulbs glow (and bloom) at night with a soft pool of light.
- **Christmas market on the Vrijthof** (`life/xmas.js`): a white Ferris wheel (30 m, 24 gondolas,
  rim lights, turning slowly when open) on the south side, ~50 wooden chalets with red, brown and
  grey roofs, a carousel with a striped roof; the week before Magisch Maastricht opens it stands
  fenced off by printed banner panels (as in the photos), while open the chalet counters are lit
  at night and light the square. Spots inside buildings are skipped.
- Tests: `test/season.test.mjs`.
- (Owner: the market covers the whole Vrijthof.) Chalets now fill the square in back-to-back rows
  with aisles (`chaletLayout(keep)`: open ground only, level, nothing within 2.2 m, off the cars'
  roads; ~230 on the real square), each with a string of bulbs along its eaves; the wheel's spokes
  are glowing bars in red, blue and white with a slow pulse; a giant lit gift box (red, white bands,
  a bow) beside the wheel; the square's trees found as thin solid columns and wound with white, ice
  blue or gold lights (spiral up the trunk, sprinkled through the crown).

## The manga look, JoJo style, in the menu (2026-11-21)

Owner: the manga look should be like JoJo's Bizarre Adventure (references: flat loud colour, odd
palettes, heavy ink). `render/verse.js` (MANGA): three flat tones per surface, the shade hue-turned
toward violet and magenta, the light pale and warm, colour louder than life; a flat teal-to-violet
sky; ink outlines two pixels out (bold), solid black in the deepest shade, hatching only in the
shade (the darker half of the middle tone lightly); distance paler. In the Look menu as "Manga".

## Toward 60 fps everywhere (2026-11-21)

Owner: 60 fps on any device. Before dropping detail, the render resolution now follows the frame
time (`quality.js` `DynamicResolution`, `scene.js` `setResolutionScale`; every quality mode, `#drs=0`
turns it off): 10 % fewer pixels each way per half second while frames miss 60 fps, down to half;
6 % back after 3 s at the display's own pace; a step up that makes it slow sets a ceiling (retried
every 2 min). Auto quality drops a tier only once the resolution has nothing left to give (and at
24 ms now, was 40). Also: night light pools capped by tier (48 high, 24 medium, 12 low/lite) and
updated in every look; the wet/snow shader returns at once when dry. Checked headless: the software
renderer settles at half resolution, the picture stays clean.
Still open (bigger jobs): merge near-chunk meshes per material, frustum-cull the instanced crowds
per block, a worker for the walkers' simulation.
- (Owner, on the workstation: "not as crisp".) Three causes, fixed: (1) dynamic resolution had
  halved the pixels because the remote desktop caps the frame rate; a drop that buys no speed is
  now undone and not retried for a minute (`DynamicResolution`); (2) the brick textures and stains
  turned into violet blotches under the manga colours: the manga look now has flat cel surfaces
  (`TEXTURED_LOOK` is the comic look only); (3) a zero-width hatch still drew a faint line (fixed in
  `inkHatch`, every look). The manga shader is now anime cel shading: two flat tones with one crisp
  edge, the lit tone the surface's own clean colour (greys stay grey), the shadow its colour darker
  and leaning violet, ink in the deepest dark, a few hatch lines at the shadow's edge, bold outlines.
- (Owner: only the colours felt like that world; the outlines, the style and the atmosphere did
  not.) Manga look: **ink outlines** round every figure, golem and vehicle (`render/outline.js`:
  the inverted hull of anime games, back faces pushed out a fixed 2.6 CSS px along the normals,
  sharing the instance matrices: even and unbroken at any distance or resolution). **Atmosphere**
  (`render/mangafx.js`): the menacing katakana ゴ rise in a column beside you when you stand still
  for 2.5 s, aim, or face a raid wave; the sky and shadow colour swing between unreal schemes (teal
  and violet, lime and gold, pink and purple, orange and teal; 75 s each, 6 s crossfade; a knock-out
  or wave throws it to pink and purple); ink speed lines at the screen edges when sprinting; sound
  words in katakana (バシッ, ドン!, ドドド, バーン, ゴン, ドサッ).
- Manga colour, second pass: the lit tone is the colour at full strength (+50 % saturation), not blended toward white; greys take a little of the scene's colour; shadows deep and saturated, terminator at 24 % luma (more contrast); solid ink below ~8 %; distance fades into the sky's colour.
- (Owner: the style of the anime's backgrounds, not its characters.) Manga, third pass, toward the
  illustrated backgrounds of Parts 3-5: light and shadow as two clear masses with a painted edge,
  gradients inside each; warm highlights (amber) and cool shadows (blue-violet, the scene's shade
  colour); greys as warm cream stone; a brush grain of long soft strokes; deep colour (+35 %
  saturation); material textures back with only a trace of weathering; lines with intent (a dark
  shade of the local colour on the city, heavier near, light at creases; the characters' ink line
  2 px); a strong sun and deep shade (sun x1.35, fill x0.6).

- **Manga environment refinement (2026-11-22):** the colour pass now preserves the base material's
  own hue and value instead of normalising every saturated surface toward a similar bright colour.
  Sunlit surfaces retain their local colour with a restrained warm bias; shadow keeps the material
  darkened and leans blue-violet. Neutral stone receives a warm cream treatment. Soft value movement
  and subtle pigment variation add depth without a screen-locked heavy grain. Distance haze begins
  earlier and gently reduces contrast and chroma toward the Manga sky. Manga keeps its existing
  material textures and trace weathering; Classic and Spider-Verse do not use this pass.
- Combined pass: the look-anime shading kept; shadows lifted toward their lit colour (shade readable at dusk), colour +32 %; brush grain applied off the sky only.
- Vivid pass (owner: too dull; the dark shadows are right): the shadow lift removed; colour +60 %, contrast +8 %, split toning: golden light, blue-violet shade. Mockup approved first (a paint-over of the render).
- Painted anime sky (manga): violet overhead, warm pink-gold at the horizon (the new default
  palette); cel-shaded cumulus on a cloud layer in perspective, fixed to the world and drifting
  (`mangaSky`, three weighted octaves: big smooth puffs), the side facing the sun cream-gold (the
  sun's direction from `scene.js` via `post.setSun`), violet undersides, a soft ink edge; the haze
  colour stays a plain mix of the palette. Mockup (a paint-over) first, as agreed.

## Our characters in that world: proportions and poses (2026-11-22)

Owner: make our own characters look like they come from the bizarre-adventure world (not its
characters); research first, mockup first (a concept image from our own screenshot, used as a
mood board only). Research notes: fashion-plate posing (models, Rodin, kabuki stock poses: the
whole skeleton in the pose), high fashion, heroic proportions (Part 3) turning slimmer later,
colour used relationally, stands as the soul made visible (often echoing the user; armour,
machine and organic mixed).
- `figure/rig.js` `PROPORTION` (set by the manga look in `render/figuresurface.js`): shoulders
  x1.3, chest x1.24, waist x0.86, legs x1.12 (the feet stay on the ground; seats and saddles keep
  plain legs), head x0.86, arms x1.07, for every figure.
- `STAND_POSES` (`IDLE.POSE`): three original sculptural poses (an arm across the face and a hand
  on the hip; pointing ahead with the other arm folded; a hand at the temple, chin up, back
  arched). The player strikes one after 2.5 s standing still (not while holding a gun), easing in,
  a different one each time; the ゴゴゴ lettering rises at the same moment (render/mangafx.js).
- Fashion and faces (`render/figuresurface.js` `MANGA_FASHION`, manga only): each outfit colour gets
  a bold print (stripes, zigzag, hearts, checks or a contrast panel), tops a gold chain across the
  chest and a pin, trousers sometimes a racing stripe or a diagonal print; faces heavy angled
  brows with an ink shadow under them and coloured lips.
- The Stand (`player/stand.js`, manga only): an original design: a tall spirit of armoured blocks in
  the player's own outfit colours, gold trim (shoulder plates, waist band, a crest), a glowing
  visor slit, a soft aura, a trail of plates instead of legs; ink-outlined; it rises beside the
  right shoulder (a little ahead: the camera is behind) when the player strikes a pose or aims,
  and E (walk mode or a match) throws a rush: punches every 0.07 s for 1.1 s with afterimage fists
  in front; in a match each punch is a 'stand' shot through the room's rules (`CTF.weapons.stand`:
  12 damage within 3.8 m), with a hit reaction. `test/stand.test.mjs`. Online rooms need the relay
  redeployed for the 'stand' weapon; solo games have it at once.
- (Owner: too stiff; relax the toy theme for the characters.) Manga only: organic silhouettes
  built into the part geometry (`mangaShape`, so the ink outline follows): biceps and thighs swell
  and taper to the joint, calves, a V torso from broad chest to narrow waist, fuller and taller
  hair; everyone stands at ease (`rig.js` `relaxed`: weight on one hip, the free knee bent, a hand
  in a pocket, the chest turned against the hips, the head tilted; the side by person) instead
  of straight; a looser walk (more chest and hip roll, bent elbows, freer arms).

## The manga look's own figure (2026-11-22)

Owner: the block figures, however reshaped, did not look like that world; build a new figure for the
manga look (an exception to the brick-style rule for this look only). `figure/animeparts.js`
`ANIME_PARTS()`: the same joints, part keys and colour slots as the toy figure, so poses, walks,
the gun, bikes and crowd instancing are unchanged (`figure/crowd.js` picks it in the manga look;
the far crowd keeps the light block parts). An angular anime head (a sphere carved into a tapered
jaw and chin, a nose ridge, flat ears), tapered anatomy from lathe profiles (deltoid and biceps,
forearm, a V torso, thigh, calf), sculpted hair (pompadour, a crown of spikes, an angular fringe,
spiked bob, locks, top knot, swept tail, a peaked cap with a badge), tailored tops (a stand-up
collar open at the front, lapels, gold buttons, a long open coat), hands with fingers, pointed
shoes. The face shader draws almond eyes (white, iris and catch-light, a heavy upper lid with a
flick, a lower line), angled brows, a nose shadow, a jaw shadow and a firm coloured mouth.
Found on the way: an injected shader block ending in a // comment swallowed the closing brace, so
the manga faces and the trouser prints had been failing to compile (fixed; blocks end with a new
line). Checked in a standalone figure preview (front, three-quarter, close-up) and in the city.
Open: still rigid segments (no bend through the spine), coat tails that swing, expressions.
