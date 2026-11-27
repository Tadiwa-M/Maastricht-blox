// City sound for the web game, all synthesised with the Web Audio API (no sound files) and kept
// calm: a barely audible pad of slow chords, the Vrijthof bells striking the game clock's hours,
// soft footsteps and landings, rain as a low patter. (Traffic, crowd, birds and bus sounds were
// taken out on the owner's request.) Entry point, called once from main.js initHooks
// (the `// [audio hook]`): const hook = await initAudio(ctx); hook.update(dt) every frame.
//
// It only reads the other tracks' state: window.__bloxLife (clock),
// window.__bloxPlayer (walk mode, the controller) and window.__bloxRide (the ridden bus).
// Browsers only start sound after a user gesture: the context is created on the first key, click
// or tap (the title screen's "press any key"). The layers update ~10 times a second, footsteps
// and bells every frame. Muted or in a hidden tab the context is suspended (no CPU).
// Guide: docs/guide/14-sound.md. The numbers: mix.js and events.js (pure, tested).
import { audioPlaces } from './places.js';
import { att, earFrom, placeOf, surfaceAt, rainLevel, dayLevel, clamp } from './mix.js';
import { bellStrikes, StepClock, AirWatch } from './events.js';
import { loadPrefs, savePrefs, masterGain } from './prefs.js';
import { bindAudioUI } from './ui.js';
import { CitySynth } from './synth.js';
import { strideAt } from '../figure/gait.js';

const TICK_S = 0.1; // layer updates: ~10 Hz
const FADE_IN_TAU_S = 0.6; // the first start: ~2 s to full level
const FADE_TAU_S = 0.2; // mute, unmute, the volume slider

export async function initAudio(ctx) {
  if (typeof window === 'undefined' || ctx.still || /[#&]audio=0\b/.test(location.hash)) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const store = (() => { try { return window.localStorage; } catch { return null; } })();
  const prefs = loadPrefs(store);
  const places = audioPlaces(ctx.originRD || window.BLOX_SITE?.originRD);
  const camera = ctx.camera || ctx.stage?.camera;
  let ac = null, synth = null, offSince = 0, suspendTimer = 0, started = false;

  const wanted = () => !prefs.muted && prefs.volume > 0 && !document.hidden;
  let duckK = 1; // the city steps back while your own music plays (music/spotify.js)
  function apply() {
    if (!wanted()) {
      if (!synth) return;
      synth.setVolume(0, FADE_TAU_S); // fade out, then stop the context
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => { if (!wanted() && ac.state === 'running') { ac.suspend(); offSince = performance.now(); } }, 1000);
      return;
    }
    if (!ac) {
      try { ac = new AC({ latencyHint: 'playback' }); synth = new CitySynth(ac); } catch (e) { console.warn('audio', e); ac = null; return; }
    }
    clearTimeout(suspendTimer);
    if (offSince && performance.now() - offSince > 1000) synth.resetBuses(); // drop sounds queued before the mute
    offSince = 0;
    if (ac.state !== 'running') ac.resume().catch(() => {});
    synth.setVolume(masterGain(prefs) * duckK, started ? FADE_TAU_S : FADE_IN_TAU_S);
    started = true;
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

  const steps = new StepClock(strideAt), air = new AirWatch();
  let lastPos = null, lastT = null, tickAcc = 0, hashRain = rainLevel(null, location.hash);
  window.addEventListener('hashchange', () => { hashRain = rainLevel(null, location.hash); });
  // the rain you hear is the rain life uses (the real weather, or #rain=); snow falls silently
  const rain = () => { const w = window.__bloxLife?.weather; if (w && Number.isFinite(w.rain)) return w.snow ? 0 : rainLevel(w); return Number.isFinite(ctx.weather?.rain) ? rainLevel(ctx.weather) : hashRain; };
  // thunder after a lightning flash (render/weatherfx.js): a low rumble, later the farther the bolt
  window.addEventListener('blox:lightning', (e) => {
    if (!synth || !wanted() || ac.state !== 'running') return;
    try {
      const t = ac.currentTime + (e.detail?.delay ?? 1), len = 2.8;
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) { const k = i / d.length; d[i] = (Math.random() * 2 - 1) * (k < 0.04 ? k / 0.04 : (1 - k) ** 1.6) * (0.7 + 0.3 * Math.sin(i / 900)); }
      const n = ac.createBufferSource(); n.buffer = buf;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const g = ac.createGain(); g.gain.value = 0.9 * masterGain(prefs) * duckK;
      n.connect(lp).connect(g).connect(ac.destination); n.start(t);
    } catch { /* no audio */ }
  });

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
    for (const s of due) if (s.kind === 'hour') synth.hourStrike(synth.now + 0.05, s.count);
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
    if (ev?.kind === 'jump') synth.step(surface, 0.5);
    else if (ev?.kind === 'land') synth.thud(surface, ev.strength);
  }

  /** The layers: rain (softer inside a bus), the pad's daylight and where the bells are heard from. */
  function layers(life) {
    const E = ear(), ride = ridden(life);
    const b = places.bells.servaas, pb = placeOf(E, b.x, b.z), lb = 0.8 * att(pb.d, 90); // across the old town, duller with distance
    last = { rain: rain() * (ride ? 0.6 : 1), day: dayLevel(life?.clock?.hours), bells: { level: lb, pan: pb.pan, cut: 500 + 2500 * lb } };
    synth.mix(last);
  }

  let last = null; // the latest layer levels (window.__bloxAudio.state(), for checks and tuning)
  const api = {
    update(dt) {
      const life = window.__bloxLife;
      if (!synth || ac.state !== 'running') { lastT = life?.clock?.t ?? null; lastPos = null; return; }
      if (life?.clock) bells(life.clock);
      feet(dt);
      if ((tickAcc += dt) >= TICK_S) { tickAcc = 0; layers(life); }
    },
    prefs, ui,
    /** Your music playing (true) or not: the city's sounds go down to a third, or back. */
    duck(on) { duckK = on ? 0.33 : 1; if (synth && wanted()) synth.setVolume(masterGain(prefs) * duckK, 0.8); },
    state: () => ({ context: ac?.state || 'none', gestured, prefs: { ...prefs }, mix: last }),
  };
  window.__bloxAudio = api;
  return api;
}
