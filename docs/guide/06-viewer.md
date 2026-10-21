# 06: Browser viewer (three.js)

Folder: `viewer/`. A second renderer for the same chunk files, used for look development and
screenshots, since Unity can't run in the build container. It also checks data and rotations
independently of Unity. The full file table is in `viewer/README.md`.

## How to run

```bash
cd viewer
npm i
node build.mjs ../build/testscene     # bundles src/ + embeds the world and contract/models -> dist/
open dist/index.html                  # file:// works (self-contained bundle)
npm test                              # 44 tests (2026-10-19): bxc, bxi + islands, rotation, picking, movers, models, far LOD, quality
node screenshot.mjs ../build/shots hero t=20.5   # headless Chromium (Playwright) -> hero_t_20_5.png
node tools/perf.mjs hero,facade quality=low      # draw calls + triangles per frame (renderer.info)
node tools/tile-world.mjs ../build/testscene ../build/tiled7 7   # 7x7 copy of the look-test chunk
```

Or from the repo root: `scripts/shots.sh` regenerates the models and the test scene, then
takes `hero`, `facade`, `gallery` and a night hero shot into `build/shots/`.

URL hash: `#view=hero|map|facade|river|island|islandmap|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47&quality=auto&zoom=0.5`.
`island` looks at the street facade of the biggest island, `islandmap` straight down on all
islands (compare with the pipeline's `preview.png`). `t` is the sun time in hours (after 18:30 lamps and windows glow); `ids` limits the gallery;
`quality` is `auto|high|medium|low` (also in the HUD); `zoom` scales the preset camera distance.
Controls: left drag pans, right drag orbits, wheel zooms, and a click shows a brick's feature,
type, colour, cell and facing.

## Module map

```
build.mjs: world dir + contract/models -> dist/world.js (embedded data) + dist/viewer.js

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
| `test/island.test.mjs` | `.bxi` golden file (compressed + raw), bad input, pose vs `islands.json` through a THREE.Group, island picking + nearest hit, LOD wiring on the town fixture, islands on their paved plots |
