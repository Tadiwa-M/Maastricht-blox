# Relay (Cloudflare Worker)

The site is static (GitHub Pages), and the open transit feeds can't be read from a browser
(OVapi sends no CORS headers; checked from the owner's browser on 2026-10-31). This small Worker
sits in between, on Cloudflare's free plan, and also turns "Report a mistake" into GitHub issues.

| Route | What | Needs |
|---|---|---|
| `GET /live?lines=ARR_21004,...` | Arriva/OVapi delays per journey, cached 20 s | nothing |
| `GET /trains?stations=MT,MTR` | NS departures with delays (Maastricht, Randwyck) | `NS_KEY` secret |
| `POST /report` | a map report -> GitHub issue (+ images on the `map-reports` branch) | `GITHUB_TOKEN` secret |
| `GET /room`, `POST /room`, `/room/<code>` (WebSocket) | multiplayer capture-the-flag rooms (`src/rooms.js`, `src/room.js`, rules `src/ctf.js`; docs/guide/18-multiplayer.md) | the `ROOMS` Durable Object binding (in `wrangler.toml`) |
| `GET /health` | which of the above are configured | |

## Deploy (once, from any PC with Node; no admin rights needed)

```powershell
cd C:\Users\tadiwa\maastricht-blox
git pull
.\scripts\relay.ps1            # installs, logs in to Cloudflare (browser), deploys, prints the URL
```
Then the two secrets (each command asks you to paste the value; it is stored encrypted at Cloudflare,
never in the repo or the chat):
```powershell
cd relay
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put NS_KEY     # optional, trains only
```
- **GITHUB_TOKEN**: github.com -> Settings -> Developer settings -> Fine-grained tokens -> Generate:
  repository access "Only select repositories" -> `Maastricht-blox`; permissions **Contents: Read and
  write** and **Issues: Read and write**; expiry 1 year.
- **NS_KEY**: apiportal.ns.nl -> Products -> "Ns-App" -> Subscribe -> Profile -> Primary key.

Check: open `https://blox-relay.<your-subdomain>.workers.dev/health` -> `{"ok":true,"reports":true,...}`.
Finally the site needs the relay URL. The deployed one (https://blox-relay.tmata1907.workers.dev)
is the default in `viewer/build.mjs` (`RELAY_URL`); `BLOX_RELAY=<url>` overrides it when building
the site, `BLOX_RELAY=none` builds without a relay.

## Limits and safety
- Free plan: 100k requests a day; `/live` answers come from Cloudflare's cache (one upstream call per
  20 s for everyone), so the CPU per request stays tiny.
- Reports: map reports only (`[map]` titles), JPEG images up to 2.5 MB, 2 per report, 5 reports per
  IP per hour. The token can only touch this repository.
- Rooms: one Durable Object per 4-letter code (SQLite-backed, the free plan's kind), WebSockets with
  the hibernation API; at most 8 players, 30 room creations per IP per hour, sockets only from
  `SITE_ORIGINS`. An empty room closes itself after 10 minutes.
- Tests: `cd relay && npm test` (pure parts: OVapi delays, NS departures, report checks; the room
  rules and the room object with a fake runtime). Locally: `npx wrangler dev` runs the rooms too.
