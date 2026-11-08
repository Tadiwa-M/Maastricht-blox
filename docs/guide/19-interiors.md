# 19: Interiors (walk into real places)

Folder: `viewer/src/interiors/`. Walk up to a café's door in walk mode, go in, look around a
brick-built room with people at the tables and the bar, and walk back out onto the street.
Every place is **one JSON file** in `viewer/src/interiors/data/`. Adding or changing a place
needs only the site build and publish, never a world rebuild.

> The two places that ship now, **Café De Steen** and **Lounge 22**, are **made-up examples** at
> made-up spots on the Markt (south side and west side). They are templates: replace them with
> the real places that gave permission, and delete them once the first real ones are in.

## Playing

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Go in (at a door, the "Enter <name>" hint shows) | walk into the door, or F | X | tap the hint |
| Leave (near the door inside, "Leave <name>") | walk into the doorway, or F | X | tap the hint |

A short fade to black hides the switch. Inside, the camera follows closer (small rooms) and
never zooms out to the map; M still goes to the map (you are put on the pavement first). Each
place has a blade sign with its name over the pavement next to the door so players can find it.

URL: `#mode=walk&at=718,1443.5&yaw=180&interior=cafe-de-steen` starts inside a place (handy for
screenshots and checking a new file). In the browser console, `__bloxInteriors.enter('lounge-22')`,
`__bloxInteriors.leave()` and `__bloxInteriors.here()` (see "The door" below).

## Adding a real place (owner checklist)

1. **Permission first**, in writing (an e-mail is fine): that you may photograph the inside and
   publish a brick version of it with the name. No logos or brand artwork unless they give you the
   artwork and say yes to that too; the game shows the name as plain text on a generic sign.
2. **Photos** (keep them on your own drive; never in this repo or the site):
   - from the doorway looking in, wide, at chest height; then one from each corner;
   - the bar / counter straight on; the wall behind it (shelves);
   - each kind of table, chair, stool, sofa and lamp once (colour reference);
   - floor and walls close up (colour, pattern: wood planks or tiles, beams on the ceiling?);
   - the menu board, if they want it shown (you can type a short menu instead).
3. **Measurements** (a tape or a laser measure; 10 cm accuracy is plenty):
   - room width (wall to wall along the door's wall), depth (door wall to back wall), ceiling height;
   - where the door is: metres from the left wall (standing in the doorway, looking in) to the
     door's middle;
   - the step at the door: room floor height above the pavement (e.g. +0.15 m), 0 when level;
   - for each piece: the middle of it, as metres from the left wall (x) and from the door's wall
     (z), and which way it faces; sizes for the bar, long tables and sofas (others have defaults).
     A rough sketch on squared paper, 1 square = 0.5 m, makes this quick.
4. **The door on the map**: walk to the door in the game (walk mode), stand on the pavement in
   front of it, **face the door**, open the browser console (F12) and run `__bloxInteriors.here()`.
   It prints `{ x, z, facing }`: paste that into the file's `door` (it is Unity metres, x east,
   z north; `facing` is the way the door looks out to the street).
5. **Write the file**: copy `cafe-de-steen.json` to `viewer/src/interiors/data/<id>.json`, change
   `id` (lower case and dashes, unique), `name`, `door`, `room`, `look`, `props`, `people`, `menu`;
   remove `"example": true` and the example note.
6. **Check it**: `cd viewer && npm test` (checks every file in `data/`), then
   `node build.mjs ../samples/markt_v3 --around markt` and open the walk URL with
   `&interior=<id>` (or build the site and walk in). A mistake stops the build with the file and
   the field, e.g. `interiors/x.json: props[3] (table) sticks out of the room`.
7. **Publish**: `scripts/site.ps1` (or `site.sh`) then `scripts/publish.ps1` (or `publish.sh`).
   The world is not rebuilt: the build copies `data/*.json` into the site's `interiors/` folder and
   writes `interiors/index.json`.

