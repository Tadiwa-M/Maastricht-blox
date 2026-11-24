# 18: Multiplayer (capture the flag)

Folders: `viewer/src/mp/` (the game side), `relay/src/ctf.js`, `room.js`, `rooms.js` (the rooms on
the Cloudflare Worker). A first playable: 2 to 8 friends in one room, two teams, the old town
between the Markt and the Vrijthof as the arena.

## How to play

1. The round **PLAY** button on the right edge (above the report button) opens the lobby panel.
2. Choose a nickname (up to 12 characters, remembered) and **Create a room**, or type a friend's
   4-letter code and **Join**. A link with `#mp=ABCD` fills the code in and opens the panel.
3. Teams are balanced automatically: **blue** defends the **Markt** (the flag stands west of the
   Stadhuis steps), **yellow** the **Vrijthof**. The host (the star) presses **Start the match**.
4. Everyone starts at their base in walk mode. Walk onto the other team's flag to pick it up and
   carry it into your own base's ring of tiles while your own flag is at home: a capture.
5. Run into an enemy carrier to knock them down (the figure pops apart as when a bus hits you);
   the flag drops where they fell. After 1.5 s a teammate of the flag touching it (or already
   standing on it) sends it home, otherwise it goes home by itself after 20 s. The carrier's own
   team can pick it up again; the knocked-down carrier only after 3 s.
6. First to 3 captures wins, or the most captures after 8 minutes. The host can play again.

Leaving the old town (more than 120 m from the line Markt-Vrijthof) shows a red warning with a
5 s countdown, then you are put back at your base. A carrier who leaves the arena or teleports
(more than 30 m in one update: a bus, the map, the boundary) loses the flag: it goes home.

The top pill (on narrow phones just below the title box) shows blue's score, the clock (a flag sign when you carry one) and yellow's score;
lines about pickups, knock-downs and captures appear under it. Other players are the city's own
toy figures in their creator look (`#look=` / the character creator, `figure/custom.js`), with a
team-coloured gem over the head and their name above it.

## How it works

```
viewer (each player)                         relay Worker              BloxRoom Durable Object
 mp/index.js ── POST /room ────────────────> rooms.js ── /create ──> one per room code
            ── GET /room/ABCD (exists?) ──>          ── info ──────>
            ══ WebSocket /room/ABCD?pid&name&look ══════════════════> room.js (hibernation API)
               {t:'p'} position ~10 Hz  ─────────────────────────────> move(): the rules (ctf.js)
            <── {t:'p'} the others' positions, {t:'state'} snapshot, {t:'ev'} events ──
```

- **The room is authoritative** for teams, flags, score and the clock. Clients send only their
  position; every position runs the rules (`ctf.js move`: pickup, return by touch, capture,
  knock-downs), and an alarm runs the timers (`tick`: dropped flags home after 20 s, the end of
  the match, dropped connections, closing an empty room).
- **Positions are RD metres** (EPSG:28992) on the wire, `[east, height, north]`, so a room does not
  depend on a world's origin: each client converts with its world's `originRD` (Unity metres = RD
  minus the origin, CONTRACT 1; `protocol.js`). The bases are RD points in `ctf.js CTF.bases`.
- **Hibernation**: the object can be evicted between messages. The game is saved to storage
  whenever the snapshot changes (not on positions) and read back on wake; each socket's player id
  is its attachment; `ping` is answered `pong` by the runtime without waking it.
- **Reconnects**: each browser tab has a random player id (sessionStorage, so two tabs are two
  players). A dropped socket keeps its place (team, captures) for 30 s; the client retries after
  0.5, 1, 2, 4 s ... (`net.js`, `protocol.js backoff`) and a socket silent for 35 s is treated as
  dead (phones waking up). Pids never leave the room (the snapshot has only small numeric ids).
- **Smoothing** (`interp.js`): the others are drawn 120 ms in the past between the two samples
  around that moment, extrapolated up to 200 ms past the newest, and snapped on jumps over 15 m.
  Standing still, a client sends once a second instead of 10 times. Send rate, the boundary
  countdown and the spawn wait run on the wall clock, so slow frames don't stretch them.
- **Without room support** (the relay has no `ROOMS` binding yet, or no relay): `GET /room` is 404
  and the button only says "Multiplayer coming soon"; an unreachable relay says it is offline.

