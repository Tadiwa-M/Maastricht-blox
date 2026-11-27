# 20. Pause menu, map and fast travel

One game menu for phones and PC, a full-screen 2D map, and fast travel from it. Code:
`viewer/src/menu/` (hooked in by one line in `main.js` `initHooks`, last: it drives the other
modules). Tests: `viewer/test/menu.test.mjs`.

## Opening it

- **Button:** a small pause button in the top-right corner (40 px, safe-area aware) on every
  screen. The walk mode's *Map* button and the info panel sit to its left (`index.html`); the
  goals card starts below it (60 px). On short landscape phones the goals card moves left of the
  right-hand button column (compass 40 px, report 92, journal 144, multiplayer 196).
- **Esc** (keyboard) and **Start** (gamepad, through the player's input) toggle it. Esc first
  closes what has no Esc of its own: the help panel, the character creator, the journal. The Esc
  that ends photo mode does not also open the menu.
- **PC walk mode:** losing the pointer lock without the game asking for it (the browser's own Esc,
  switching windows) opens the menu. The player's `input.releaseLock` is wrapped so the game's own
  releases (help, journal, map flight, report, multiplayer) are told apart. *Resume* (a click)
  catches the mouse again.

## While it is open

- Dimmed, blurred backdrop over the running city; the menu takes every key (a window capture
  listener, trusted events only) and every pointer event; the player's tick returns early (no
  movement, no camera), Start still closes it.
- The life clock runs at `PAUSED_SPEED` (0.001; 0 would read as 1x in the transit hold). Resume
  restores the old speed unless something changed it meanwhile. Not during a multiplayer match.
- Keyboard and gamepad navigation: arrows / d-pad move between entries (two columns on short
  screens), Enter / A picks, Esc / B goes back.

## Entries

Resume · Map & fast travel · Character (C) · Look · Plan a trip · Music · Play · Photo mode (P) ·
Journal (J) · Goals on/off (O) · Settings · Controls & help (H) · Tour. What makes it yours and what
there is to do come first, each with a line saying what it is (2026-11-23, owner: people could not
find the character creator, the music or the trip planner). An entry shows only when its
module is there. Character and photo mode walk in at the map's centre first when you are on the
map. Settings moves the `#hud` panel (sun, tilt-shift, AO, animation, quality, clock speed,
sound volume and mute) into the menu while the page is up and puts it back after. **On phones
`#hud` is hidden outside the menu** (`body.bx-has-menu`, `pointer: coarse`).

APIs used: `__bloxPlayer.openCreator / closeCreator / creatorOpen / toggleHelp / busy`,
`__bloxExplore.journal / photo / landmarks() / journalOpen`, `__bloxTrip.open`,
`__bloxGoals.setOff / flow.off`, the multiplayer button `#mp-open`. The menu itself is
`window.__bloxMenu { isOpen, page, open(page), close(), toggle(), choose(id), travel(x, z, name), travelling }`;
`choose(id)` runs an entry as if picked (the tour uses it, so there is one way to open each thing).

## The map (`map.js`, `view.js`, `mapdata.js`)

- Canvas, north up, Unity metres. Drawn only when something changed.
- Built city: one pixel per chunk from `city.hasChunk`, scaled up. River: `life/river.json`
  (path + width). Streets and walkways: `__bloxLife.walkDoc` segments bucketed into 256 m tiles;
  only tiles in view are drawn. Bus stops: timetable stops inside the built city, platforms of one
  stop (same name within 80 m) merged. Landmarks: the exploration plaques (found ones gold).
  You: an arrow with your heading (walk: camera yaw; map: the view direction). Labels appear as
  you zoom in. Scale bar.
- Mouse: drag, wheel (about the cursor), double-click zooms in. Touch: drag, pinch. Buttons:
  +, −, *You*.
- A tap (moved < 10 px, < 0.6 s) picks the nearest marker within 22 px, else the nearest walkway
  node inside the built city (`PointGrid`). A sheet asks *Go* / *Cancel*.

## Fast travel (`travel.js`)

Fade to black (0.25 s) → stand there with `enterNearUnity` (on the pavement, not a roof; landmarks
face their building) → fade out (0.4 s). When the ground is not loaded yet: leave walk mode, point
the map camera and `city.focus` at it, retry every 0.4 s ("Travelling to …" on the black), give up
after 45 s and stay on the map there with a note. Riding a bus: you get off first. Not during a
multiplayer match.

## The look of the main page (2026-11-13)

The pause page reads like the title screen: a column down the left (the wordmark with the yellow
brick badge, the Limburg stripe, the street or time, entries in big Anton capitals with a yellow
bar on hover or focus, Resume as a yellow brick), fading out to the right so the paused city
stays in view. Settings and the map keep their own layouts. On short landscape phones the
entries sit in two columns. All in `menu/style.js` (`.bx-main` rules); the markup added is the
brand and stripe in `menu/index.js`. Checked at 1280x720, 915x412 and 412x915: every entry on
screen, none under 40 px high.


## The look picker (2026-11-15)

Owner: the Look option should explain itself. Pause menu > Look opens `menu/looks.js`: a card per
look with a short description (Classic; "Jump into the Spider-Verse", the comic-book film style;
Manga, coming soon), the look in use marked, and Switch (the page reloads with `#look=...`; the
choice is saved, `render/verse.js` `switchLook`). The menu line reads "Look: Classic" or
"Look: Spider-Verse".

## First-time walkthrough (2026-11-21)

Owner: new players don't know to zoom in and double-tap, nor what to do, nor about the looks.
`menu/tour.js`: on the first visit (localStorage `blox.tour`), once the title screen is gone, a card
at the top in four steps: (1) how to get into the street, or "Drop me on the Markt" (flies the map
there if it isn't loaded, then enters walk mode); (2) moving, and what to do (tourists with a !,
bikes, ducks); (3) "Jump into the Spider-Verse" (opens the look picker); (4) Defend Maastricht and
capture the flag (opens Play). Steps move on by themselves when the player does the thing; Skip
ends it; pause menu > Tour plays it again. The goals card's own welcome waits while the tour runs.

- (2026-11-23) Six steps: (1) into the street (mentions the Walk here button), (2) moving and what to
  do, (3) **Make it yours** (opens the character creator), (4) the looks: three worlds, three casts,
  (5) **More in the menu**: trips on the real buses and trains, your Spotify, photo mode, fast
  travel, (6) Play. Buttons run the menu's own entries (`__bloxMenu.choose`). Found by playing the
  tour: in the street the mouse was held for looking around, so the card's buttons could not be
  clicked; the card now frees the mouse when it shows, and **Enter** presses its button. (Since then
  the mouse is free while exploring anyway: guide 09.)
