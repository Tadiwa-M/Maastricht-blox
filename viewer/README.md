# Blox viewer (browser)

A three.js viewer for a Maastricht Blox world dir (CONTRACT.md sections 4-6), for look
development where Unity can't run. It reads palette and catalogue from the world dir at build
time, so new palette entries or brick types need only a rebuild.

## Build and run

```sh
cd viewer
npm i
node build.mjs [worldDir]        # default ../build/testscene -> dist/{index.html,viewer.js,world.js}
                                 # (also embeds contract/models/*.json and the contract catalogue)
node screenshot.mjs [outDir] [views] [hashExtra]   # default ../build/shots, hero,map,facade
npm test                         # chunk reader, rotation vectors, picking, movers, far LOD, quality tiers
node tools/perf.mjs [views] [hashExtra]          # draw calls + triangles per frame from renderer.info
node tools/tile-world.mjs <src> <out> [n=7]      # n x n copy of a world's chunks (perf test world)
```

Open `dist/index.html` directly (file:// works: `viewer.js` is a self-contained bundle) or
through any static server, e.g. `npx http-server dist`.

Regenerate the test world: `cd ../pipeline && uv run python -m blox_pipeline.testscene --out ../build/testscene`.

URL hash options: `#view=hero|map|facade|river|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47&quality=auto&zoom=0.5`
(`t` = sun time in hours, after 18:30 it is night: lamps and windows glow; `anim=0` pauses the
movers; `ids` limits the gallery to some catalogue ids; `quality` = auto|high|medium|low, also a
HUD selector; `zoom` scales the preset camera distance).

**Big worlds:** one chunk is drawn in full at high quality. Anything bigger uses per-chunk LOD:
the chunks near the camera get the bevelled, studded look, the rest a merged flat-box mesh with
hidden faces removed (`src/lod.js`, `src/farmesh.js`), and `auto` quality drops a tier when
frames are slow (`src/quality.js`). Details and numbers: `docs/guide/06-viewer.md`. Adding `?shot=1` hides the HUD and stops
the render loop after the first frames (used by `screenshot.mjs`, which captures the canvas
via `window.__bloxCapture()` because a compositor screenshot times out under SwiftShader:
one frame takes about 30 s there).

Examples: `node screenshot.mjs ../build/shots hero t=20.5` writes `hero_t_20_5.png`;
`node screenshot.mjs ../build/shots gallery ids=38-40` writes a close-up of three pieces.

Controls: left drag pans, right drag orbits, wheel zooms; click a brick to see its feature,
type, colour, cell and which way it faces.

## How it fits together

```
world.js (embedded data) --> World (typed arrays + cell map) --> bricks.js BrickBatcher --> InstancedMeshes
                                  |  exterior.js (hidden studs)       ^ geometry.js / details.js / shapes.js
                                  |  glow.js (lit windows)            | materials.js (+ ripples.js)
                                  |  picking.js (grid raymarch)
contract/models/*.json --> models.js (THREE.Group per model, child group per part)
                                  --> demo.js: PathMover (mover.js) gives a pose each frame
```

**Rotation in one rule** (CONTRACT section 2): every directional piece has a front, and at rot 0
it faces +j (north). Code says which way the front faces and lets `src/rotation.js` do the rest:

```js
import { facingToRot, rotatedExtent, footprintCell, frontDir } from './rotation.js';
const rot = facingToRot('E');              // front looks east
const [ei, ej] = rotatedExtent(2, 1, rot); // 1 x 2 cells along (i, j)
const [di, dj] = footprintCell(2, 1, rot, 0, 0);
```

`src/placement.js` turns a record into a three.js matrix. Geometry is always modelled with its
front toward -z (north), centred on the unrotated footprint, so one matrix places any piece.
`npm test` checks both against `contract/test_vectors/rotation.json`.

**Moving things** (CONTRACT 7.1): `new PathMover({ path, speed, loop, turnRadius })` walks a
polyline given in Unity metres; `poseAt(s)` returns `{ position, yaw }` with yaw clockwise from
north. Corners are smoothed by placing a virtual front and rear axle `turnRadius` metres ahead
of and behind the point: heading = rear to front, position = their midpoint. `poseToObject`
applies a pose to a three.js object; `WalkCycle` swings `leg_*`/`arm_*` parts and `WheelSpin`
rolls `wheel_*` parts about their pivots. The demo bus, boat and walkers find their road,
river and a clear loop on the square from the data, and are clipped at the diorama edge so
they can turn around out of sight.

## Layout

| File | Role |
|---|---|
| `src/bxc.js` | `.bxc` chunk reader (header, raw-DEFLATE body via `DecompressionStream`) |
| `src/rotation.js` | facing rule: `facingToRot`, `rotatedExtent`, `footprintCell`, `frontDir` (pure) |
| `src/placement.js` | grid / Unity metres to three.js coordinates, brick matrix |
| `src/world.js` | World: bricks in typed arrays, cell -> brick map, column tops, bounds |
| `src/exterior.js` | occupancy grid (1 byte per cell) + flood fill of outside air (hidden studs, far faces) |
| `src/shapes.js` | box / lathe / extrusion helpers shared by all geometry |
| `src/geometry.js` | bricks, plates, tiles, slopes (0.05 m lip), round pieces (cached) |
| `src/details.js` | v2 detail pieces: arch, window, door, fence, round tile, jumper, grille |
| `src/bricks.js` | BrickBatcher: instanced meshes, colour variation, stud exposure, hide_studs |
| `src/lod.js` | ChunkLOD: near (instanced, studs) or far (merged) look per chunk, 2x2 far clusters, stud cap |
| `src/farmesh.js` | far LOD geometry: flat boxes / slope prisms / glass quads, hidden faces culled |
| `src/quality.js` | quality tiers, auto step-down on slow frames, fps meter |
| `tools/perf.mjs`, `tools/tile-world.mjs` | per-frame draw calls and triangles; tiled test world |
| `src/materials.js`, `src/ripples.js` | plastic / glass / water / metal / emissive; procedural water normals |
| `src/glow.js`, `src/hash.js` | which windows are lit at night (per window, deterministic) |
| `src/sky.js`, `src/ground.js` | gradient sky + its environment map; studded baseplate ground |
| `src/scene.js`, `src/post.js` | renderer, sun/time of day, shadows; AO, bloom, distance-aware tilt-shift |
| `src/picking.js` | click picking by stepping through the occupancy grid (3D DDA) |
| `src/models.js`, `src/mover.js`, `src/demo.js`, `src/placeholders.js` | brick models, path movers, the demo actors |
| `src/gallery.js`, `src/labels.js` | `#view=gallery`: every piece at N/E/S/W with a yellow marker in front |
| `src/presets.js` | camera presets derived from bounds and building features |
| `src/ui.js`, `src/main.js` | HUD, picking hookup, render loop |

Coordinates: three.js `x = I*0.5`, `y = K*0.2`, `z = -J*0.5` (north is -z, so the scene is not
mirrored). Rotations are clockwise seen from above (CONTRACT section 2).

Not affiliated with, endorsed or sponsored by the LEGO Group.
