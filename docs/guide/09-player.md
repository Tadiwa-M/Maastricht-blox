# 09: Player (walk mode in the web viewer)

Folder: `viewer/src/player/`. Drop into a third-person walk anywhere in the city and explore it
with keyboard + mouse, a gamepad or touch. Phase 2 track P (see `PLAN.md`).

## How to use

Walk mode plays like an open-world third-person game: **click the world to capture the mouse**
(Pointer Lock), then just move the mouse to look around, no button held. Esc frees the mouse
(the browser's rule), Esc again opens the menu, M goes back to the map.

| Action | Keyboard + mouse | Gamepad (standard mapping) | Touch |
|---|---|---|---|
| Walk here (from the map) | F (point under the cursor) / double-click / "Walk here" button (screen centre) | A (screen centre) | double-tap |
| Look (walk) | click once to capture the mouse, then move it; Q E turn | right stick (curve + turn boost) | drag on the right half |
| Free the mouse | Esc | | |
| Move (camera-relative) | W A S D / arrows | left stick | joystick (left half) |
| Run | Shift | push the stick fully / LB | push the joystick fully |
| Jump | Space | A | JUMP button |
| Zoom | wheel / + - | LT (out) / RT (in) | pinch |
| Back to the map | M / "Map" button | B | "Map" button |
| Menu: controls + camera settings | H, or Esc while the mouse is free | Start / Select | |
| Rotate the map | right drag / Ctrl or Alt + left drag / Q E (hold) | right stick | two-finger drag |
| Tilt the map | middle drag / right drag up-down | right stick up-down | two-finger drag up-down |
| Face north | click the compass (bottom right) | | tap the compass |
| Pan / zoom the map | left drag / wheel | left stick / LT RT | one finger / pinch |

**Camera settings** (in the menu, saved per browser in `localStorage` under
`blox.player.settings.v1`; storage failures fall back to the defaults): mouse/touch
sensitivity (0.2-3×), invert Y (mouse/touch), controller sensitivity (0.3-2.5×), invert Y
(controller), and "camera eases behind you while walking" (auto-recenter, on by default).

Walking is 1.4 m/s, running 4 m/s; an analog stick between scales the walk speed. Plugging in
a controller shows "Controller connected" and switches the hints to gamepad buttons.

URL: `#mode=walk&at=x,z[&yaw=deg][&camyaw=deg][&pitch=deg][&dist=m]` starts in walk mode at Unity
metres `x` (east), `z` (north) (CONTRACT 1; the Markt sample: `at=700,1505`). `yaw` is the
compass direction the figure faces, `camyaw` where the camera looks (default: `yaw`).

Screenshots and a real-data collision probe:
```bash
cd viewer && node build.mjs ../samples/markt_v3 --around markt
node tools/walk-shots.mjs ../build/shots/player 700,1505   # walk_start / walk_to_island / walk_turned
node screenshot.mjs ../build/shots/player hero "mode=walk&at=700,1505&yaw=0"
```

## Modules

```
main.js  [player hook] -> player/index.js initPlayer(ctx)   ctx = { stage, camera, controls, city?, models, ui, world, islands, lod }
  index.js        modes (map <-> walk), camera tweens, per-frame tick (wraps stage.render), URL hash, window.__bloxPlayer
  city-adapter.js city query API from the in-memory World + islands (used until/unless ctx.city is given)
  controller.js   CharacterController: kinematic cylinder against city.isSolid
  camera.js       FollowCamera (aim + damped shown values) + pullIn (collision-aware orbit)
  look.js         rotation math: yaw wrap, pitch clamp, mouse sensitivity/invert, camera-relative
                  heading, smoothDamp, gamepad StickLook curve, auto-recenter, map spin damping
  input.js        BINDINGS table, deadzones, pointer lock, keyboard/gamepad/touch -> one frame of actions
  settings.js     camera settings: defaults, sanitize, localStorage load/save (try/catch)
  maporbit.js     map mode extras: Ctrl/Alt-drag orbit, middle-drag tilt, damped Q/E/stick turn, north()
  character.js    contract/models/character.json + WalkCycle (mover.js), run lean, idle sway
  hud.js          Walk/Map button, hints (follow the mouse lock), street name, menu with the
                  settings form, compass, toasts, touch joystick
  ray.js          raycastCity (screen point -> ground) + spawn point
  streets.js      nearest street name from features.json
  hash.js         #mode=walk parser
```

### City query API

Everything collides through two functions in three.js world metres (x east, y up, z = -north):
`isSolid(x, y, z) -> true | false | 'unknown'` and `groundHeight(x, z) -> y | 'unknown'`
('unknown' = not loaded). The viewer core's streaming `src/city.js` provides them; until it is
passed in as `ctx.city`, `city-adapter.js` builds them from the World (chunk occupancy, unknown
outside loaded chunks, solid below the world) and each island (the point goes through the
inverse island pose into local cells, exactly like picking). Island buildings therefore
collide like any other brick.

### Controller

- Body: a vertical cylinder, radius 0.35 m, height 1.9 m, feet at the pose position. Collision
  samples a ring of 8 points + the centre every 0.15 m up the body (finer than a 0.2 m plate).
- Anything that is not `false` is solid, so **unknown (unloaded) space is a wall and a floor**:
  you stop at its edge and can never fall through it. Standing inside unknown space freezes the
  player until the city knows what is there.
- Horizontal velocity eases toward the wanted velocity (12 m/s² on the ground, 3 in the air);
  the move is cut into ≤ 0.1 m sub-steps and resolved per axis, so the body slides along walls
  (also turned island walls) and never tunnels through one at a low frame rate.
- **Step up** to 0.42 m (1-2 plates: kerbs, steps); a 3-plate (0.6 m) brick is a wall. Walking
  off a step of up to 0.42 m snaps down instead of hopping. Higher drops fall with gravity
  (18 m/s²) and land exactly on the surface (bisection). Jump: 4.4 m/s, a ~0.5 m hop.
- Movement is camera-relative (`look.js moveHeading`: W walks where the camera looks, S toward
  it); the figure turns smoothly toward the move direction (exponential, 10 /s, frame-rate
  independent).
- Spawned inside geometry (a click on a wall or roof), the body is lifted up to 4 m to free
  space, then falls.

### Camera

Orbit around the shoulder (1.6 m above the feet): yaw (unlimited, wrapped to ±180°), pitch
(−35° to 70°), distance 1.2-14 m (default 5 m, pitch 13°, so the sky is visible behind the
city). Input moves an *aim* (`aimYaw`, `aimPitch`, `aimDist`); the shown values follow it with
a critically damped spring (`smoothDamp`, 0.05 s for rotation, 0.14 s for zoom), stable and
overshoot-free at 10 fps, so mouse, stick and touch input never jitter. Assigning
`follow.yaw/pitch/want` (URL hash, scripts) snaps aim and view together.

Look sources: pointer-lock mouse 0.003 rad/px × sensitivity (raw input via
`unadjustedMovement` where the browser supports it; the first events after locking and lone
jumps over 2000 px are dropped, a Chrome-on-Windows quirk); unlocked mouse drag uses the same
rate (only one path feeds an event, so deltas are never applied twice); touch 0.006 rad/px ×
sensitivity; right stick |v|^1.8 × 3.2 rad/s yaw / 2.1 rad/s pitch, +70% after 0.25 s at
full tilt (ramped over 0.5 s); Q/E 1.8 rad/s.

Auto-recenter: after 2 s without look input while walking forward-ish (move within 50° of
straight ahead), the aim yaw eases behind the figure (rate 0.9 /s, at most 1.2 rad/s, faded in
over a second). Walking toward the camera or sideways never recenters (that would chase the
player in circles). Off in the menu. Each frame `pullIn` marches
5 parallel rays (centre and ±0.18 m around it, the size of the near plane) from the shoulder
toward the wanted camera point and stops 0.3 m before the first solid sample; pulling in is
instant, easing back out is smooth. Unknown space does not block the camera. When the camera is
squeezed closer than 0.9 m the figure is hidden. Walk mode uses a 55° field of view and a 0.1 m
near plane (restored on exit). Entering and leaving walk mode tweens the camera over 1.1 s.

### Map mode camera

`MapControls` keeps left-drag pan, right-drag orbit and wheel zoom (with `CityCamera`'s tilt
rules in the streamed city). `maporbit.js` adds, in a capture-phase `pointerdown` so it runs
before MapControls: Ctrl/Alt (or Cmd) + left drag orbits, middle drag tilts. Q/E and the
gamepad right stick queue rotation on the same pending spin, applied each frame with
exponential damping (rate 14 /s) around `controls.target`, with the polar angle kept inside the
controls' (zoom-dependent) limits. The compass (bottom right, both modes) points north on
screen; a click turns the map view (or the walk camera) to face north.

### Input

One table, `BINDINGS` in `input.js`, holds every key code, gamepad button/axis index,
deadzone and sensitivity, so remapping is a data change. Sticks use a radial deadzone (0.18,
rescaled so the response starts at 0), triggers 0.08. Gamepads are polled every frame
(`navigator.getGamepads`, hot-plug events show a toast). Key taps shorter than one frame
still count once. Touch controls appear only on coarse-pointer touch devices in walk mode.

### Street name

`features.json` street features only carry a bounding box, so the HUD picks the street with the
lowest `distance to box + 0.1 × box short side` within 30 m: small squares and narrow streets
win over a long diagonal road whose box covers half the map.

## Tests

`viewer/test/player-look.test.mjs` (yaw wrap, pitch clamp, sensitivity, invert Y,
camera-relative heading, smoothDamp at 144/60/10/4 fps, stick curve + boost, auto-recenter,
settings load/save with a throwing storage, map orbit + spin damping, map drag mapping, HUD
hints), `viewer/test/player-input.test.mjs`, `player-controller.test.mjs`, `player-camera.test.mjs`
(+ `player-city.mjs`, a synthetic cell grid with rotated boxes and an unknown region):
deadzones, key/gamepad mapping, edges, speeds; walk/run speed, step-up of 1 and 2 plates,
3-plate wall stop, sliding, step-down snap, fall and exact landing, no tunnelling at 10 fps,
rotated boxes at +30°/−20°, unknown space, jump, facing, lift out of a block, the adapter over
a real World; camera pull-in against walls/floor, snap-in/ease-out, raycast + spawn point,
street names and the URL hash.

`tools/walk-shots.mjs` also walks the figure from the Markt toward the 6 nearest islands in
`samples/markt_v3` and counts body samples inside solid cells (0 on all six).

## Open issues

- The contract character is 4 studs (2 m) wide with its arms and 2 m tall; with a 0.35 m body
  radius its arms overlap walls when it walks alongside them, and it can't visually fit a 1 m
  door. A slimmer character model (pipeline `blox_pipeline.models`) would fix both.
- Water is solid (you can walk on the Maas). The city API has no material query yet.
- Map-mode "Walk here" with a gamepad uses the screen centre (no cursor).
- Pointer lock cannot be exercised in headless Chromium: the lock path (`movementX/Y`, spike
  filter, Esc handling) is unit-tested as pure functions but only hand-tested in a real browser.
- Browsers refuse a new pointer lock for about a second after Esc released it; a click right
  away does nothing (click again).
- Entering walk mode via the "Walk here" button or F captures the mouse at once; via the
  gamepad (no user gesture) the hint asks for a click.

## Getting back to the map (2026-10-30)

Visitors kept asking how to get back to the map from walk mode: the mouse is captured, so the
bottom bar's Map button can't be clicked, and people try to zoom out the Google Maps way. Now:
- **Scroll or pinch out past the farthest walk camera** -> back to the map (`ZoomOutExit` in
  `camera.js`: zoom-out that arrives while the camera is at `maxDist` builds up, and 1.6 m of it
  leaves; zooming in resets it, idle time drains it; "Keep zooming out for the map" shows on the way).
- A **Map** button with a `M` key cap, top right, always visible while walking (`#pl-back`).
- A tip the first three times someone starts walking ("To fly back to the map, press M or
  scroll out"; touch: pinch out or tap Map; controller: press B), counted in `localStorage`.
- Hints now say "M or scroll out: map"; the start screen's "Back to map" card says the same.

## Ride: buses and trains (2026-10-30, phase R1: timetable)

The owner's goal: open the app instead of Google Maps, see the buses and trains on the city map,
tap one and ride along as a passenger, looking around and out of the windows.
- **Transit button** (bottom left, or `T`): a side panel with two tabs.
  - **Running now:** line chips (tap one to draw its route on the city and filter), and every
    vehicle on the move with "Next: <stop> · 2 min" and **Ride**.
  - **Stops:** search a stop name to get the next departures there; **Jump on** skips the life
    clock to just before that departure and boards it.
  While the panel is open, route-coloured badges float over the vehicles on the map; tapping one
  boards it.
- **Riding** (`ride/index.js`, math in `ride/seat.js`): every frame the camera sits on a
  passenger seat (`SEATS`: a little ahead of the middle on the left, eye 1.75 m, inside the
  window band of both brick models) of the vehicle's current pose (`life/buses.js` poses). The
  vehicle heading is smoothed (`smoothYaw`), since shapes are polylines. Look around by dragging,
  with arrows/Q/E, or the right stick. The HUD shows the line, the destination, the next stop with
  minutes, and the following stops, plus buttons: **Get off at <stop>** (steps off when the
  vehicle reaches it and continues in walk mode from the stop), **Outside view** (chase camera),
  **Fast** (life clock 10x) and **Map**. Esc / B also leave. When the trip ends you are put back
  on the map above it.
- **Trains:** `blox life` now keeps `bus,rail` by default. Rail routes get their own fleet with
  the new `train` brick model (6 x 52 studs, hollow saloon, doors both sides) and no lane offset.
- **Data:** `transit.json` v2 adds `stops` (name, Unity m), `patterns[].stops`, `routes[].id` and
  `tripIds` (GTFS trip ids per row, for the live feed). v1 files still work: no stop names or
  boards. Re-run `blox life` to get v2.

Phase R2 (live positions and delays) is next; see PLAN.md.
