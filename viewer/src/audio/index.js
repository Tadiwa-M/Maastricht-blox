// City sound for the web game, all synthesised with the Web Audio API (no sound files): traffic
// rumble near cars and buses, crowd murmur by how many people are around, birds by day in the
// green, rain, the Vrijthof bells striking the game clock's hours, footsteps, jump and landing
// thuds, bus engines and a ridden bus's doors. Entry point, called once from main.js initHooks
// (the `// [audio hook]`): const hook = await initAudio(ctx); hook.update(dt) every frame.
//
// It only reads the other tracks' state: window.__bloxLife (clock, cars, buses, walkers),
// window.__bloxPlayer (walk mode, the controller) and window.__bloxRide (the ridden bus).
// Browsers only start sound after a user gesture: the context is created on the first key, click
// or tap (the title screen's "press any key"). The layers update ~10 times a second, footsteps
// and bells every frame. Muted or in a hidden tab the context is suspended (no CPU).
// Guide: docs/guide/14-sound.md. The numbers: mix.js and events.js (pure, tested).
import { audioPlaces } from './places.js';
import { att, earFrom, placeOf, busyLevel, addLevels, heightFade, greenAt, birdRate, surfaceAt, rainLevel, engineVoice, clamp } from './mix.js';
import { bellStrikes, StepClock, AirWatch, DoorWatch, eventsInTick, PRELUDE, PRELUDE_BEAT_S, STRIKE_GAP_S } from './events.js';
import { loadPrefs, savePrefs, masterGain } from './prefs.js';
import { bindAudioUI } from './ui.js';
import { CitySynth } from './synth.js';
import { trafficFactor } from '../life/density.js';
import { strideAt } from '../figure/gait.js';

const TICK_S = 0.1; // layer updates: ~10 Hz
const BELL_HOUR_HZ = 233; // Sint Servaas (B flat)
const BELL_HALF_HZ = 349; // Sint Jan (F)
const PRELUDE_HZ = 1047; // C6, the small bells' tune