## The place file

```json
{
  "format": "blox-interior", "version": 1,
  "id": "cafe-de-steen", "name": "Café De Steen",
  "address": "Markt 1", "bagId": "NL.IMBAG.Pand.0935100000012345",
  "door": { "x": 718.0, "z": 1442.0, "facing": "N", "fromLeft": 3.5 },
  "room": { "width": 7.0, "depth": 9.0, "height": 3.1, "floor": 0.1 },
  "look": { "walls": "#B5653F", "floor": "#7A5236", "ceiling": "#EFE6D6", "trim": "#3B2A20",
            "windows": "#FFE9B8", "door": "#5C3A24", "pattern": "planks", "beams": true },
  "props": [
    { "kind": "bar", "x": 5.6, "z": 6.0, "facing": "W" },
    { "kind": "table", "x": 1.4, "z": 3.0 },
    { "kind": "chair", "x": 0.8, "z": 3.0, "facing": "E" },
    { "kind": "sofa", "x": 3.0, "z": 8.4, "facing": "S", "size": [2.2, 0.85, 0.85], "colour": "#7A2E3A" },
    { "kind": "menu", "x": 0.03, "z": 4.25, "facing": "E" }
  ],
  "seats": [{ "x": 6.5, "z": 1.0, "facing": "W", "height": 0.46 }],
  "people": { "share": 0.6, "staff": [{ "x": 6.3, "z": 5.6, "facing": "W" }], "standing": [] },
  "menu": ["Koffie  2.90", "Limburgse vlaai  4.20"],
  "sign": { "text": "De Steen", "colour": "#3B2A20" }
}
```

| Field | Meaning |
|---|---|
| `door.x`, `door.z` | Unity metres (x east, z north) of the pavement spot in front of the door |
| `door.facing` | N, E, S or W: the way the door looks out (a door on a street running east-west with the street to its north is N) |
| `door.fromLeft` | metres from the left wall to the door's middle (default: the middle of the wall) |
| `room.width / depth / height` | metres; width 3-30, depth 3-30, height 2.4-6 (default 3) |
| `room.floor` | room floor above the pavement, -0.4..0.4 (a step in the doorway) |
| `look.*` | colours `#rrggbb`; `pattern` `planks` or `tiles` (tiles use `floor` and `trim`); `beams` true/false |
| `props[]` | `kind` from the kit, `x`/`z` its middle in room metres, `facing` (default N), optional `size` [w, h, d], `colour`, `trim`, `y` (height above the floor) |
| `seats[]` | extra places to sit (benches, window sills); chairs, stools, sofas and armchairs are seats already |
| `people.share` | share of the seats taken, 0..1 (the same people every visit) |
| `people.staff[]`, `people.standing[]` | standing figures (behind the bar, at the counter) |
| `menu[]` | up to 14 short lines for `menu` boards |
| `sign` | the blade sign outside: `text` (default the name), `colour` |
| `address`, `bagId`, `notes` | for you and the reports; `bagId` is the BAG id from the info panel when you click the building |

**Room coordinates**: stand in the doorway looking in. `x` runs from the left wall (0) to the
right wall (`width`), `z` from the door's wall (0) to the back wall (`depth`). Facing inside the
room: **N = toward the back wall**, S = toward the door, E = right, W = left. A piece's front is
the side a sitter faces (chairs, stools, sofas), the open side (shelves), the customers' side
(the bar) or the readable side (the menu board). Turn a chair to face its table.

**The kit** (default size w x h x d in metres):