| File | What |
|---|---|
| `relay/src/ctf.js` | the rules, pure: join/rebalance, start, move, tick, snapshot |
| `relay/src/room.js` | `BloxRoom` Durable Object: sockets, storage, alarm, relaying positions |
| `relay/src/rooms.js` | Worker routes `/room`, `/room/<code>`; room codes (4 letters, no I or O) |
| `viewer/src/mp/protocol.js` | wire format, codes, nicknames, RD <-> Unity/three.js |
| `viewer/src/mp/model.js` | the client's view of the room; messages -> effects (spawn, knock, toasts) |
| `viewer/src/mp/arena.js` | soft boundary, spawn spots |
| `viewer/src/mp/interp.js` | smoothing other players |
| `viewer/src/mp/net.js` | relay calls, the reconnecting socket |
| `viewer/src/mp/view.js` | figures, gems, names, brick flags, base rings (three.js) |
| `viewer/src/mp/ui.js` | Play button, lobby panel, score pill, toasts, boundary warning |
| `viewer/src/mp/index.js` | glue: `initMultiplayer(ctx)` from `main.js initHooks` |

Tests: `relay/test/ctf.test.mjs` (rules), `relay/test/room.test.mjs` (the Durable Object with a
fake runtime, the routes), `viewer/test/mp.test.mjs` (protocol, smoothing, arena, model). Locally
the whole thing runs with `cd relay && npx wrangler dev` (rooms work in Miniflare) and a site build
with `BLOX_RELAY=http://127.0.0.1:8787` served on port 8000 (an allowed origin).

## Deploy (owner)

`relay/wrangler.toml` has the binding and the one-time migration:

```toml
[[durable_objects.bindings]]
name = "ROOMS"
class_name = "BloxRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BloxRoom"]
```

Then `cd relay && npx wrangler deploy` (or `scripts/relay.ps1`). Check
`https://blox-relay.<subdomain>.workers.dev/room` -> `{"rooms":true,"version":1}` and `/health`
-> `"rooms":true`. Nothing to change on the site: it already knows the relay URL. Free plan: SQLite
Durable Objects are included; one 8-player match is ~2000 billed requests (WebSocket messages
count 20 to 1).

## Limits and next ideas

- Positions are trusted (no speed checks beyond the teleport rule): fine among friends.
- Players don't collide with each other, they pass through; a knock-down needs 1.5 m.
- Ideas: a sprint stamina bar, a minimap with the flags, chat stickers, more arenas
  (Sint Pietersberg, the Maas bridges), a public room list.

## Shooting, weapons and moving bases (2026-11-13)

Capture the flag now has weapons. The room still decides everything that matters (health,
knock-outs, flags); the client knows the walls, so it claims hits and the room checks each claim.

- **Weapons** (`viewer/src/mp/weapons.js`, pure, `test/mp.combat.test.mjs`):

  | weapon | how you get it | feel |
  |---|---|---|
  | Rifle | always | automatic, 30 rounds, 5 body hits or 3 with a head shot |
  | Scout | pickup | bolt action with a scope (wheel: second zoom), 2 body hits or 1 head shot |
  | Shotgun | pickup | 8 pellets, deadly within a few metres, 45 m at most |
  | Knife | always | one stab knocks out; 2.3 m reach, in front of you |

  Spread opens from the hip, while running, in the air and while spraying; aiming closes it. The
  crosshair shows the spread. Recoil pushes the view up; a magazine reloads itself when empty.
- **Controls:** left mouse fire, right mouse aim (hold), R reload, Q next weapon, 1/2/3 slots,
  V or F a quick stab with whatever is in the hands. Touch: FIRE, AIM (toggle), SWAP, KNIFE
  buttons. A click shorter than a frame still fires.
- **Aiming** (`combat.js`): no second camera. The follow camera moves in to the eyes (its
  `minDist`, `shoulder` and `fov` options are eased, and put back after the match), the figure
  hides as it already did for a close camera, and a brick gun is drawn in the hands (a child of
  the camera). From the hip the camera sits 3 m behind and the gun is drawn at the figure's side.
  Turning is slower while zoomed. Shots take their ray from the camera as it was drawn
  (`afterRender`), because the map controls move the camera between frames.
- **Pickups:** four spots mirrored about the middle of the line between the bases
  (`pickupSpots`: a scout and a shotgun at the middle, a shotgun near each base), snapped to the
  nearest open street spot (`player/spot.js`), back 20 s after being taken. Client side only.
- **The room** (`relay/src/ctf.js` `shoot`): message `{ t: 'shot', w, o, e, hit, head, n }`.
  Checked: the shooter is up and near `o`, the weapon's fire rate, the target is a living enemy
  seen in the last 2 s within 2.5 m of the shot's line, the weapon's range (knife: 3.5 m between
  the players), at most 8 pellets. Events: `shot` (tracers for everyone), `hit` (health), `kill`
  (knocked out 4 s, a carried flag drops, then back at the base). `kills`/`deaths` are in the
  snapshot. `arenaConfig().version` is 2.
