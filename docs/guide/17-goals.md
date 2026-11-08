# 17. Light goals, navigation cues and the first minute

Optional things to do in the city, generated from the real data, plus quiet ways to find your
way. Code: `viewer/src/goals/` (hooked in by one line in `main.js` `initHooks`, after the report
hook). Tests: `viewer/test/goals.*.test.mjs`.

## Rules of the design

- **Never chores.** One goal at a time, always optional: every offer has *Not now* and *No goals*;
  every running goal has *Drop it*. Failing costs nothing; the card just says "another time".
- **No clutter.** One small card at the top right (`top: calc(60px + safe area)`, `right: 14px`,
  max 300 px), no minimap, no icon field. `O` folds the card to one line (or, with no goal running,
  opens a small "Goals" card: done so far, *Find one*, offers on/off). Hidden on the title screen
  and in screenshots (`body.title`, `body.shot`).
- **The hint is a direction, not a path.** A faint golden light beam stands on the destination
  (seen over the roofs, fading out in the last ~70 m), a small glint sits at the screen edge when
  the destination is off screen, and the card gives distance and compass direction ("320 m
  north-east"). The green ground line (`plan/groundline.js`, routed on the walk graph like the trip
  planner) appears only when the player presses *Show route*.

## The goals

| Kind | Offered when | Done when | Ends quietly when |
|---|---|---|---|
| **Tourist** | a named landmark, station, park or pleasant POI (café, museum, …) is 120–650 m away; the nearest passer-by (life walkers, within 28 m) stops and gets a "?" | you walk within 20 m of it | the generous time runs out: 90 s + 1.6 s per metre (straight line) |
| **Bus** | a bus (not rail) leaves a stop within 350 m in 2–15 game minutes and you can walk there; target: a built stop 2–6 calls on (3 calls on is the favourite) | you ride that line and get off at that stop (the stop's name seen while dwelling, or you step off within 90 m) | 25 game minutes after the departure, while not riding |
| **Golden hour** | game clock 15:45–17:36, a viewpoint 150 m–2 km away | you walk within its radius before sunset | the sun sets (18:00 on the game clock: `scene.js` `sunAt`) |

Viewpoints (`goals/spots.js`): Fort Sint Pieter, Hoge Brug, Wilhelminabrug, Sint Servaasbrug and
the city wall (Onze Lieve Vrouwewal). Each has a GPS fallback; a feature in `features.json` with a
matching name wins (it follows the data). Places outside the built city are never offered
(`player/spot.js` `builtAt`).

Pacing (`goals/flow.js`): offers only while walking freely (not riding, not on the map, not during
a planned trip). An ignored offer goes away after 30 s. Next offer: ~150 s of walking after a goal
ends, ~300 s after *Not now*.

Reward: a short note ("Goals done: 7") and a tally in `localStorage` `blox.goals.v1`
(`{ total, tourist, bus, golden, prompted?, off? }`), read and written in try/catch. Nothing else
depends on it.

## Navigation cues

- **Beam** (`cues.js` `Beam`): an open cylinder, additive, no fog, 160 m tall, brightest at the
  street and fading upward; its width grows with camera distance so it stays a few pixels wide.
  Strength from `screen.js` `beamOpacity` (0 within 12 m, full from 70 m).
- **Edge glint** (`EdgeGlint`): a small pulsing golden chevron, walk mode and riding only. A target
  in front but off screen puts it on the matching edge; a target behind you puts it on the left or
  right edge (the way to turn), never under the bottom hint bar (`screen.js` `edgeArrow`).
- **Tower names** (`TowerLabels`): "Sint-Jan" and "Sint-Servaas" as tiny white text over the tower
  top, only when looking within ~10° of the tower from more than ~300 m away (`towerAlpha`).
- DOM cues are placed right after the frame is drawn (goals wraps `stage.render` after the player
  and the ride did), so they never lag the camera by a frame.

## The first minute

After the title screen, at the map view, the card shows once ever: "Double-click the Markt to walk
there" ("Double-tap" on touch), with the beam standing on the Markt. It goes when the player walks,
presses OK, or after 14 s. The first walk of each visit gets the first offer after ~20 s of walking
(a tourist if one fits). `citymode.js` and the title screen are untouched.

## Debugging

`window.__bloxGoals`: `goal`, `offer`, `tally`, `flow`, `offerNow()`, `accept()`, `drop()`.
Clear `localStorage['blox.goals.v1']` to see the first-minute prompt again.

## Open decisions

- On touch there is no `O` key: after *No goals* the offers stay off until storage is cleared
  (the player's menu could get a "Goals" toggle).
- The bus goal does not press *Get off* for you; the card says when to.
