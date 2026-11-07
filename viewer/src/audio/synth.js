// Web Audio voices for the city, all synthesised (no sound files). A small fixed graph runs all
// the time: traffic rumble (brown noise, low-passed), crowd murmur (band-passed noise whose band and
// level wander like voices), rain (high-passed noise) and a bus engine (two oscillators). Short
// sounds are built per event and drop themselves when done: footsteps, landings, bird calls, bell
// strokes, bus doors. Spatial sound is a gain and a stereo pan per layer (no HRTF, no reverb), so
// phones keep up. The numbers come from mix.js; index.js sets them ~10 times a second.
import { SURFACES } from './mix.js';

const TAU_S = 0.12; // smoothing of the 10 Hz layer updates

function noiseBuffer(ac, seconds, brown = false) {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  let b = 0;
  for (let q = 0; q < n; q++) {
    const w = Math.random() * 2 - 1;
    if (brown) { b = (b + 0.02 * w) / 1.02; d[q] = b * 3.5; } else d[q] = w;
  }
  return buf;
}

/** A stereo panner, or a plain pass-through where the browser has none. */
function panner(ac) {
  if (ac.createStereoPanner) return ac.createStereoPanner();
  const g = ac.createGain();
  g.pan = { value: 0, setTargetAtTime() {}, setValueAtTime() {} };
  return g;
}

function filter(ac, type, f, q = 0.7) {
  const n = ac.createBiquadFilter();
  n.type = type; n.frequency.value = f; n.Q.value = q;
  return n;
}

function gainNode(ac, v = 0) { const g = ac.createGain(); g.gain.value = v; return g; }

function loop(ac, buffer) {
  const s = ac.createBufferSource();
  s.buffer = buffer; s.loop = true;
  s.start(0, Math.random() * buffer.duration);
  return s;
}

/** Disconnect a transient voice's nodes once its source has ended. */
function dropAfter(src, nodes) { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }; }

export class CitySynth {
  constructor(ac) {
    this.ac = ac;
    this.master = gainNode(ac, 0);
    const comp = ac.createDynamicsCompressor(); // a gentle limiter: bells + a bus + rain never clip
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.3;
    this.master.connect(comp).connect(ac.destination);
    this.white = noiseBuffer(ac, 2);
    const brown = noiseBuffer(ac, 3, true);

    this.traffic = { f: filter(ac, 'lowpass', 220, 0.6), g: gainNode(ac), p: panner(ac) };
    loop(ac, brown).connect(this.traffic.f).connect(this.traffic.g).connect(this.traffic.p).connect(this.master);

    this.crowd = { f: filter(ac, 'bandpass', 700, 1.4), g: gainNode(ac), p: panner(ac) };
    loop(ac, this.white).connect(this.crowd.f).connect(this.crowd.g).connect(this.crowd.p).connect(this.master);

    this.rain = { g: gainNode(ac) };
    const rainSrc = loop(ac, this.white);
    rainSrc.playbackRate.value = 0.93; // not in step with the crowd's copy of the noise
    rainSrc.connect(filter(ac, 'highpass', 1100, 0.5)).connect(filter(ac, 'lowpass', 9000, 0.5)).connect(this.rain.g).connect(this.master);

    const e = { f: filter(ac, 'lowpass', 300, 2), g: gainNode(ac), p: panner(ac), a: ac.createOscillator(), b: ac.createOscillator() };
    e.a.type = 'sawtooth'; e.b.type = 'square';
    e.a.frequency.value = 40; e.b.frequency.value = 20;
    const mixB = gainNode(ac, 0.6);
    e.a.connect(e.f); e.b.connect(mixB).connect(e.f);
    e.f.connect(e.g).connect(e.p).connect(this.master);
    e.a.start(); e.b.start();
    this.engine = e;
    this.resetBuses();
  }

  /** Fresh buses for the short sounds (after a long mute: drop what was scheduled meanwhile). */
  resetBuses() {
    const ac = this.ac;
    for (const n of [this.fx, this.bellBus?.g]) { try { n?.disconnect(); } catch { /* gone */ } }
    this.fx = gainNode(ac, 1);
    this.fx.connect(this.master);
    const b = { g: gainNode(ac, 0), f: filter(ac, 'lowpass', 6000, 0.5), p: panner(ac) };
    b.g.connect(b.f).connect(b.p).connect(this.master);
    this.bellBus = b;
  }

  set(param, v, tau = TAU_S) { param.setTargetAtTime(v, this.ac.currentTime, tau); }
  get now() { return this.ac.currentTime; }

  setVolume(v, tau = 0.08) { this.set(this.master.gain, v, tau); }

  /**
   * Layer levels (mix.js): { traffic: { level, pan, cut }, crowd: { level, pan }, rain,
   * engine: { level, pan, freq, cut }, bells: { level, pan, cut } }.
   */
  mix(m) {
    const { traffic: t, crowd: c, engine: e, bells: b } = m;
    this.set(this.traffic.g.gain, 0.9 * t.level);
    this.set(this.traffic.p.pan, t.pan, 0.3);
    this.set(this.traffic.f.frequency, t.cut, 0.3);
    // murmur: the band and the level wander a little every update, like voices coming and going
    this.set(this.crowd.g.gain, 1.0 * c.level * (0.65 + 0.6 * Math.random()), 0.06);
    this.set(this.crowd.f.frequency, 420 + 700 * Math.random(), 0.08);
    this.set(this.crowd.p.pan, c.pan, 0.3);
    this.set(this.rain.g.gain, 0.2 * m.rain, 0.5);
    this.set(this.engine.g.gain, 0.3 * e.level, 0.2);
    this.set(this.engine.p.pan, e.pan, 0.2);
    this.set(this.engine.a.frequency, e.freq, 0.3);
    this.set(this.engine.b.frequency, e.freq / 2, 0.3);
    this.set(this.engine.f.frequency, e.cut, 0.3);
    this.set(this.bellBus.g.gain, b.level, 0.3);
    this.set(this.bellBus.p.pan, b.pan, 0.3);
    this.set(this.bellBus.f.frequency, b.cut, 0.3);
  }

