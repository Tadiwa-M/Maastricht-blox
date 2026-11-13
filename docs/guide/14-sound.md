# 14: Sound (the city's ambience in the web game)

Folder: `viewer/src/audio/`. Everything is synthesised with the Web Audio API: no sound files, so
there is nothing to license or host. Entry point `initAudio(ctx)`, called from `main.js`
`initHooks` after the report hook; it returns `{ update(dt) }`, which runs every frame.

## What you hear

A calm, quiet mix (2026-11-12). The owner found the earlier sound "just noise": traffic, crowd,
birds and bus sounds were taken out on 2026-11-08, and what remained was reworked so nothing is a
raw noise burst any more. Real recordings may come later.

| Layer | Source | Follows |
|---|---|---|
| Pad | four voices (a sine and a slightly detuned triangle each) through a low-pass: slow chords in C major (Cadd9, Am7, Fmaj7, Gsus); one voice moves every 15 s, so a chord takes a minute to change | always on, barely audible; a little brighter and louder by day, darker at night (`mix.js dayLevel` of the game clock's hour) |
| Church bells | the low partials of a bell only (hum, prime, tierce, a little nominal), soft attack, long tail, a dull feedback echo for "air" | the game clock (`__bloxLife.clock`): Sint Servaas strikes the hours 8:00-21:00 (count 1-12) after a short soft tune; no half hours, quiet in the evening and at night. Placed on the Vrijthof, heard across the old town, duller with distance. A jump of the clock (the "now" button, the Sun slider) strikes nothing |
| Footsteps | a soft low tap (a falling sine, 125-185 Hz by surface, slightly different each step) with a hint of low-passed texture | the walking player (`__bloxPlayer.ctrl`): one step per stride of the figure's gait (`figure/gait.js strideAt`), by surface: cobbles in the old town, paving outside it, gravel in the parks |
| Jump / landing | a soft tap / a low thud | the controller's grounded state and fall speed (a kerb step is no landing) |
| Rain | a low rumble (noise below ~400 Hz) plus sparse soft drops (short low tones): a patter, not a hiss | `ctx.weather.rain` (0..1) when a weather source exists, else `#rain=0..1` in the URL (re-read on hashchange) |

Master: the default volume is 35 % (gain ~0.1), a gentle limiter sits on the output, the first
start fades in over about 2 seconds, and mute, unmute and the slider fade (~0.2 s time constant).

### Measured

`viewer/test/audio.render.test.mjs` renders 30 s (fade-in, walking, a 3 o'clock strike, a landing,
then rain 0.5) through an `OfflineAudioContext` in headless Chromium at the default volume and
checks the numbers (`BLOX_AUDIO_PRINT=1` prints them; skipped where no Chromium is installed):

| | before (2026-11-08) | now | test limit |
|---|---|---|---|
| Peak | -14.3 dBFS | -24.6 dBFS | < -18 |
| RMS | -35.8 dBFS | -41.1 dBFS | -55 .. -30 |
| Energy above 4 kHz | 44 % | < 0.001 % | < 1 % |
| Largest sample-to-sample jump | 0.055 | 0.002 | < 0.01 |

The ear is on the walking player (pan follows the camera), otherwise at the camera: the bells are placed
by distance and side from there.

## Controls

The settings panel (`#hud`) has a **Sound** row: volume slider (0-100 %) and a mute button.
**V** toggles mute (not while typing, not on the title screen). Saved per browser in
`localStorage` under `blox.audio.v2` (`{ volume, muted }`, default 35 %, not muted); storage
failures fall back to the defaults. `#audio=0` in the URL disables sound; screenshots
(`?shot=1`, `ctx.still`) never start it.

## Browser rules and cost

- Autoplay: the `AudioContext` is created on the first key, click or tap (the title screen's
  "press any key"); before that nothing runs.
- Muted, at volume 0 or in a hidden tab the sound fades out and the context is suspended a second
  later (no audio CPU). Unmuting after
  more than a second drops whatever was scheduled meanwhile (`CitySynth.resetBuses`).
- The always-on graph is ~35 nodes (one looping noise source, the pad's 8 oscillators, filters,
  gains, stereo panners, one delay, one compressor as a limiter). Short sounds build 2-3 nodes each
  and disconnect themselves when done; an hour strike is 8 nodes per stroke. No convolution, no HRTF: each layer
  is a gain and a stereo pan by distance. Layers update at ~10 Hz; footsteps and bells are
  checked every frame and scheduled on the audio clock.

## Code

| File | What |
|---|---|
| `index.js` | `initAudio(ctx)`: unlock on gesture, mute/suspend, reads life/player/ride state, schedules events, sets the layers. `window.__bloxAudio.state()` shows the context state, prefs and the latest layer levels |
| `mix.js` | pure: ear, distance falloff, pan, green areas, surfaces, rain, daylight |
| `events.js` | pure: `bellStrikes`, `StepClock`, `AirWatch`, the bell tune |
| `places.js` | pure: the towers and the green areas (RD / GPS, approximate) -> Unity metres for the world's `originRD` |
| `prefs.js` | pure: volume and mute in `localStorage` |
| `synth.js` | the Web Audio voices (`CitySynth`) |
| `ui.js` | the Sound row and the V key |

Tests: `viewer/test/audio.test.mjs` (the pure logic) and `audio.synth.test.mjs` (every voice
against a recording stand-in for `AudioContext`: valid ramps, sounds stop themselves, small graph)
and `audio.render.test.mjs` (the real render, measured; see above).

## Tuning and next steps

- Places are hand-placed to tens of metres (`places.js`); refine them or derive green areas from the
  BGT (grass/park polygons) once the life export carries them.
- Footstep surfaces are a rule of thumb (old-town circle, parks). A `city.surfaceAt(x, z)` query
  (ground brick colour) would give the real surface; wood on bridges, wet stone in the rain.
- A real weather source only has to set `ctx.weather = { rain }` (life reads the same field).
