# 21. Your music (Spotify)

Owner, 2026-11-15: connect Spotify while playing; then "a proper button, log in, change it from the
pause menu", using the Spotify Developer app the owner already has for Melody Search.

**Where:** pause menu > Music opens the music panel. While something plays, a small now-playing chip
(cover, song, play/pause) sits at the bottom left; tapping it opens the panel. No link box on screen.

**Connected (Spotify login, `viewer/src/music/auth.js`):** Authorization Code with PKCE: no client
secret and no server, so the game can share Melody Search's Spotify app (Melody Search's Flask
server uses the secret; this site only needs the public Client ID). Tokens stay on this device
(localStorage `blox.spotify`) and refresh themselves. With Premium the Web Playback SDK makes the
game a Spotify device ("Maastricht Blox"): your playlists, play/pause, skip, volume in the panel.
Without Premium (the SDK's account error) your playlists play in Spotify's embedded player instead.

**Not connected, or no app configured:** "Play a Spotify link instead" (a small link in the panel)
takes any Spotify link (`parseSpotify`); Spotify's embedded player plays it (whole songs when signed
in to Spotify in this browser, else previews). The embedded player shows in the panel and keeps
playing, out of sight, when the panel is closed.

The city's own sounds go down to a third while music plays (`window.__bloxAudio.duck`).

**Setup (owner, once), in the Spotify Developer Dashboard, the Melody Search app > Settings:**
1. Redirect URIs: add `https://tadiwa-m.github.io/Maastricht_larper/` (exactly, with the slash);
   for local tests also `http://127.0.0.1:8080/` (open the local site at 127.0.0.1, not localhost).
2. APIs used: tick Web API and Web Playback SDK.
3. User Management: add the Spotify accounts allowed to log in (development mode's allowlist).
4. The Client ID goes in `viewer/build.mjs` `SPOTIFY_CLIENT_ID` (public by design), or set
   `BLOX_SPOTIFY_ID` before `scripts/site.ps1`. Empty: the panel offers links only.

Tests: `test/spotify.test.mjs` (links, the PKCE challenge against RFC 7636's example, the login
address, the way back, token expiry).
Not possible: visuals synced to the beat of Spotify music (protected audio; the analysis API is
closed to new apps). The comic look reacts to game events instead (guide 06).
