# Maastricht Blox: Plan

Living plan. Update it when scope, tools or phase status change; log the change in
`docs/DEVLOG.md`.

## 1. What we're building (outline)

A brick-built, game-quality miniature of Maastricht, playable in the browser.
- **World:** real terrain, buildings and roads from open data (AHN, 3D BAG, OSM), turned
  into brick chunks by a Python pipeline. Detailed townhouses come from a facade grammar
  with custom pieces.
- **Look:** a premium brick diorama, with bevelled bricks, studs, plastic materials, ambient
  occlusion, soft shadows and tilt-shift.
- **Explore:** a Google Maps-style camera, click a building for info, and search.
- **Alive:** live buses on real routes, real weather, time of day and the Maas water level.
- **Play:** a third-person walk mode with an original blocky character, a photo mode, and
  collectibles.
- **Launch:** a public web link, a demo video and a LinkedIn post.

## 2. Tools

| Need | Tool | Status |
|---|---|---|
| Data pipeline | Python 3.11+, uv, numpy/numba, shapely, rasterio, laspy, pyosmium, pyproj | in use |
| Live data | FastAPI proxy, httpx, gtfs-realtime-bindings | in use (fixtures only) |
| Game (launch) | three.js web engine (`viewer/`), Gamepad API, GitHub Pages (`scripts/publish.*`) | in use |
| Game (later) | Unity 6 LTS, URP 17, Burst/Collections/Mathematics, Input System | parked after launch; code in repo |
| Fast preview | three.js viewer, esbuild, Playwright + headless Chromium | in use |
| Engine-free C# tests | .NET 8 SDK, xUnit | in use |
| Hero assets (later) | Blender, MagicaVoxel → pipeline importer | phase 3 |
| Quality gate | `scripts/check.sh`, GitHub Actions CI | in use |
| Unity automation | `scripts/unity.ps1` / `unity.sh` (headless compile, EditMode tests, player build, screenshot) | ready, first run on workstation |
| GPU workstation | Unity 6 LTS + GPU; setup via `scripts/setup-workstation.ps1` | being set up (laptop already verified) |
| Capture | `scripts/shots.sh` (viewer screenshots), OBS for the demo video | shots in use |
| Keys/accounts | NS API key (trains), PDOK/3D BAG/OVapi need none | NS key pending |
| Ground truth | BGT via PDOK OGC API Features (`sources/bgt.py`) | in use (A1) |

## 3. Phases

Each phase ends with a **quality gate**: `scripts/check.sh` green, screenshots reviewed, docs
and DEVLOG updated, and everything pushed.

### Phase 1: Foundation & look: done
Contract-first data formats, pipeline, facade grammar with detail pieces, rotated building
islands, movers, viewer with LOD, real 2×2 km Maastricht built (4096 chunks, 2448 islands),
docs. Unity code is written but parked (see the decision below).

**Decision (2026-10-23): launch in the browser, not as a Unity download.** A LinkedIn audience
clicks a link; it doesn't install an .exe. The three.js engine already renders real Maastricht
with islands, LOD and movers, and it runs on phones too. Unity is parked until after launch (a
later high-end desktop/AR version), and its code stays in the repo and in CI.

### Phase 2: Playable web city: done (2026-10-26)
Three parallel tracks plus hosting:
1. **Whole-city streaming:** the world is served as files and loaded around the camera.
   Pre-baked far meshes keep the whole 2×2 km visible.
2. **Life:** buses on real routes driven by the published GTFS timetable (no server needed),
   pedestrians walking OSM footways and squares, boats on the Maas.
3. **Player:** drop into third-person walk mode anywhere; keyboard, gamepad (Gamepad API)
   and touch; collision with bricks and islands.
4. **Hosting:** a static site (GitHub Pages or similar) built by one script.
**Exit:** a link opens Maastricht in the browser at 30+ fps on a laptop, with buses and people
moving, and you can walk the Markt with a controller.

### Phase 3: Launch & after (current)
Status 2026-10-26: the whole `city` slice is built (22,355 chunks, 8,050 islands, 265 MB site)
and published with `scripts/publish.ps1` to https://tadiwa-m.github.io/Maastricht_larper/.
Live and verified by the owner on a laptop and a phone (smooth after a stutter on first load). Next: the demo video and the LinkedIn post. After that:
real 3D BAG roofs for the outskirts (refetch when the API is reachable), shopfronts from OSM,
fake interiors, cross-border transit.

**Feature: Ride (owner, 2026-10-30).** "Instead of Google Maps, open the app: see the live
bus and train routes on the city map, tap one, and ride along in first person as a passenger,
looking around the bus and out of the windows. Make it really easy."
- Tools: GTFS (OVapi gtfs-nl, already in the pipeline; `blox life --modes bus,rail` adds trains),
  GTFS-Realtime (OVapi `vehiclePositions.pb` + `tripUpdates.pb` for buses, `trainUpdates.pb` for
  train delays: trains have no GPS in the feed, so they are placed from the timetable plus the live
  delay), a small relay (Cloudflare Worker, free) because a browser can't read the protobuf feeds
  cross-origin, and the viewer's existing PathMover / brick models / look controls.
