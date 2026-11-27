# Curriculum: the whole system, taught from this repo

Ten tracks. Each one names the files to read, the ideas to understand, one exercise on real code, and check questions
(`node learn/tools/quiz.mjs <track>` asks them). Order: 1 and 2 first, then follow what you're curious about.
Rendering is one track of ten, not the whole thing.

Every exercise follows the loop: **read → predict (write it down) → change one thing → run → compare → `git restore`**.

---

## 1. architecture: how the parts fit

**Why:** a systems architect's first question is "what are the components, and what are the contracts between them?"
This project has five components (pipeline, viewer, relay, proxy, Unity) that only meet through data files.

**Read:** [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) · [`CONTRACT.md`](../CONTRACT.md) sections 1 and 2 · [`PLAN.md`](../PLAN.md) section 3 (phases)

**Ideas:** components and interfaces · a contract as the single source of truth · why the pipeline and the viewer never
import each other · versioning a format (`contractVersion`) · pure logic vs. engine code (the two-engine rules).

**Exercise:** draw the data flow on paper, from open map data (BAG, AHN, BGT, OSM) to a brick on your screen. Name the
folder that owns each step. Then check your drawing against [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md), "Data flow".

**Check:**
- Q: Why do the pipeline and the viewer communicate only through files described in CONTRACT.md?
  - A: So each side can change, be tested and be replaced (three.js or Unity) independently; the contract is the only thing both must agree on.
- Q: When must contractVersion be bumped?
  - A: When a change breaks an existing reader. Purely additive, optional files don't need it, but must still be documented.
- Q: What does "logic modules are pure" buy us with two engines?
  - A: The same rules and numbers can be tested without an engine and reused by the browser and Unity versions.

---

## 2. coordinates: where things are

**Why:** most 3D bugs are coordinate bugs. Every system here agrees on one grid.

**Read:** [`CONTRACT.md`](../CONTRACT.md) section 1 · [`docs/guide/01-coordinates-and-rotation.md`](../docs/guide/01-coordinates-and-rotation.md) · [`contract/test_vectors/rotation.json`](../contract/test_vectors/rotation.json)

**Ideas:** a national projection (RD, EPSG:28992) · grid cells (stud 0.5 m, plate 0.2 m) · chunks · rotating by
*facing* (N/E/S/W) through one helper instead of hand-written maths · test vectors shared by every language.

**Exercise:** pick a place you know (the Markt). Using the RD → grid formula in CONTRACT.md section 1, work out its
chunk by hand. Then search [`docs/guide/03-chunk-format.md`](../docs/guide/03-chunk-format.md) for how chunk file names are built, and check that
your answer would be a valid file name.

**Check:**
- Q: How big is one stud and one plate?
  - A: A stud is 0.5 m horizontally; a plate is 0.2 m vertically (a brick is 3 plates, 0.6 m).
- Q: Why do all languages test against contract/test_vectors/rotation.json?
  - A: One shared answer key: if Python, JS and C# all pass it, they rotate pieces identically.

---

## 3. pipeline: data in, world out

**Why:** the world isn't modelled by hand; it's generated. Pipelines are input → transform → output, tested at each stage.