  /** A noise burst through a filter: footsteps, door hiss, landings. */
  burst(when, { type, f, q, len, vol, attack = 0.003 }) {
    const ac = this.ac, src = ac.createBufferSource(), fl = filter(ac, type, f, q), g = gainNode(ac);
    src.buffer = this.white;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + len);
    src.connect(fl).connect(g).connect(this.fx);
    src.start(when, Math.random() * (this.white.duration - len - 0.1), len + attack + 0.02);
    dropAfter(src, [src, fl, g]);
  }

  /** A short sine (falling pitch optional): heels, landing thuds, chimes. */
  tone(when, { f, f1 = f, len, vol, type = 'sine', out = this.fx, attack = 0.004 }) {
    const ac = this.ac, o = ac.createOscillator(), g = gainNode(ac);
    o.type = type;
    o.frequency.setValueAtTime(f, when);
    if (f1 !== f) o.frequency.exponentialRampToValueAtTime(f1, when + len);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + len);
    o.connect(g).connect(out);
    o.start(when); o.stop(when + attack + len + 0.02);
    dropAfter(o, [o, g]);
  }

  /** One footstep on a surface (mix.js SURFACES), vol 0..1. */
  step(surface, vol = 1, when = this.now) {
    const s = SURFACES[surface] || SURFACES.cobble;
    const v = 0.22 * vol * s.vol * (0.8 + 0.4 * Math.random());
    this.burst(when, { type: s.type, f: s.f * (0.85 + 0.3 * Math.random()), q: s.q, len: s.len, vol: v });
    if (s.heel) this.tone(when, { f: 140, f1: 70, len: 0.05, vol: v * s.heel });
  }

  /** Landing from a jump or a fall, strength 0..1. */
  thud(surface, strength = 0.5, when = this.now) {
    this.tone(when, { f: 95, f1: 42, len: 0.14 + 0.1 * strength, vol: 0.18 + 0.3 * strength });
    const s = SURFACES[surface] || SURFACES.cobble;
    this.burst(when, { type: 'lowpass', f: Math.min(1400, s.f), q: 0.7, len: s.len * 1.8, vol: 0.12 + 0.25 * strength });
  }

  /** One bird call (a trill or a fluting phrase), pan -1..1, vol 0..1. */
  chirp(pan = 0, vol = 0.5, when = this.now) {
    const ac = this.ac, o = ac.createOscillator(), g = gainNode(ac), p = panner(ac);
    p.pan.value = pan;
    const trill = Math.random() < 0.6;
    const n = trill ? 3 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 3);
    const step = trill ? 0.055 + Math.random() * 0.03 : 0.16 + Math.random() * 0.08;
    const base = trill ? 3200 + Math.random() * 2600 : 1500 + Math.random() * 1200;
    const amp = 0.13 * vol;
    g.gain.setValueAtTime(0, when);
    for (let q = 0; q < n; q++) {
      const t = when + q * step, f0 = base * (0.9 + 0.25 * Math.random()), f1 = f0 * (trill ? 0.7 + 0.5 * Math.random() : 0.85 + 0.3 * Math.random());
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + step * 0.8);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 0.85);
    }
    o.connect(g).connect(p).connect(this.fx);
    o.start(when); o.stop(when + n * step + 0.05);
    dropAfter(o, [o, g, p]);
  }

  /**
   * One bell stroke: f = the strike note (nominal, Hz). Partials of a church bell (hum, prime,
   * minor-third tierce, nominal, superquint, octave), the low ones ringing longest. small: 3 partials.
   */
  bell(when, f, vol = 1, ring = 4, small = false) {
    const P = small
      ? [[0.5, 0.35, 0.9], [1, 0.6, 0.6], [1.19, 0.25, 0.5]]
      : [[0.25, 0.32, 1.4], [0.5, 0.42, 1.1], [0.6, 0.3, 0.9], [1, 0.55, 0.7], [1.5, 0.16, 0.4], [2, 0.14, 0.3]];
    for (const [r, a, d] of P) {
      this.tone(when, { f: f * r * (1 + (Math.random() - 0.5) * 0.002), len: ring * d, vol: 0.55 * vol * a, out: this.bellBus.g, attack: 0.003 });
    }
  }

  /** A ridden bus's doors: 'open' (hiss, then a two-tone chime) or 'close' (three beeps, then a hiss). */
  door(kind, when = this.now) {
    const hiss = (t, len) => this.burst(t, { type: 'highpass', f: 2600, q: 0.6, len, vol: 0.12, attack: 0.04 });
    if (kind === 'open') {
      hiss(when, 0.6);
      this.tone(when + 0.25, { f: 988, len: 0.7, vol: 0.09 });
      this.tone(when + 0.6, { f: 784, len: 0.9, vol: 0.09 });
    } else {
      for (let q = 0; q < 3; q++) this.tone(when + q * 0.22, { f: 1320, len: 0.1, vol: 0.05, type: 'triangle' });
      hiss(when + 0.75, 0.45);
    }
  }
}
