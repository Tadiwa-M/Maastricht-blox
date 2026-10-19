# Blox viewer (browser)

A three.js viewer for a Maastricht Blox world dir (CONTRACT.md sections 4-6), for look
development where Unity can't run. It reads palette and catalogue from the world dir at build
time, so new palette entries or brick types need only a rebuild.

## Build and run

```sh
cd viewer
npm i
node build.mjs [worldDir]        # default ../build/testscene -> dist/{index.html,viewer.js,world.js}
node screenshot.mjs [outDir] [views] [hashExtra]   # default ../build/shots, hero,map,facade
npm test                         # chunk reader + rotation tests
```

Open `dist/index.html` directly (file:// works: `viewer.js` is a self-contained bundle) or
through any static server, e.g. `npx http-server dist`.

Regenerate the test world: `cd ../pipeline && uv run python -m blox_pipeline.testscene --out ../build/testscene`.

URL hash options: `#view=hero|map|facade&t=16.5&tilt=0&ao=0` (`t` = sun time in hours,
after 18:30 it is night: lamps and windows glow). Adding `?shot=1` hides the HUD and stops
the render loop after the first frames (used by `screenshot.mjs`, which captures the canvas
via `window.__bloxCapture()` because a compositor screenshot times out under SwiftShader:
one frame takes about 30 s there).

Examples: `node screenshot.mjs ../build/shots hero t=20.5` writes `hero_t_20_5.png`.

Controls: left drag pans, right drag orbits, wheel zooms; click a brick to see its feature.

## Layout

| File | Role |
|---|---|
| `src/bxc.js` | `.bxc` chunk reader (header, raw-DEFLATE body via `DecompressionStream`) |
| `src/world.js` | chunk decoding to global cells, rotation/footprint helpers, occupancy |
| `src/geometry.js` | bevelled brick, slope, ridge, round and stud geometry (cached) |
| `src/bricks.js` | InstancedMesh per (geometry, material) with per-instance colour variation |
| `src/materials.js` | plastic / glass / trans / emissive / metal materials, night glow |
| `src/scene.js` | renderer, sky, ground, sun + hemisphere light, shadows, post-processing |
| `src/presets.js` | camera presets derived from bounds and building features |
| `src/ui.js`, `src/main.js` | HUD, picking, render loop |

Coordinates: three.js `x = I*0.5`, `y = K*0.2`, `z = -J*0.5` (north is -z, so the scene is not
mirrored). Rotations are clockwise seen from above (CONTRACT section 2).

Not affiliated with, endorsed or sponsored by the LEGO Group.
