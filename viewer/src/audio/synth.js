// Web Audio voices for the city, all synthesised (no sound files): rain (high-passed noise, the one
// layer that runs all the time) and short sounds built per event that drop themselves when done:
// footsteps, landings, bell strokes. (Traffic, crowd, birds and buses were taken out on the owner's
// request.) Spatial sound is a gain and a stereo pan (no HRTF, no reverb), so phones keep up.
import { SURFACES } from './mix.js';

const TAU_S = 0.12; // smoothing of the 10 Hz layer updates

function noiseBuffer(ac, seconds) {
  const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let q = 0; q < n; q++) d[q] = Math.random() * 2 - 1;
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
    const comp = ac.createDynamicsCompressor(); // a gentle limiter: bells + rain never clip
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.3;
    this.master.connect(comp).connect(ac.destination);
    this.white = noiseBuffer(ac, 2);
    this.rain = { g: gainNode(ac) };
    const rainSrc = loop(ac, this.white);
    rainSrc.connect(filter(ac, 'highpass', 1100, 0.5)).connect(filter(ac, 'lowpass', 9000, 0.5)).connect(this.rain.g).connect(this.master);

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

  /** Layer levels: { rain 0..1, bells: { level, pan, cut } }. */
  mix(m) {
    const b = m.bells;
    this.set(this.rain.g.gain, 0.2 * m.rain, 0.5);
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
}
