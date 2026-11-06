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
- **The settings panel** (sun, quality, views, stats) starts collapsed for everyone: the game
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
| bloom | `src/post.js` | `UnrealBloomPass(…, 0.18, 0.4, 0.92)` (strength, radius, threshold) |
| sun path, shadows | `src/scene.js` | `MIN_DAY_ELEVATION` 22°, `MAX_ELEVATION` 52°, shadow map 4096, bias |
| sky colours, reflections | `src/scene.js` (`DAY_*`, `DUSK_*`, `NIGHT_*`), `src/sky.js` (same shader feeds the PMREM env map) | |
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