**Read:** [`docs/guide/02-pipeline.md`](../docs/guide/02-pipeline.md) · [`pipeline/src/blox_pipeline/cli.py`](../pipeline/src/blox_pipeline/cli.py) ([`cmd_build`](../pipeline/src/blox_pipeline/cli.py#L101)) ·
[`pipeline/src/blox_pipeline/sources/`](../pipeline/src/blox_pipeline/sources/) (one file per data source) · [`pipeline/src/blox_pipeline/voxelise/`](../pipeline/src/blox_pipeline/voxelise/)

**Ideas:** stages and their boundaries · caching downloads · voxelising (turning shapes into grid cells) · fixtures
(small fake inputs for tests) · corrections as data ([`corrections/corrections.json`](../corrections/corrections.json)) instead of code.

**Exercise:** run the pipeline's tests (`cd pipeline; uv run pytest -q`). Pick one test file, for example
[`tests/test_rotation.py`](../pipeline/tests/test_rotation.py), read one test, break the code it tests on purpose, watch it fail, restore it.

**Check:**
- Q: Why are map mistakes fixed in corrections.json when possible, not in code?
  - A: Data fixes are small, reviewable and don't risk breaking every other building; code is for a whole class of problem.
- Q: What is a fixture?
  - A: A small, fixed input used by tests so they run fast and give the same answer every time.

---

## 4. formats: files that machines agree on

**Why:** binary formats are contracts too. Readers and writers must round-trip exactly.

**Read:** [`docs/guide/03-chunk-format.md`](../docs/guide/03-chunk-format.md) · [`pipeline/src/blox_pipeline/io/format.py`](../pipeline/src/blox_pipeline/io/format.py) and [`chunk_writer.py`](../pipeline/src/blox_pipeline/io/chunk_writer.py) ·
the viewer's reader [`viewer/src/bxc.js`](../viewer/src/bxc.js) · [`pipeline/tests/test_io.py`](../pipeline/tests/test_io.py)

**Ideas:** headers and magic numbers · byte order · versioning · golden files (a known-good file both sides must read).

**Exercise:** read the chunk header layout in guide 03. Then find where [`viewer/src/bxc.js`](../viewer/src/bxc.js) reads the same fields.
Write down which bytes mean what, and check one against the test.

**Check:**
- Q: What is a golden file for?
  - A: A known-good file that every reader and writer is tested against, so formats can't drift apart silently.

---

## 5. rendering: from data to pixels

**Why:** the look of the game is a pipeline too: geometry → materials → lighting → post-processing → the frame.
Learn to look at a picture and name the stage that's wrong.

**Read:** [`viewer/src/titlefx.js`](../viewer/src/titlefx.js) (one shader, about 80 lines: start here) · [`viewer/src/render/verse.js`](../viewer/src/render/verse.js), the [`manga()`](../viewer/src/render/verse.js#L156)
function · [`viewer/src/render/mangafx.js`](../viewer/src/render/mangafx.js) ([`PALETTES`](../viewer/src/render/mangafx.js#L12)) · [`viewer/src/scene.js`](../viewer/src/scene.js) (lights and time of day) ·
[`docs/guide/06-viewer.md`](../docs/guide/06-viewer.md)

**Ideas:** vertex vs. fragment shader · uniforms (numbers sent from JS to the shader) · the depth buffer · colour
grading · post-processing passes · draw calls and instancing.

**Exercises:**
1. In [`titlefx.js`](../viewer/src/titlefx.js), change `dots` in [`TITLE_FX`](../viewer/src/titlefx.js#L10) from 9 to 20. Predict first. Rebuild and look at the title screen.
2. In [`verse.js`](../viewer/src/render/verse.js), in [`manga()`](../viewer/src/render/verse.js#L156), find `vec3 warm = ...`. That line was the "too yellow" fix. Push it back toward
   yellow (raise the first number, lower the third) and see the Manga look turn warm again. Name the pipeline stage.

**Check:**
- Q: What is the difference between a vertex shader and a fragment shader?
  - A: The vertex shader places each corner of a shape on screen; the fragment shader decides the colour of each pixel inside it.
- Q: What is a uniform?
  - A: A value the program sends to the shader that is the same for every pixel in a draw (time, colours, screen size).
- Q: The Manga look was "too yellow". Which stage was that: geometry, material, lighting or post-processing?
  - A: Post-processing (the colour grade), plus the sky palette.
- Q: Why did zooming out on the map once paint the city as sky?
  - A: The shader treated anything farther than a fixed depth as sky; zoomed out, the whole city was farther than that.

---

## 6. gameplay: input, movement, feel

**Why:** "feel" is mostly numbers in the right place: input mapping, acceleration, recoil, shake, sound.

**Read:** [`viewer/src/player/input.js`](../viewer/src/player/input.js) ([`BINDINGS`](../viewer/src/player/input.js#L28)) · [`viewer/src/player/controller.js`](../viewer/src/player/controller.js) · [`viewer/src/mp/weapons.js`](../viewer/src/mp/weapons.js)
(`feel` per weapon) · [`viewer/src/mp/impact.js`](../viewer/src/mp/impact.js) ([`IMPACT`](../viewer/src/mp/impact.js#L7)) · [`viewer/src/mp/combat.js`](../viewer/src/mp/combat.js) (search for `const hip`)

**Ideas:** one binding table for keyboard and gamepad · game loop and delta time · tuning tables vs. code ·
viewmodel placement (where the gun sits on screen) · feedback layers (sound, shake, rumble, hitmarker).

**Exercise:** the gun blocks the view when not aiming. In [`combat.js`](../viewer/src/mp/combat.js), `const hip = new THREE.Vector3(0.19, -0.19, -0.42)`
is the gun's hip position in camera space (x right, y up, z forward is negative). Predict which number moves it lower
and further right, change it, play a match, and compare with how Call of Duty places its gun.

**Check:**
- Q: Why are all the controls in one BINDINGS table?
  - A: Remapping or adding a controller is then a data change, not a code change, and it can be tested without a browser.
- Q: Why multiply movement by delta time (dt)?
  - A: So the game runs at the same speed whether the frame rate is 30 or 144.

---

## 7. characters: rigs and poses

**Why:** the figures' stiffness or swagger comes from joint data. Poses are authored numbers, not engine magic.

**Read:** [`viewer/src/figure/rig.js`](../viewer/src/figure/rig.js) ([`PAIR_REST`](../viewer/src/figure/rig.js#L31) and the joint tables) · [`viewer/src/figure/lookstyle.js`](../viewer/src/figure/lookstyle.js) (poses per look) ·
[`viewer/src/figure/animeparts.js`](../viewer/src/figure/animeparts.js) and [`verseparts.js`](../viewer/src/figure/verseparts.js) (each look's own build)

**Ideas:** joints and rest poses · forward kinematics · blending poses · why each look owns its figures.

**Exercise:** find one Manga pose in [`lookstyle.js`](../viewer/src/figure/lookstyle.js). Change one joint angle (a knee or the spine) by a small amount,
predict the silhouette, look at it with the figure sheet ([`viewer/tools/figure-sheet.mjs`](../viewer/tools/figure-sheet.mjs)) or in game.

**Check:**
- Q: What is a rest pose?
  - A: The joint angles a figure has before any animation or pose is applied; poses are offsets from it.

---

## 8. networking: rooms and rules

**Why:** multiplayer is a distributed system: who decides what happened, and how do clients agree?

**Read:** [`docs/guide/18-multiplayer.md`](../docs/guide/18-multiplayer.md) · [`relay/src/ctf.js`](../relay/src/ctf.js) (the capture-the-flag rules) · [`relay/src/room.js`](../relay/src/room.js) ·
[`viewer/src/mp/localroom.js`](../viewer/src/mp/localroom.js) (the same rules run locally for bots)

**Ideas:** authoritative server · messages and protocols · cooldowns (`CTF.guard`: 2000 ms of protection, every 7500 ms) ·
sharing rule code between server and client so they can't disagree.

**Exercise:** read how [`guard`](../relay/src/ctf.js#L283) is checked in [`relay/src/ctf.js`](../relay/src/ctf.js). Change `coolMs` and run the relay tests
(`cd relay; npm test`). Which test notices?

**Check:**
- Q: Why does the relay, not the player's browser, decide whether a shot hit?
  - A: An authoritative server stops cheating and keeps every player's view of the match consistent.

---

## 9. performance: keeping it smooth

**Why:** one beautiful screenshot is easy; a whole city at 60 fps on a phone is engineering.

**Read:** [`viewer/src/quality.js`](../viewer/src/quality.js) ([`DynamicResolution`](../viewer/src/quality.js#L93), tiers) · [`viewer/src/citymode.js`](../viewer/src/citymode.js) (the frame loop: search for
`pendingChange`) · [`viewer/src/lod.js`](../viewer/src/lod.js) · [`viewer/tools/perf.mjs`](../viewer/tools/perf.mjs)

**Ideas:** frame budget (16.7 ms at 60 fps) · level of detail · dynamic resolution · draw calls · memory (the
700 MB tab) · profiling before optimising.

**Exercise:** open the game in Chrome, press F12, Performance tab, record 5 seconds of walking. Find the longest frame
and what took the time. Then read [`case-studies.md`](case-studies.md), "The white flash".

**Check:**
- Q: What is the frame budget at 60 fps?
  - A: About 16.7 milliseconds for everything: input, simulation, rendering.
- Q: Why does the game change its resolution on the fly?
  - A: Dynamic resolution keeps the frame rate steady by drawing fewer pixels when the GPU is behind.

---

## 10. tooling: automation and working with agents

**Why:** systems architects build the tools that build the system. Scripts, tests and CI are what let an agent (or you)
change things safely.

**Read:** [`scripts/check.sh`](../scripts/check.sh) (the quality gate) · [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) · [`viewer/tools/film.mjs`](../viewer/tools/film.mjs) and
[`contract/shots.json`](../contract/shots.json) · [`scripts/unity.ps1`](../scripts/unity.ps1) · [ai-dilemma.md](ai-dilemma.md)

**Ideas:** one-command quality gates · CI · headless automation · data-driven tools (shots as JSON) · verifying results
by output, not by claims · writing handoff prompts.

**Exercise:** run [`scripts/check.ps1`](../scripts/check.ps1) (or [`check.sh`](../scripts/check.sh)) yourself. Then read [`case-studies.md`](case-studies.md), "The black frame", and write,
in your own words, the rule it teaches.

**Check:**
- Q: Why must scripts/check run before every push?
  - A: It runs every test suite and bundles the game, so a change can't silently break another component.
- Q: An agent says "the world loaded fine" because a log line says so. What should you check?
  - A: The actual output: the screenshot, the game, the test results. A log line proves the data was read, not that it rendered.
