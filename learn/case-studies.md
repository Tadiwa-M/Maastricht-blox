# Case studies: real bugs from this project

Each one: the symptom, the wrong guesses, the real cause, the fix, and the general lesson. Read the symptom first and try
to guess the cause before reading on.

## The white flash (frame loop ordering)

- **Symptom:** every few seconds the screen flashed white (owner, playing on the laptop). Not a storm effect.
- **Cause:** dynamic resolution and the quality governor resized the render targets *after* a frame had been drawn, so
  the next composite read freshly cleared (white) buffers for one frame.
- **Fix:** store the change in `pendingChange` and apply it at the start of the next frame, before drawing
  ([`viewer/src/citymode.js`](../viewer/src/citymode.js)).
- **Lesson:** in a frame loop, *when* something happens matters as much as *what*. Changes to render state go at a
  frame boundary.

## The city drawn as sky (depth assumptions)

- **Symptom:** zoomed out on the map in the painted looks, the city vanished into flat sky.
- **Cause:** the shader decided "sky" by depth: anything farther than 2.4 km. At street level that is only the sky dome;
  zoomed out, the whole city is farther than that.
- **First fix (partial):** raise the limit with camera height. Still failed at low, horizon-facing angles.
- **Real fix:** sky only past the fog's far end (`skyZ` in [`viewer/src/render/verse.js`](../viewer/src/render/verse.js), fed from [`post.js`](../viewer/src/post.js)).
- **Lesson:** a hard-coded threshold encodes an assumption about the camera. When the camera changes, the assumption
  breaks. Tie thresholds to the thing they actually depend on.

## Too yellow (colour grading)

- **Symptom:** "too much yellow or whatever colour that is": a cream and peach cast over the whole Manga look.
- **Cause:** several small warm pushes stacking: a warm tint on sunlit surfaces, cream on grey stone, a warm split
  tone, a peach sky horizon mixed into the haze.
- **Fix:** each made near neutral; warm sky palettes replaced ([`verse.js`](../viewer/src/render/verse.js) [`manga()`](../viewer/src/render/verse.js#L156), [`mangafx.js`](../viewer/src/render/mangafx.js) [`PALETTES`](../viewer/src/render/mangafx.js#L12)).
- **Lesson:** colour problems are often many small effects adding up. Find every place a colour is pushed, not just one.

## The triggers that didn't fire (input assumptions)

- **Symptom:** on a DualSense, R2 didn't fire and L2 didn't aim.
- **Cause:** the browser's gamepad list had stale entries from an earlier controller; the code only read the first pad.
- **Fix:** [`usablePads()`](../viewer/src/player/input.js#L23) in [`viewer/src/player/input.js`](../viewer/src/player/input.js): read every connected, standard pad; a button counts if
  pressed on any.
- **Lesson:** never assume a list holds what you expect in the first slot. Check what the browser actually reports
  (`navigator.getGamepads()` in the console).

## The black frame (verifying results)

- **Symptom:** an agent reported Unity running the full 65k-chunk city because the log said the world opened. The
  screenshot was black, and Unity logged repeated `NativeArray` out-of-range errors.
- **Cause of the mistake:** a log line proves data was *read*, not that anything was *drawn*.
- **Lesson:** judge by the output: the picture, the game, the tests. This applies to your own work as much as an agent's.

## The fix that wasn't live (deployment)

- **Symptom:** "none of those changes worked."
- **Cause:** the fixes were committed but the live site was built from an older version.
- **Lesson:** "fixed in code", "deployed" and "verified live" are three different states. Know which one you're in
  (the site's `world.js`<!--nolink--> shows its `build`).

## The fixture that changed with the computer (determinism)

- **Symptom:** after the workstation's Unity commits merged, one pipeline test failed: `stale fixture files ['features.json']`.
- **Cause:** the workstation (Windows) regenerated a test fixture, and its pipeline puts one street's centre point in a
  different place than Linux does (CI runs on Linux). Same code, same data, different answer per platform.
- **Fix so far:** restore the Linux version (what CI checks); regenerate fixtures only on Linux. The root cause is open.
- **Lesson:** "it passes on my machine" isn't "it passes". A generated file committed as a test fixture must be produced
  where CI runs, and a pipeline that gives different answers on different computers has a hidden dependency to find.