- Phase R1 (no backend, works today): a Transit panel (lines, "next departures", vehicles now),
  routes drawn on the map, tap a bus -> **Ride**: a seat camera inside the bus at passenger eye
  height, free look out of the windows, a next-stop strip, "Get off" (walk from that stop) and
  "Back to map". Trains (Maastricht <-> Randwyck) get a train model and the same ride.
- Phase R2 (live, code done 2026-10-31; relay deploy + verify pending): the relay plus the viewer merge. Vehicles use the live position or delay when
  the feed has one, else the timetable, with a LIVE / SCHEDULED badge per vehicle.
- R1 polish (2026-10-30, uncommitted until approved): passenger cabin with big windows in the
  seat view (`ride/cabin.js`); bus shapes snapped to the OSM roads in `blox life` (needs a
  `blox life` re-run); tree trunks moved off carriageways (with the accuracy rebuild).
- Phase R3 (future, owner 2026-11-02): **Plan a trip, like a maps app.** In the Transit panel:
  pick a start and a destination (address, postcode, stop or a tap on the map), get bus options
  (leave/arrive times, walk legs, transfers) like a maps app, and the chosen route drawn on the
  city. Choosing **walk** shows the best path on the ground as a green arrow line, like the
  racing line in an F1 game; "Ride" boards the first bus of the chosen option.
  Model: the owner's earlier routing app (`Tadiwa-M/Maastricht-and-Heerlan-Routing-Applications`,
  Java: postcodes -> time-aware A* over a GTFS bus graph with a 5-minute transfer penalty,
  GraphHopper for walking, route drawn on a map). Here it runs in the browser on data we already
  export: `transit.json` v2 (stops, patterns, trips) for a connection-scan search over today's
  connections, the walk graph (`walkways.json`) for walk legs and the walking route, addresses
  from the BAG/OSM features (the old app's `maastricht_postal_codes.csv`, MIT, for postcodes).
  Pieces: an address/stop search box, the trip search (pure, tested), a results list, route
  drawing (bus legs in route colours via `ride/routes.js`, walk legs as the green chevron line
  on the ground), then follow-me while walking. Also: stop search and follow a vehicle on the map.
  **Plan (owner 2026-11-05: phone first, Maastricht only):**
  - R3a (current) engine + phone page: RAPTOR trip search over today's timetable with live delays
    (`viewer/src/plan/`), walk access/egress, origin from GPS (browser location API, WGS84 -> RD
    in the browser; the location never leaves the phone), a stop, a street or a tap; results
    (leave/arrive, duration, walking, lines, transfers, "leave in"). A light `plan.html` in the
    site that loads only the timetable and walk graph (no 3D city), installable on the home screen.
  - R3b the chosen route on a simple 2D map on the phone page and on the 3D city (bus legs in line
    colours, walk legs as the green chevron line), "Ride" boards, GPS dot follows you.
  - R3c addresses and postcodes (BAG addresses from features.json, the old app's postcode CSV),
    saved places (home, university), departure-board alerts.
- Traffic rules (owner 2026-11-02, after the accuracy rebuild): buses, cars and bikes see each
  other (queue behind, give way at junctions, stop for people on crossings); today buses only
  push walkers aside and drive through cars and bikes.

**Accuracy (owner, 2026-10-31):** BGT (the municipality's large-scale map, via PDOK) for the
ground: roads, pavements, water, bridges. Proper bridges (deck at road height, railings, piers),
ramps instead of plate steps on sloping roads, canopies (the station's bus platforms), the 3D BAG
retry, and hand-built landmarks (station, both bridges, ...). One full rebuild for all of it.
Phases (goal: the version sent to the gemeente):
- A1 Ground from BGT (code done 2026-11-02, awaiting the owner's review): `blox fetch --only bgt`
  caches ten BGT collections (PDOK OGC API, 512 m blocks, current objects only, ~14 MB/km²);
  inside the cached area BGT polygons paint the ground and water, OSM only names streets and
  keeps rails and bridge decks; OSM stays the fallback outside it. Checked on a 1.3 x 0.6 km
  container build (station Wyck side, Markt, Servaasbrug), guide 02 "Ground from the BGT".
- A2 Bridges and water (code done 2026-11-02, awaiting the owner's review): decks from BGT bridge
  outlines at road height with the BGT road parts on top, piers, `railing_1x2` railings; walkways
  over water dropped in `blox life`; the player can no longer walk onto water.
- A3 Ramps (done 2026-11-02: `wedge_1x2`, `voxelise/ramps.py`), station canopies
  (code done 2026-11-03: the train platform roofs from BGT `overkapping`, `voxelise/canopies.py`;
  bus shelters at every OSM `shelter=yes` stop, `voxelise/shelters.py`), the "building in the road" spot
  (location needed from the owner); then the full rebuild (3D BAG cached on the workstation,
  2026-11-02) and the gemeente email.
Reports: done (button, relay, corrections file).

**Post-launch backlog (owner, 2026-10-26)**, in rough priority order:
1. Bugs: NPC behaviour (walkers go in random directions and vanish), cars vanish mid-street,
   water is walkable. (Startup stutter: done 2026-10-26, a loading
   screen.)
2. Real-time buses: positions from OVapi GTFS-RT through a small hosted relay (e.g. a Cloudflare
   Worker), because the browser can't call the feed directly; falls back to the timetable.
   Today the buses follow the published GTFS timetable.
3. Ride a bus: board at a stop, follow the bus's route path with the camera, show the next
   stop; leave at any stop.
4. Real 3D BAG roofs for the outskirts, OSM shopfronts (Peter's Irish Pub, Mosae Forum),
   fake interiors, cross-border transit (De Lijn, TEC, DB).
Polish, the demo video (captured from the web build), the LinkedIn post. Then: live GPS buses
through a hosted proxy, weather, controller polish, the Unity desktop/AR version.
**Exit:** a public link, a video and a post. (Done 2026-11-05: accuracy rebuild live, video and
LinkedIn post out.)

### Phase 4: The game (current, owner 2026-11-05)

**Outline.** The world is good; now it must feel like a game. Three tracks, in order:
**G1 movement and traffic** (this phase), **G2 multiplayer capture the flag** (Cloudflare Durable
Objects rooms through the relay; flags at landmarks), **G3 smarter NPCs** (later; NPCs stay
**scripted**, owner 2026-11-05). We copy proven patterns from open-world games instead of
inventing our own, and keep everything procedural (no motion-capture assets: the figure is our
own brick-style design, posed by `figure/rig.js`).

**Tools.** three.js viewer (`viewer/src/player/`, `figure/`, `life/`), node tests for every rule
(pure logic, no GPU), the pipeline only where data is missing (traffic lights, crossings and
priority roads from OSM into `streets.json`), owner play-tests on the GPU PC
(`scripts/site.ps1 samples\markt_v3 build\site_markt -Serve` for a quick local check).

**G1a Player feel and character creator** (first)
- Locomotion like Assassin's Creed and God of War: the body moves along its heading and turns in
  arcs (turn rate drops with speed) instead of sliding; a hard reversal at speed plants and
  pivots; walk / jog / sprint with eased speed changes; the body leans into acceleration and
  banks into turns.
- Animation: walk and idle blend by speed (no snapping between modes), stride length matched to
  speed (feet don't skate), start/stop settle, head turns toward where you're steering, airborne
  and landing poses for jumps and drops.
- Camera like God of War: over the shoulder, slight follow lag, eases in on sprint, still pulls
  in at walls.
- Character creator: body (build, height), skin, hair style and colour, top, bottoms, shoes,
  accessory, from the figure's parts; preview turntable; saved in the browser and in the link
  (`#figure=`), ready to send to other players in G2.

**G1b Traffic rules** (GTA V / Cities: Skylines style lane traffic; code done 2026-11-05)
- Right of way at junctions: priority roads by class, give way to the right where equal
  (Dutch rule), roundabouts give way to traffic on them.
- Traffic lights from OSM `highway=traffic_signals` (timed cycles per junction), zebra and signal
  crossings from OSM `crossing=*`: cars stop for people on them.
- Buses on the same rules; vehicles brake for the player; the player collides with vehicles.

**G1c Scripted NPC behaviour** (Assassin's Creed crowds, Watch Dogs routines)
- Walkers with destinations by time of day (home, work, university, shops, cafés, the Friday
  market) and A* routes over the walk graph instead of wandering; they cross at crossings, avoid
  each other smoothly, step aside for the player and vehicles, and never pop away in view.
- Movers on bridges stay on the deck (today they drop to the water under the Servaasbrug).
- Same animation upgrades as the player (blend, lean, stride matching).

**Exit G1:** a play-test on the owner's PC where walking feels fluid, a custom character, cars
that stop at lights and junctions, and people who visibly go somewhere.

## 4. Process (how we work)

1. **Outline → tools → plan → phases**: this file.
2. **Contract first**: shared formats live in `CONTRACT.md`; change it only with a version
   bump and update every component.
3. **Parallel tracks** with disjoint file ownership, then an integration and review pass.
4. **Quality**: tests for every reader and writer; `scripts/check.sh` before each push; CI
   on every push; visual review of screenshots for anything that affects the look.
5. **Docs as we build**: update the matching guide in `docs/guide/`, append a dated entry to
   `docs/DEVLOG.md`, and refresh `README.md` and this plan whenever a decision,
   command or status changes.