export async function initAudio(ctx) {
  if (typeof window === 'undefined' || ctx.still || /[#&]audio=0\b/.test(location.hash)) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const prefs = loadPrefs(store);
  const places = audioPlaces(ctx.originRD || window.BLOX_SITE?.originRD);
  const camera = ctx.camera || ctx.stage?.camera;
  let ac = null, synth = null, offSince = 0, suspendTimer = 0;

  const wanted = () => !prefs.muted && prefs.volume > 0 && !document.hidden;
  function apply() {
    if (!wanted()) {
      if (!synth) return;
      synth.setVolume(0);
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => { if (!wanted() && ac.state === 'running') { ac.suspend(); offSince = performance.now(); } }, 250);
      return;
    }
    if (!ac) {
      try { ac = new AC({ latencyHint: 'playback' }); synth = new CitySynth(ac); } catch (e) { console.warn('audio', e); ac = null; return; }
    }
    clearTimeout(suspendTimer);
    if (offSince && performance.now() - offSince > 1000) synth.resetBuses(); // drop sounds queued before the mute
    offSince = 0;
    if (ac.state !== 'running') ac.resume().catch(() => {});
    synth.setVolume(masterGain(prefs), 0.15);
  }
  const ui = bindAudioUI(prefs, { onChange: () => { savePrefs(store, prefs); if (gestured) apply(); } });

  // autoplay rules: the first gesture creates and starts the context
  let gestured = false;
  const GESTURES = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'];
  const onGesture = () => {
    gestured = true;
    apply();
    if (!ac || ac.state === 'running' || !wanted()) for (const g of GESTURES) window.removeEventListener(g, onGesture, true);
  };
  for (const g of GESTURES) window.addEventListener(g, onGesture, true);
  document.addEventListener('visibilitychange', () => { if (gestured) apply(); });

  const steps = new StepClock(strideAt), air = new AirWatch(), doors = new DoorWatch();
  let lastPos = null, lastT = null, tickAcc = 0, rideId = null, hashRain = rainLevel(null, location.hash);
  window.addEventListener('hashchange', () => { hashRain = rainLevel(null, location.hash); });
  const rain = () => (Number.isFinite(ctx.weather?.rain) ? rainLevel(ctx.weather) : hashRain);

  /** Where the ear is: on the walking player, else at the camera (riding: in the bus). */
  function ear() {
    const pl = window.__bloxPlayer, e = camera.matrixWorld.elements;
    const walking = pl?.mode === 'walk' && !window.__bloxRide?.state?.ride;
    const groundY = ctx.controls?.target ? ctx.controls.target.y : 0;
    return earFrom(camera.position.toArray(), [e[0], e[1], e[2]], groundY, walking ? pl.ctrl.pos : null);
  }

  function ridden(life) {
    const r = window.__bloxRide?.state?.ride;
    return r ? (life?.vehicles || []).find((v) => v.id === r.id) || null : null;
  }

  /** Bells due on the game clock this frame (strokes scheduled ahead on the audio clock). */
  function bells(clock) {
    const t = clock.t, due = bellStrikes(lastT, t);
    lastT = t;
    let when = synth.now + 0.05;
    for (const s of due) {
      if (s.kind === 'half') { synth.bell(when, BELL_HALF_HZ, 0.8, 3.5); continue; }
      for (const [semi, beat] of PRELUDE) synth.bell(when + beat * PRELUDE_BEAT_S, PRELUDE_HZ * 2 ** (semi / 12), 0.45, 1.6, true);
      when += (PRELUDE[PRELUDE.length - 1][1] + 3) * PRELUDE_BEAT_S;
      for (let q = 0; q < s.count; q++) synth.bell(when + q * STRIKE_GAP_S, BELL_HOUR_HZ, 1, 4.5);
    }
  }

  /** The walking player's feet: steps by distance, jump and landing. */
  function feet(dt) {
    const pl = window.__bloxPlayer;
    if (pl?.mode !== 'walk' || window.__bloxRide?.state?.ride) { lastPos = null; return; }
    const c = pl.ctrl, p = c.pos;
    const moved = lastPos ? Math.hypot(p[0] - lastPos[0], p[2] - lastPos[2]) : 0;
    lastPos = [p[0], p[1], p[2]];
    if (moved > 3) return; // a teleport (walk here, getting off a bus), not a stride
    const speed = Math.hypot(c.vel[0], c.vel[2]);
    const surface = surfaceAt(p[0], -p[2], places);
    const n = steps.update(moved, speed, c.grounded && !c.frozen);
    for (let q = 0; q < n; q++) synth.step(surface, 0.7 + 0.3 * clamp(speed / 4), synth.now + q * 0.12);
    const ev = air.update(c.grounded, c.vel[1], dt);
    if (ev?.kind === 'jump') synth.step(surface, 0.6);
    else if (ev?.kind === 'land') synth.thud(surface, ev.strength);
  }

  /** The ridden bus's doors at its stops. */
  function rideDoors(life, dt) {
    const v = ridden(life);
    if (!v) { rideId = null; return; }
    if (v.id !== rideId) { rideId = v.id; doors.reset(); doors.state = Math.abs(v.v || 0) < 0.15 ? 'open' : 'moving'; }
    const ev = doors.update(v.v, dt);
    if (ev) synth.door(ev);
  }

  /** The layers: traffic, crowd, birds, rain, the nearest bus engine, the bells' direction. */
  function layers(life) {
    const E = ear(), clock = life?.clock, hours = clock?.hours ?? 12, day = clock?.day ?? 2;
    const r = rain(), fade = heightFade(E.h);
    const ride = ridden(life);
    // traffic: the cars and buses around, over a city-wide hum by the hour
    const cars = life?.cars ? life.cars.footprints([E.x, E.z], 30) : [];
    const vehicles = life?.vehicles || [];
    const items = cars.concat(vehicles.filter((v) => v !== ride));
    const loud = (it) => (it.mode === 'rail' ? 1.6 : it.mode ? 1.1 : 0.45) * (0.45 + 0.55 * clamp(Math.abs(it.v || 0) / 12));
    const near = busyLevel(E, items, loud, 10);
    const hum = 0.07 + 0.2 * trafficFactor(hours, day);
    const traffic = { level: clamp(addLevels(near.level, hum)), pan: near.pan * near.level / (near.level + hum), cut: 170 + 700 * clamp(near.near) };
    // crowd: walker groups near the ear (the people simulated are within ~50-180 m)
    const groups = life?.walkers ? life.walkers.groups.slice(0, life.walkers.active ?? 0) : [];
    const heads = groups.map((g) => ({ x: g.walker.x, z: g.walker.z, n: g.size ?? g.members?.length ?? 1 }));
    const people = busyLevel(E, heads, (h) => 0.25 * Math.sqrt(h.n), 5);
    const crowd = { level: clamp(people.level * (1 - 0.5 * r)), pan: people.pan };
    // bus engine: the nearest bus on the road, or the one we ride (inside: muffled)
    let engine = { level: 0, pan: 0, freq: 40, cut: 300 };
    if (ride) {
      const ev = engineVoice(ride.v);
      engine = { level: 0.55 * ev.loud, pan: 0, freq: ev.freq, cut: ev.cut * 0.6 };
    } else {
      let best = null, bestA = 0;
      for (const v of vehicles) {
        if (v.mode === 'rail') continue;
        const pv = placeOf(E, v.x, v.z), a = att(pv.d, 7);
        if (a > bestA) { bestA = a; best = { v, pan: pv.pan }; }
      }
      if (best && bestA > 0.05) {
        const ev = engineVoice(best.v.v);
        engine = { level: bestA * ev.loud, pan: best.pan, freq: ev.freq, cut: ev.cut };
      }
    }
    // the bells: heard across the old town, duller with distance
    const b = places.bells.servaas, pb = placeOf(E, b.x, b.z), lb = att(pb.d, 90);
    const bellMix = { level: lb, pan: pb.pan, cut: 700 + 7000 * lb };
    last = { traffic, crowd, engine, rain: r * (ride ? 0.6 : 1), bells: bellMix };
    synth.mix(last);
    // birds: a call now and then, more at dawn and in the parks, none at night or in the rain
    const rate = birdRate({ hours, green: greenAt(E.x, E.z, places.parks), rain: r, h: E.h, traffic: near.level });
    const calls = ride ? 0 : eventsInTick(rate, TICK_S);
    last.birds = rate;
    for (let q = 0; q < calls; q++) synth.chirp((Math.random() * 2 - 1) * 0.8, (0.4 + 0.6 * Math.random()) * fade, synth.now + Math.random() * TICK_S);
  }

  let last = null; // the latest layer levels (window.__bloxAudio.state(), for checks and tuning)
  const api = {
    update(dt) {
      const life = window.__bloxLife;
      if (!synth || ac.state !== 'running') { lastT = life?.clock?.t ?? null; lastPos = null; return; }
      if (life?.clock) bells(life.clock);
      feet(dt);
      rideDoors(life, dt);
      if ((tickAcc += dt) >= TICK_S) { tickAcc = 0; layers(life); }
    },
    prefs, ui,
    state: () => ({ context: ac?.state || 'none', gestured, prefs: { ...prefs }, mix: last }),
  };
  window.__bloxAudio = api;
  return api;
}
