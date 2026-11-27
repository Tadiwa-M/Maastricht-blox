# 15: Exploration (plaques, golden studs, journal, photo mode)

Folder: `viewer/src/explore/`. Rewards curiosity in the real city without filling it with
markers: walk up to a landmark and a plaque tells you a line of its history; golden studs hide in
squares, courtyards, parks, on bridges and up the Sint-Pietersberg; a journal keeps what you found
and a map that lights up where you have walked; photo mode turns the view into a postcard.

## How to use

| Action | Keyboard | Touch / mouse |
|---|---|---|
| Read a plaque | walk within ~8 m of one (the card hides again beyond 11 m) | same |
| Collect a golden stud | walk into it | same |
| Journal (map, places, studs, rewards) | J | the round book button, right edge above the report flag |
| Photo mode | P (again or "Done" to leave; Esc with a free mouse leaves too) | "Photo mode" in the journal |
| Take a postcard | Space in photo mode | "Take postcard" |

Photo mode hides every other element on the page. In walk mode the camera orbits the figure the
usual way (move the mouse with it captured, or drag; scroll / + - to zoom; Q E turn) while walking,
jumping and the other panels' keys are switched off; in map mode the map controls orbit. The
postcard is the view in a paper frame with the place (a landmark within 120 m, else the street)
and the date. Browsers that can share files open the share sheet (phones); others download the PNG.

The journal button, journal, plaque card and toasts are hidden on the title screen, while riding
(`body.riding`) and in screenshot mode (`body.shot`).

## Files

| File | What |
|---|---|
| `data.js` | 24 landmarks (name, 1-2 conservative history lines, plaque spot, anchor building) and 42 golden studs, Unity metres for the city world (originRD 174700, 314000), plus the stud rewards |
| `logic.js` | pure rules: origin shift, plaque hysteresis, stud touch test, walked-cell grid and its compact storage, unlock thresholds, date and place names, postcard and map layout |
| `props.js` | three.js: spinning golden studs, plaque posts (a stone post with a tilted bronze plate facing away from the building), the burst of little gold bricks on collect |
| `ui.js` | DOM: journal button and panel, plaque card, toast, photo bar, flash |
| `minimap.js` | the journal map: dark, walked cells glow, found places as gold dots, you as an arrow |
| `photo.js` | capture (`window.__bloxCapture`, else the canvas), postcard composition, Web Share or download |
| `index.js` | `initExplore(ctx)`: wires it all, per-frame update, keys, saving |

Tests: `viewer/test/explore.test.mjs` (content checks, every rule in `logic.js`).

## Where things are

Positions were picked from the built city, not guessed: the anchor of each landmark is the
OSM/BAG feature centroid in the world's `features.json` (Stadhuis Maastricht, Sint-Servaasbasiliek,
Helpoort, ... with their Wikidata ids); the plaque stands on the nearest open street cell in front
of it (walkable low ground with 1.5 m clear around it, searched in the chunks and islands). Studs
went through the same search around hand-picked spots. Each item keeps the ground height found
then (`y`); at runtime it is replaced by `city.groundHeight(x, -z, y + 2.5)` once the streamed
chunks around it are loaded (bridges keep their deck: the search starts just above the picked
height). Other worlds (the 2 x 2 km slice, the diorama) shift everything by their own originRD and
drop what lies outside `city.box`.

To add a landmark: add an entry to `LANDMARKS` with a spot on the street in front of it (Unity
metres; `x = RD_x - 174700`, `z = RD_y - 314000`; `viewer/src/plan/geo.js gpsToUnity` from lat/lon)
and keep it more than ~17 m from the others (one card at a time; the test checks it). Keep the
text short (at most 220 characters), factual and conservative.

## Saving

`localStorage['blox.explore.v1']` = `{ v: 1, places: { id: time }, studs: { id: time }, cells }`.
`cells` is the set of lit 16 m cells (everything within 22 m of where you walked), sorted,
delta-coded in base 36: a long walk is a few KB. Saved every few seconds while something changed,
and when the page is hidden; storage errors (private windows) only mean nothing is kept.
Unknown ids are dropped on load, so renaming an item forgets it.

## Unlocks

10 studs: golden cap colour, 25: golden jacket colour, all of them: golden shoes and bag. The
character creator (`viewer/src/player/creator.js`, `figure/custom.js`) does not offer these yet.
The explore module announces them:

- `window.__bloxExplore.unlocked()` → ids reached so far (`gold-hat`, `gold-top`, `gold-all`);
- a `blox:unlock` event on `window` (`detail: { id, name }`) when one is reached.

To wire it, the creator would add a gold colour (e.g. `#D4A017`) to the hat / top / shoes / bag
colour lists only when the matching id is unlocked (append it at the end so existing look codes keep
their indexes, and fall back to the first colour if a saved look uses gold that is not unlocked).

## API

`window.__bloxExplore`: `state()` (counts, photo on/off), `unlocked()`, `journal(on)`, `photo(on)`.
