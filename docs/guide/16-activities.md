# 16: Activities (quiet things to do on foot)

Folder: `viewer/src/activities/`. In walk mode the player can sit on a cafe terrace, ride a
parked bike, ride along on a river boat and feed the ducks. One key does what fits where you
stand: **G** on a keyboard, **X** (left face button) on a gamepad, or the prompt pill that appears
just above the walk bar (a button: tap it on a touch screen). The pill hides on the title screen,
while riding a bus or train (`body.riding`) and in screenshots.

| Where you stand | Prompt | What happens | Ends with |
|---|---|---|---|
| Next to a free terrace chair (1.6 m) | Sit down (G) | You sit facing the table, the camera eases to a low view out over the street; the clock runs 10x | G, walking or jumping ("Stand up") |
| Next to a parked bike (1.7 m) | Ride bike (G) | You take it from the rack: cycling pose, the bike under you, 4.6 m/s cruising, 7.2 m/s with Shift | G ("Get off the bike"): it stays where you are, you step off to the left |
| By the river (water within 7 m) with a boat within 48 m | Board the boat (G) | You stand on its deck (the stern, found by a ray down onto the model), looking out toward the bank you came from, wide camera | G ("Get off at the next quay"): you step ashore at the next open bit of bank in reach; G again stays aboard |
| At the water's edge (6 m) | Feed the ducks (G) | You face the water and throw bread; crumbs fly, land and float; ducks swim over and dabble | the bread is eaten (or sinks after 45 s) |

Choice order (`choose.js`): busy states first (G ends them), then the nearer of chair and bike,
then a boat in reach, then the ducks.

## How it works

- **Driving the player.** Only through its public API (`window.__bloxPlayer`): `ctrl` (position,
  heading, speeds `ctrl.o.walk/run/jumpSpeed`), `follow` (the camera's aim), `enterAtUnity`
  (stepping ashore) and `character.override`. The override is a function the figure calls before
  posing itself (`player/character.js`): it returns a pose (`MODE.SIT`, `MODE.CYCLE`, `MODE.IDLE`
  on deck) or null for the normal walk. The ridden bike is drawn inside that call so it never lags
  the rider by a frame. Walking collision is unchanged on the bike: it rides on streets and
  stops at walls like walking.
- **Terraces** (`life/terraces.js`): `freeSeat(x, z, r)` finds the nearest chair nobody is drawn
  on; `taken` keeps it empty while you sit. `terraceShare(hours, day, rain, weather)` sets how
  full the terraces are: the time of day (density.js), rain (the larger of life's rain and
  `weather.rain`), cold (full from 16 C, about an eighth near freezing) and cloud (up to -15 %).
  `weather` is `window.__bloxLife.weather = { rain, tempC, cloud }` when a weather source sets it;
  without it nothing changes.
- **Parked bikes** (`parked.js`): when life shares its rows as `window.__bloxLife.parked`, a taken
  bike leaves its rack (marked `gone`, moved off the map) and is moved to wherever you leave it,
  still drawn by life. Without that, the rows are rebuilt from `life/streets.json` (same seed:
  the same bikes) and the bikes you leave are drawn by the activities' own small VehicleFleet
  (the original stays drawn at its rack in that case).
- **Boats** (`life/boats.js` `nearest`): each frame, after life moved the boats, the player is
  put on the deck point (stored in the boat's local frame) and the walk speeds are zero.
  `water.js findLanding` scans rings around the boat for land: not water, free 1 m and 1.7 m up,
  open 3 m up (no arcade or roof), at most 9 m above the water, the lowest on the nearest ring.
- **Ducks** (`ducks.js`, `duck-mesh.js`): seven ducks (drakes and hens, two InstancedMeshes, plus
  one for the bread: three draw calls at most) live only near the player. Every second a few
  random points within 32 m are tested for water (`city.isWater` under the column top, cached per
  0.5 m cell); ducks appear on those and are moved back when 55 m away. Steering: wander, keep
  1.2 m apart, keep off the player, swim to the nearest landed crumb within 30 m and eat it;
  a probe 0.6 m ahead keeps them on the water. This finds the Maas, the Stadspark ponds and the
  Jeker alike, with no extra data.

## Files

| File | What |
|---|---|
| `index.js` | `initActivities(ctx)`: the glue (input, prompt, the four activities, drawing) |
| `choose.js` | which action G does (pure) |
| `seat.js` | where you sit, the seated camera, when sitting ends (pure) |
| `bike.js` | bike in reach, riding speeds, pedals, getting off (pure) |
| `water.js` | water surface, distance to water, landing spot, water ahead (pure, city API) |
| `ducks.js` | the duck flock and the bread (pure) |
| `duck-mesh.js` | brick ducks and crumbs (three.js) |
| `prompt.js` | the prompt pill (DOM) |
| `parked.js` | the parked bikes to take (life's, or rebuilt from streets.json) |

Tests: `viewer/test/activities.test.mjs`. Debug: `window.__bloxActivities` (`state`, `near()`,
`ducks`, `parked`, `left`).

## Riding that feels like a bicycle (2026-11-15)

- **Physics** (`player/locomotion.js` `ride`, options `BIKE_LOCO`, set on mounting and undone on
  getting off): pedalling builds speed at 2.6 m/s² (cruising in about two seconds, flat out in
  three), letting go rolls on (0.45 m/s² of drag), pulling back brakes hard (6.5 m/s²) instead of
  spinning round, and the tightest turn is a 2.4 m radius at speed; at a crawl it turns slowly,
  as when walking the bike round.
- **Rider** (`activities/bike.js` `riderLean`, `Pedals`): bike and rider lean into turns as
  physics wants (tan = speed x turn rate / g, up to 26 degrees), out of the saddle when pushing
  off hard from slow (a rock from side to side), the head looks into the turn, and when coasting
  the cranks stop level with the feet side by side while the wheels keep turning.
- **Bell**: Space, the jump button or gamepad A while riding: two synthesised rings
  (`activities/bell.js`), quiet and silent when sound is off.
- Tests: `test/bike.ride.test.mjs`. Not seen on screen yet: the headless check cannot drive a ride.

