# 14: Sound (the city's ambience in the web game)

Folder: `viewer/src/audio/`. Everything is synthesised with the Web Audio API: no sound files, so
there is nothing to license or host. Entry point `initAudio(ctx)`, called from `main.js`
`initHooks` after the report hook; it returns `{ update(dt) }`, which runs every frame.

## What you hear

| Layer | Source | Follows |
|---|---|---|
| Traffic rumble | brown noise, low-passed | cars (`__bloxLife.cars.footprints`), buses and trains (`__bloxLife.vehicles`) near the ear, louder and brighter when close and fast; plus a city-wide hum by the hour (`life/density.js trafficFactor`) |
| Crowd murmur | white noise through a wandering band-pass | walker groups near the ear (`__bloxLife.walkers`), weighted by group size; halved in the rain |
| Birds | short sine trills and fluting phrases | dawn chorus (5:30-8), quieter by day, a little dusk song, none at night; ~10x more in parks; none in the rain; fewer next to busy roads |
| Church bells | additive bell partials (hum, prime, tierce, nominal, superquint, octave) | the game clock (`__bloxLife.clock`): Sint Servaas strikes the hours 7:00-22:00 (count 1-12), after a short tune on Sint Jan's small bells; Sint Jan strikes the half hours. Placed on the Vrijthof, heard across the old town, duller with distance. A jump of the clock (the "now" button, the Sun slider) strikes nothing |
| Footsteps | filtered noise bursts + a heel tap | the walking player (`__bloxPlayer.ctrl`): one step per stride of the figure's gait (`figure/gait.js strideAt`), by surface: cobbles in the old town, paving outside it, gravel in the parks |
| Jump / landing | scuff / low thud | the controller's grounded state and fall speed (a kerb step is no landing) |
| Bus engine | sawtooth + square, low-passed | the nearest bus (pitch and brightness by speed); riding (`__bloxRide.state.ride`): the ridden bus, muffled |
| Bus doors | hiss + two-tone chime / three beeps + hiss | the ridden bus stopping (0.4 s still) and moving off |
| Rain | high-passed noise | `ctx.weather.rain` (0..1) when a weather source exists, else `#rain=0..1` in the URL (re-read on hashchange) |

The ear is on the walking player (pan follows the camera), otherwise at the camera: from the map
view street detail fades with height (`heightFade`), so the overview hears the city hum and the
bells, not single cars.

## Controls

The settings panel (`#hud`) has a **Sound** row: volume slider (0-100 %) and a mute button.
**V** toggles mute (not while typing, not on the title screen). Saved per browser in
`localStorage` under `blox.audio.v1` (`{ volume, muted }`, default 60 %, not muted); storage
failures fall back to the defaults. `#audio=0` in the URL disables sound; screenshots
(`?shot=1`, `ctx.still`) never start it.

## Browser rules and cost

- Autoplay: the `AudioContext` is created on the first key, click or tap (the title screen's
  "press any key"); before that nothing runs.
- Muted, at volume 0 or in a hidden tab the context is suspended (no audio CPU). Unmuting after
  more than a second drops whatever was scheduled meanwhile (`CitySynth.resetBuses`).
- The always-on graph is ~23 nodes (3 looping noise sources, 2 oscillators, filters, gains,
  stereo panners, one compressor as a limiter). Short sounds build 2-3 nodes each and disconnect
  themselves when done; an hour strike peaks at ~40 live nodes. No convolution, no HRTF: each layer
  is a gain and a stereo pan by distance. Layers update at ~10 Hz; footsteps, bells and doors are
  checked every frame and scheduled on the audio clock.

## Code

| File | What |
|---|---|
| `index.js` | `initAudio(ctx)`: unlock on gesture, mute/suspend, reads life/player/ride state, schedules events, sets the layers. `window.__bloxAudio.state()` shows the context state, prefs and the latest layer levels |
| `mix.js` | pure: ear, distance falloff, pan, many sources -> one level, bird rate, green areas, surfaces, rain, engine voice |
| `events.js` | pure: `bellStrikes`, `StepClock`, `AirWatch`, `DoorWatch`, `eventsInTick`, the bell tune |
| `places.js` | pure: the towers and the green areas (RD / GPS, approximate) -> Unity metres for the world's `originRD` |
| `prefs.js` | pure: volume and mute in `localStorage` |
| `synth.js` | the Web Audio voices (`CitySynth`) |
| `ui.js` | the Sound row and the V key |

Tests: `viewer/test/audio.test.mjs` (the pure logic) and `audio.synth.test.mjs` (every voice
against a recording stand-in for `AudioContext`: valid ramps, sounds stop themselves, small graph).

## Tuning and next steps

- Places are hand-placed to tens of metres (`places.js`); refine them or derive green areas from the
  BGT (grass/park polygons) once the life export carries them.
- Footstep surfaces are a rule of thumb (old-town circle, parks). A `city.surfaceAt(x, z)` query
  (ground brick colour) would give the real surface; wood on bridges, wet stone in the rain.
- A real weather source only has to set `ctx.weather = { rain }` (life reads the same field).
