# 09: Player (walk mode in the web viewer)

Folder: `viewer/src/player/`. Drop into a third-person walk anywhere in the city and explore it
with keyboard + mouse, a gamepad or touch. Phase 2 track P (see `PLAN.md`).

## How to use

| Action | Keyboard + mouse | Gamepad (standard mapping) | Touch |
|---|---|---|---|
| Walk here (from the map) | F (point under the cursor) / double-click / "Walk here" button (screen centre) | A (screen centre) | double-tap |
| Move | W A S D / arrows | left stick | joystick (left half) |
| Run | Shift | push the stick fully / LB | push the joystick fully |
| Jump | Space | A | JUMP button |
| Look (orbit camera) | drag the mouse / Q E | right stick | drag on the right half |
| Zoom | wheel / + - | LT (out) / RT (in) | pinch |
| Back to the map | Esc / "Map" button | B | "Map" button |
| Help overlay | H | Select | |
| Map mode with a gamepad | | left stick pans, right stick orbits, LT/RT zoom | |

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
  camera.js       FollowCamera + pullIn (collision-aware third-person orbit)
  input.js        BINDINGS table, deadzones, keyboard/gamepad/touch -> one frame of actions
  character.js    contract/models/character.json + WalkCycle (mover.js), run lean, idle sway
  hud.js          Walk/Map button, hints, street name, help overlay, toasts, touch joystick
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
- The figure turns toward the move direction (12 rad/s); movement is camera-relative.
- Spawned inside geometry (a click on a wall or roof), the body is lifted up to 4 m to free
  space, then falls.

### Camera

Orbit around the shoulder (1.6 m above the feet): yaw, pitch (−26° to 72°), distance 1.2-14 m
(default 5 m, pitch 13°, so the sky is visible behind the city). Each frame `pullIn` marches
5 parallel rays (centre and ±0.18 m around it, the size of the near plane) from the shoulder
toward the wanted camera point and stops 0.3 m before the first solid sample; pulling in is
instant, easing back out is smooth. Unknown space does not block the camera. When the camera is
squeezed closer than 0.9 m the figure is hidden. Walk mode uses a 55° field of view and a 0.1 m
near plane (restored on exit). Entering and leaving walk mode tweens the camera over 1.1 s.

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

`viewer/test/player-input.test.mjs`, `player-controller.test.mjs`, `player-camera.test.mjs`
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