- **Bases move:** the first round of a room is Markt against Vrijthof; every later round picks a
  random pair from `PLACES` (12 landmarks) on the same side of the Maas, 250 to 550 m apart
  (`pickBases`). The bases travel in every snapshot (`state.bases`); the client moves rings,
  flags, spawns and pickups when they change.
- **After the match:** the room panel shows a small heat map of where the knock-outs happened.
- Checked with a browser player against a scripted second player on a local relay: rifle
  knock-out in 5 hits, pickup, knife, being hurt, knocked out and back at the base.
- **Shared pickups:** walking onto a weapon sends `{ t: 'take', i }`; the room (`ctf.js` `take`)
  gives it to the first living player within 36 m of the spot and tells everyone it is gone for
  20 s (`ev` `take`). The room computes the same spots as the client (`pickupSpots`, tested equal).
- **Guns on other players:** each figure carries the weapon it last fired (rifle until then) at
  its side, in its team colour.
- **Gamepad:** RT fire, LT aim, X reload, Y next weapon, right stick click stab.
- Open: not played by two people on real devices yet (frame rate, touch layout, how the guns
  feel); other players' guns point where the figure faces, not up or down; the heat map and a
  shotgun hit have unit tests but were not seen in a browser match.

- **How to play (2026-11-14):** when a player's first match in a room starts, a line above the
  hint bar names the controls for 14 s (`combat.js` `controlsTip`: mouse and keys, or the touch
  buttons) and says that the yellow pads hold weapons.
- **Where a hit came from (2026-11-14):** being hit shows a red arc round the middle of the screen
  on the shooter's side for 1.6 s (`combat.js` `hitAngle`, from the shooter's drawn position and
  the camera's heading); it turns with the view, so turning toward it brings it to the top.
- **Haptics (2026-11-14):** `combat.js` `haptic(kind)` with the table `HAPTICS`: a tick per shot
  (heavier for the scout and the shotgun), a thump when hit, a short pattern for a knock-out, a
  long shake when knocked out, a flutter for a pickup. Phones use `navigator.vibrate` (Android
  browsers; iPhones do not give web pages vibration), gamepads their rumble motors
  (`vibrationActuator`, Chrome and Edge). Where neither exists nothing happens.
- **Where to go (2026-11-14):** a strip under the score pill carries one marker: the enemy flag
  (at home or dropped) with its distance, or "Home: <base>" in the team's colour once you carry
  it; hidden while a teammate carries it. It slides with the view and pins to an end with an
  arrow when the target is behind you (`combat.js` `stripMark`, `index.js` `objective`).
- **Ammo where the eyes are (2026-11-14):** under the crosshair, only when it matters
  (`combat.js` `ammoCue`): "LOW · 7 · R" in amber at a quarter of the magazine or less, "RELOADING"
  with a progress bar, "EMPTY" blinking in red. Nothing for a full magazine or the knife.
- **Spawn shield (2026-11-14):** for `spawnSafeS` (3 s) after a match starts and after coming back
  at the base, hits on a player do not count (`ctf.js` `shoot`: `safe`); shooting gives the shield
  up at once, so nobody fires from behind it. The health bar glows white while it lasts.
- **Holding the gun (2026-11-14):** in third person the figure holds the weapon: `rig.js`
  `holdGun` raises the right arm to the grip and the left under the barrel, following the aim's
  pitch; the figure faces the aim (`Character.aim`), while walking still moves it freely
  (strafing); the gun sits in the right hand (`Character.rightHand`). Other players hold theirs
  the same way. The hand's exact spot was tuned from screenshots only: it can sit a little low.
- **Match HUD:** in a match the brick info panel, the side buttons (Play, journal, report), the
  Transit button, the hint bar and the footer are hidden (the room panel is in the pause menu);
  on phones the ammo count sits bottom left, clear of Jump and Fire.
- **Controllers:** `rumble(pad, ...)` tries `vibrationActuator.playEffect('dual-rumble')` (Chrome,
  Edge: PlayStation and Xbox pads) and the older `hapticActuators[0].pulse` (Firefox). When a pad
  connects it buzzes once and the toast says whether this browser gives it rumble at all.


## Solo games: bots and the night raid (2026-11-15)

Owner: play alone tonight; protecting Maastricht as the game's frame; the raids test the guns.
Both run **in this browser** (no game server needed): `mp/localroom.js` `LocalRoom` runs the
relay's own rules (`relay/src/ctf.js`, imported unchanged) behind the same interface as a socket
(`send`, `live`, `stop`, `leave`; answers through `onMessage` a microtask later), so the model,
the view and combat work exactly as online. The Play panel offers both, even when the relay is
offline.
- **Capture the flag with bots** (`mode 'bots'`): you and 3 bots against 4, Markt against Vrijthof,
  starts at once. `mp/bots.js`: attackers fetch the enemy flag, defenders stand round their base and
  chase intruders, anyone runs into an enemy carrier or touches a dropped own flag, a carrier runs
  home. They shoot the nearest enemy in sight (42 m; line of sight through the city's bricks at
  chest height), not on full auto (0.32-0.6 s between shots), hitting 70 % close and 18 % at range,
  12 % of hits to the head; knocked out, they start again at their base.
