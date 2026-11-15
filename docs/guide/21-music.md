# 21. Your music (Spotify)

Owner, 2026-11-15: let players connect their Spotify while they play.

- `viewer/src/music/spotify.js`: a dock at the bottom left ("♫ Music", also pause menu > Music).
  Paste any Spotify link (playlist, album, track, artist, show, episode; `open.spotify.com/...` or
  `spotify:type:id`; `parseSpotify`, tested in `test/spotify.test.mjs`) and Spotify's own player
  appears in the dock, 80 px tall, and keeps playing while you play; ▾ tucks it away (still playing).
- Signed in to Spotify in the same browser, it plays whole songs; otherwise Spotify plays previews.
- Spotify's iFrame API (`open.spotify.com/embed/iframe-api/v1`) reports play and pause; while music
  plays the city's sounds go down to a third (`window.__bloxAudio.duck`). If the API can't load,
  a plain embed is used (no ducking).
- No account data touches the game: the player lives in Spotify's own frame. The last link is kept
  on this device (`localStorage blox.music`).
- Not done on purpose: a full "log in with Spotify" (Web Playback SDK) needs a Spotify Developer
  app, Premium for every listener, and Spotify's quota approval past 25 users.
- Not possible: visuals reacting to the beat of Spotify music (its audio is protected and its
  track-analysis data is closed to new apps). The comic look reacts to game events instead
  (guide 06, `render/comicfx.js`).