| kind | size | notes |
|---|---|---|
| `table` | 0.8 x 0.75 x 0.8 | studded top |
| `longtable` | 1.6 x 0.75 x 0.8 | |
| `lowtable` | 1.0 x 0.42 x 0.6 | coffee table |
| `chair` | 0.45 x 0.9 x 0.45 | 1 seat |
| `stool` | 0.38 x 0.72 x 0.38 | 1 seat (bar height) |
| `bar` | 3.0 x 1.08 x 0.65 | counter with a foot rail; set `size` for its length |
| `shelf` | 1.4 x 2.0 x 0.35 | with bottles and jars |
| `plant` | 0.5 x 1.2 x 0.5 | potted shrub |
| `lamp` | 0.4 x 1.6 x 0.4 | floor lamp, lit shade |
| `pendant` | 0.4 x 0.7 x 0.4 | hangs from the ceiling, walk-through |
| `sofa` | 1.8 x 0.85 x 0.85 | one seat per ~0.6 m |
| `armchair` | 0.85 x 0.85 x 0.8 | 1 seat |
| `menu` | 1.0 x 0.8 x 0.06 | wall board at 1.3 m with the `menu` lines |
| `rug` | 2.0 x 0.02 x 1.4 | walk-through |
| `machine` | 0.6 x 0.45 x 0.45 | espresso machine, sits on the bar (y 1.08) |

The build refuses a file whose pieces stick out of the room, are taller than it, block the way in
at the door (1.1 m wide, 1.5 m deep) or use an unknown kind; overlapping pieces only warn.

## How it works

- **Where the room is**: built as its own small region 40 m straight below its door
  (`layout.js` DEPTH), at the building's x/z. Chosen over building it inside the real building
  because the city's buildings are hollow shells whose size and windows seldom match the room,
  and over a hidden room far away because the streamer, far levels and life all stay loaded
  around the door, so leaving is instant. The room's walls, floor and ceiling enclose the camera,
  so nothing of the city shows; the sun's shadows are switched off while inside (the city above
  would shade the room) and the room has its own light (an emissive share in its material).
- **Collision** (`volume.js`): `installVolumes(city)` wraps the city query API's `isSolid`,
  `isWater` and `groundHeight` once (no change to `player/`). While the player is inside, points
  in the room's region are answered by the room: walls, floor, ceiling and furniture solid, the
  room and the doorway niche free. The shared character controller and follow camera therefore
  collide with walls and furniture exactly as outside.
- **Going in and out** (`door.js`, `index.js`): the player's public API (`window.__bloxPlayer`:
  `enterAtUnity`, `ctrl`, `follow`, `city`, `mode`). Entering puts the player 1 m inside the door
  facing in; leaving puts them 0.6 m out on the pavement facing the street. Inside, the follow
  camera's options are changed through `follow.o` (closer, smaller shoulder offset, wider lens;
  restored on leaving) and its distance is capped at 3.4 m.
- **People** (`people.js`): a stable share of the seats taken, plus staff and standing guests,
  drawn with the figure crowd (`figure/crowd.js`, `figure/variants.js`) in the rig's sitting and
  idle poses; stools lift the sitter to their height.
- **Look** (`kit.js`, `layout.js`, `mesh.js`): everything is boxes in room metres (walls in
  running-bond brick courses, plank or tile floors, studs on table tops, counters and shelves at
  half the city's stud size), merged into one mesh per room (one draw call), plus a text plane for
  the menu board. Pieces are turned by their facing through `src/rotation.js`.
- **Data in the site** (`copy-data.mjs`): `build.mjs` validates `data/*.json`, copies them to
  `<site>/interiors/` and writes `interiors/index.json`; the game fetches them at start.

Tests: `viewer/test/interiors.test.mjs` (format, room frame for every facing, collision volume,
the controller walking into walls and furniture, doors, fade, people, the build copy).

## Open ends

- Real places: replace the two examples (owner: permission + photos + measurements).
- One room per place, ground floor only; upstairs rooms or a terrace inside would need a second room.
- Photos are references for building the file; nothing reads them. A later step could take wall
  colours straight from a photo.
- Works over HTTP (site build and the screenshot server); a page opened from `file://` cannot fetch
  the place files and simply has no interiors.