- **Defend Maastricht: night raid** (`mode 'raid'`): the clock jumps to 22:30; raiders (marl-pale,
  dark rags, a head taller; `view.js` `raiderVariant`; no names over their heads unless carrying)
  come out in waves ~135 m from the Markt toward the Helpoort, go for anyone within 16 m, else for
  the city's banner (the blue flag on the Markt) and carry it toward the Helpoort. A swipe is two
  shotgun pellets of damage (30) every 0.9 s at 2.1 m, heard as a whoosh, no tracer. Knock them out
  (they crumble), or run into the carrier (the normal tag rule). Waves: 2 + 2 per wave (cap 14),
  tougher each wave (+8 % health), 8 waves to dawn; lose the banner 3 times and the city falls.
  The pill shows the wave, raiders stopped and the banners left; the objective marker points at the
  banner when it is off the Markt.
- Routes: `life/walkgraph.js` `findPath` (A*) and `nearestNode` on the whole city's walk graph;
  `mp/index.js` `makeNav` turns them into RD metres with ground height and line of sight.
- In the local room my own position never goes stale (a slow frame must not make me untouchable).
- Tests: `test/localroom.test.mjs` (bots start and act, my messages, every wave to dawn, raiders hurt
  a person by the banner), `test/life.walkers.test.mjs` (routes).
- Raiders are now cave golems (`mp/golem.js`): marl-stone blocks, glowing eye slits, long swinging arms, hunched; they keep 1.8 m apart; knocked out they sink and tip into the ground.
- Open: bots in online rooms (needs the relay), smarter bots (cover, flanking), raid variety
  (raider kinds, the cave entrances, co-op raids online).

## Arsenal, loadouts, supplies, health (2026-11-21)

Owner: one really good game mode; more guns, pickups and loadouts; think Call of Duty.
- Weapons (`mp/weapons.js`; damage in `relay/src/ctf.js` `CTF.weapons`): rifle, SMG (fast, close),
  shotgun, LMG (75 rounds, slow reload), pistol (sidearm), scout (scoped, a pickup), knife.
  Every gun has a magazine and reserve rounds; reloads draw on the reserve; dry: a click.
- Loadout (Play panel, saved `localStorage blox.loadout`): the primary (rifle, SMG, shotgun, LMG);
  the pistol and the knife always come along. Slots 1 primary, 2 pistol, 3 pickup, 4 knife (keys 1-4).
- Pickups (`pickupSpots`, the same maths in the room and the client): ten spots in mirrored pairs:
  a scout, an LMG, two shotguns, two SMGs, two ammo boxes (every reserve full) and two medkits (the
  room heals 60).
- Health comes back like Call of Duty: 25 per second after 5 s without a hit (`CTF.regen`, applied
  lazily in the room; the client shows the same).
- The online rooms need the relay redeployed for the new weapons and rules (`scripts/relay.ps1`);
  solo games use them at once.
- The shooting camera: from the hip over the right shoulder (0.85 m; the figure left of the
  crosshair), aiming at the eyes; the figure fades while the camera passes through it. The gun
  sits in the right hand with its barrel through the left (support) hand.

- (2026-11-24, owner: R2 did not fire, L2 did not aim; `navigator.getGamepads()` listed two pads.) Combat read only the
  first connected gamepad, movement any usable one; if the first was an extra or virtual device the sticks worked
  and the triggers did nothing. `input.js usablePads` (connected, standard layout or >= 4 axes) is now the one
  list; combat treats a button pressed on any of them as pressed.

### Hit weight (`mp/impact.js`, 2026-11-24)
Owner: fights should feel heavier, like the video's Unity pass (hit-stop, shake, deeper sounds). `IMPACT` is a table of
plain values per event (`hit` my shot landed, `kill`, `hurt` I was hit, `down` I went down): a camera shake (radians,
seconds; the same shake the guns use, the heavier one wins) and a few synthesised sound layers (noise bursts and falling
tones, no sample files; `ImpactSound` plays them at the player's volume and respects mute). `combat.js` only names the
event (`impact(kind)`, called from `hitmark`, `hurt` and `killed`), so the numbers can be tuned in one place and the Unity
version can read the same table. Not done: a hit-stop (a freeze of a few frames). It would have to pause the local
simulation without desynchronising the room, so it waits for a design that does not touch the network state.
