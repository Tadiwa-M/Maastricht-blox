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
npm test                              # 24 tests (2026-10-19): bxc, rotation vectors, picking, movers, models
node screenshot.mjs ../build/shots hero t=20.5   # headless Chromium (Playwright) -> hero_t_20_5.png
```

Or from the repo root: `scripts/shots.sh` regenerates the models and the test scene, then
takes `hero`, `facade`, `gallery` and a night hero shot into `build/shots/`.

URL hash: `#view=hero|map|facade|river|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47`.
`t` is the sun time in hours (after 18:30 lamps and windows glow); `ids` limits the gallery.
Controls: left drag pans, right drag orbits, wheel zooms, and a click shows a brick's feature,
type, colour, cell and facing.

## Module map

```
build.mjs: world dir + contract/models -> dist/world.js (embedded data) + dist/viewer.js

main.js ── world.js (World: typed arrays, cell -> brick map, bounds)  <- bxc.js (chunk reader)
   │          ├─ exterior.js   flood fill of outside air (hides studs in closed interiors)
   │          ├─ glow.js       which windows are lit at night (per window, hashed)
   │          └─ picking.js    click -> brick via 3D DDA through the grid
   ├── bricks.js  BrickBatcher: one InstancedMesh per (geometry, material); colour variation,
   │              stud exposure, hide_studs
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
- **Picking** steps cell by cell along the ray (Amanatides & Woo), so the cost depends on ray
  length, not brick count (`picking.js`, tested in `test/picking.test.mjs`).

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
| piece shapes | `src/details.js` | `BAR`, `PANE_BACK`, per-piece builders |

## Tests

| File | Checks |
|---|---|
| `test/bxc.test.mjs` | chunk header and records |
| `test/rotation.test.mjs` | `contract/test_vectors/rotation.json` |
| `test/picking.test.mjs` | DDA picking and the exterior-air flood fill on a tiny hand-made world |
| `test/mover.test.mjs` | PathMover poses, corners, loops |
| `test/models.test.mjs` | every `contract/models/*.json` builds with the right parts, size and pivot, facing forward |
