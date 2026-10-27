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

### Loading screen (`src/loading.js`)
A cover (`#loading` in `index.html`) hides the first seconds: city index -> baked silhouette ->
first streaming ring -> 8 drawn frames (the shaders compile on the first ones), then it fades
out. The phase logic is the pure `loadState()`, which is tested. The first ring counts as done
at 90% loaded, when the loader settles, or after 8 s at most. Progress never moves backwards.
Load errors show on the cover. It is skipped for `?shot=1` and automation (`navigator.webdriver`),
so screenshots and perf runs are unchanged. `window.__bloxTimes.cover` records when it lifted.

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
