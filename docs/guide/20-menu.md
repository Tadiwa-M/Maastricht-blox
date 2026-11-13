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

Resume · Map & fast travel · Character (C) · Journal (J) · Photo mode (P) · Plan a trip ·
Goals on/off (O) · Settings · Controls & help (H) · Multiplayer. An entry shows only when its
module is there. Character and photo mode walk in at the map's centre first when you are on the
map. Settings moves the `#hud` panel (sun, tilt-shift, AO, animation, quality, clock speed,
sound volume and mute) into the menu while the page is up and puts it back after. **On phones
`#hud` is hidden outside the menu** (`body.bx-has-menu`, `pointer: coarse`).

APIs used: `__bloxPlayer.openCreator / closeCreator / creatorOpen / toggleHelp / busy`,
`__bloxExplore.journal / photo / landmarks() / journalOpen`, `__bloxTrip.open`,
`__bloxGoals.setOff / flow.off`, the multiplayer button `#mp-open`. The menu itself is
`window.__bloxMenu { isOpen, page, open(page), close(), toggle(), travel(x, z, name), travelling }`.

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
