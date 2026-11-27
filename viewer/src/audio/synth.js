// Web Audio voices for the city, all synthesised (no sound files), kept calm: a barely audible
// musical bed (slow warm pad chords), mellow distant bells with a little echo ("air"), soft low
// footstep taps and landing thuds, and rain as a low patter. Everything is low-passed and fades in
// and out gently; nothing is a raw noise burst. Spatial sound is a gain and a stereo pan (no HRTF,
// no convolution), so phones keep up. Measured in test/audio.render.test.mjs.
import { SURFACES } from './mix.js';
import { PRELUDE, PRELUDE_BEAT_S, STRIKE_GAP_S } from './events.js';

const TAU_S = 0.12; // smoothing of the 10 Hz layer updates
const BELL_HOUR_HZ = 233; // Sint Servaas (B flat)
const PRELUDE_HZ = 523; // C5, the small bells' tune

// The pad: four voices, chords in C major (no leading tones, mostly open fifths and seconds), as
// MIDI notes. One voice moves every PAD_MOVE_S, so a chord takes a minute to turn into the next.
const PAD_CHORDS = [[48, 55, 62, 64], [45, 55, 60, 64], [41, 57, 60, 64], [43, 55, 60, 62]];
const PAD_MOVE_S = 15;
const PAD_PAN = [0, -0.3, 0.3, -0.1];
const PAD_VOICE = [0.3, 0.26, 0.2, 0.16]; // the low voices carry it
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

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

/** Disconnect a transient voice's nodes once its source has ended. */
function dropAfter(src, nodes) { src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } }; }

/** A soft envelope: up over `attack`, then an exponential fade (time constant len / 4). -> end time. */
function swell(param, when, vol, attack, len) {
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(vol, when + attack);
  param.setTargetAtTime(0, when + attack, len / 4);
  return when + attack + len * 2;
}

export class CitySynth {
  constructor(ac) {
    this.ac = ac;
    this.master = gainNode(ac, 0);
    const comp = ac.createDynamicsCompressor(); // a gentle limiter: nothing ever jumps out
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 6; comp.attack.value = 0.02; comp.release.value = 0.5;
    this.master.connect(comp).connect(ac.destination);

    // rain: a low rumble of filtered noise; the drops are added in mix()
    this.white = noiseBuffer(ac, 2);
    this.rain = { g: gainNode(ac), level: 0 };
    const rainSrc = ac.createBufferSource();
    rainSrc.buffer = this.white; rainSrc.loop = true;
    rainSrc.start(0, Math.random() * this.white.duration);
    rainSrc.connect(filter(ac, 'lowpass', 420, 0.5)).connect(filter(ac, 'lowpass', 900, 0.5)).connect(this.rain.g).connect(this.master);

    // the pad: per voice a sine and a slightly detuned triangle, through one low-pass
    const pad = { g: gainNode(ac), f: filter(ac, 'lowpass', 600, 0.4), voices: [], chord: 0, moves: 0, next: PAD_MOVE_S };
    pad.f.connect(pad.g).connect(this.master);
    PAD_CHORDS[0].forEach((midi, q) => {
      const g = gainNode(ac, PAD_VOICE[q]), p = panner(ac), oscs = ['sine', 'triangle'].map((type, k) => {
        const o = ac.createOscillator();
        o.type = type; o.frequency.value = hz(midi); o.detune.value = k ? 5 + 2 * q : -3;
        o.connect(g); o.start(0);
        return o;
      });
      p.pan.value = PAD_PAN[q];
      g.connect(p).connect(pad.f);
      pad.voices.push({ g, oscs });
    });
    this.pad = pad;

    // "air" for the bells: a quiet, dull feedback echo
    const air = { d: ac.createDelay(1), f: filter(ac, 'lowpass', 1400, 0.5), fb: gainNode(ac, 0.42), wet: gainNode(ac, 0.35) };
    air.d.delayTime.value = 0.33;
    air.d.connect(air.f).connect(air.fb).connect(air.d);
    air.f.connect(air.wet).connect(this.master);
    this.air = air;

    this.resetBuses();
  }

  /** Fresh buses for the short sounds (after a long mute: drop what was scheduled meanwhile). */
  resetBuses() {
    const ac = this.ac;
    for (const n of [this.fx, this.bellBus?.g, this.bellBus?.p]) { try { n?.disconnect(); } catch { /* gone */ } }
    this.fx = gainNode(ac, 1);
    this.fx.connect(this.master);
    const b = { g: gainNode(ac, 0), f: filter(ac, 'lowpass', 2000, 0.5), p: panner(ac) };
    b.g.connect(b.f).connect(b.p).connect(this.master);
    b.p.connect(this.air.d);
    this.bellBus = b;
  }

  set(param, v, tau = TAU_S) { param.setTargetAtTime(v, this.ac.currentTime, tau); }
  get now() { return this.ac.currentTime; }

  setVolume(v, tau = 0.2) { this.set(this.master.gain, v, tau); }

  /** Layer levels: { rain 0..1, day 0..1 (1 = daylight), bells: { level, pan, cut } }; ~10 Hz. */
  mix(m) {
    const b = m.bells, day = m.day ?? 1;
    this.rain.level = m.rain;
    this.set(this.rain.g.gain, 0.55 * m.rain, 0.8);
    this.set(this.bellBus.g.gain, b.level, 0.3);
    this.set(this.bellBus.p.pan, b.pan, 0.3);
    this.set(this.bellBus.f.frequency, b.cut, 0.3);
    this.set(this.pad.g.gain, 0.05 + 0.03 * day, 2);
    this.set(this.pad.f.frequency, 380 + 420 * day, 2);
    this.padMove();
    for (let q = 0; q < 3; q++) if (Math.random() < m.rain * 0.3) this.drop(this.now + Math.random() * 0.1);
  }

  /** Every PAD_MOVE_S one pad voice fades out, takes its note of the next chord and comes back. */
  padMove() {
    const pad = this.pad, t = this.now;
    if (t < pad.next) return;
    pad.next = t + PAD_MOVE_S;
    const q = pad.moves % pad.voices.length;
    if (q === 0) pad.chord = (pad.chord + 1) % PAD_CHORDS.length;
    pad.moves++;
    const v = pad.voices[q], f = hz(PAD_CHORDS[pad.chord][q]);
    v.g.gain.setTargetAtTime(0, t, 1);
    for (const o of v.oscs) o.frequency.setTargetAtTime(f, t + 6, 0.05);
    v.g.gain.setTargetAtTime(PAD_VOICE[q], t + 6.5, 2);
  }

  /** A raindrop: a tiny soft low blip. */
  drop(when) {
    const f = 240 + 380 * Math.random();
    this.tone(when, { f, f1: f * 0.8, len: 0.05, vol: 0.02 + 0.03 * Math.random(), attack: 0.008 });
  }

  /** A hint of texture: low-passed noise with a soft envelope (never a raw burst). */
  texture(when, { f, len, vol, attack = 0.012 }) {
    const ac = this.ac, src = ac.createBufferSource(), fl = filter(ac, 'lowpass', f, 0.5), g = gainNode(ac);
    src.buffer = this.white;
    const end = swell(g.gain, when, vol, attack, len);
    src.connect(fl).connect(g).connect(this.fx);
    src.start(when, Math.random() * (this.white.duration - (end - when) - 0.1), end - when);
    dropAfter(src, [src, fl, g]);
  }

  /** A soft tone (falling pitch optional): taps, thuds, drops, bell partials. */
  tone(when, { f, f1 = f, len, vol, type = 'sine', out = this.fx, attack = 0.012 }) {
    const ac = this.ac, o = ac.createOscillator(), g = gainNode(ac);
    o.type = type;
    o.frequency.setValueAtTime(f, when);
    if (f1 !== f) o.frequency.exponentialRampToValueAtTime(f1, when + attack + len);
    const end = swell(g.gain, when, vol, attack, len);
    o.connect(g).connect(out);
    o.start(when); o.stop(end);
    dropAfter(o, [o, g]);
  }

  /** One footstep on a surface (mix.js SURFACES), vol 0..1: a low tap, slightly different each time. */
  step(surface, vol = 1, when = this.now) {
    const s = SURFACES[surface] || SURFACES.cobble;
    const v = 0.13 * vol * s.vol * (0.85 + 0.3 * Math.random()), f = s.f * (0.92 + 0.16 * Math.random());
    this.tone(when, { f, f1: f * 0.6, len: s.len, vol: v });
    this.texture(when, { f: s.tex, len: s.len, vol: v * s.grain });
  }

  /** Landing from a jump or a fall, strength 0..1: a soft low thud. */
  thud(surface, strength = 0.5, when = this.now) {
    const s = SURFACES[surface] || SURFACES.cobble;
    this.tone(when, { f: 92, f1: 48, len: 0.2 + 0.1 * strength, vol: 0.12 + 0.14 * strength, attack: 0.016 });
    this.texture(when, { f: 320, len: 0.14, vol: (0.04 + 0.05 * strength) * s.vol, attack: 0.016 });
  }

  /**
   * One bell stroke, mellow: f = the strike note (nominal, Hz). Only the low partials of a church
   * bell (hum, prime, minor-third tierce, a little nominal), a soft attack and a long tail; the
   * low ones ring longest. small: 2 partials.
   */
  bell(when, f, vol = 1, ring = 6, small = false) {
    const P = small
      ? [[0.5, 0.3, 1], [1, 0.4, 0.7]]
      : [[0.25, 0.3, 1.4], [0.5, 0.45, 1.1], [0.6, 0.2, 0.8], [1, 0.26, 0.6]];
    for (const [r, a, d] of P) {
      this.tone(when, { f: f * r * (1 + (Math.random() - 0.5) * 0.002), len: ring * d, vol: 0.4 * vol * a, out: this.bellBus.g, attack: 0.03 });
    }
  }

  /** The hour: the short tune on the small bells, then `count` slow strokes of the big bell. */
  hourStrike(when, count) {
    for (const [semi, beat] of PRELUDE) this.bell(when + beat * PRELUDE_BEAT_S, PRELUDE_HZ * 2 ** (semi / 12), 0.3, 2.2, true);
    const first = when + (PRELUDE[PRELUDE.length - 1][1] + 3) * PRELUDE_BEAT_S;
    for (let q = 0; q < count; q++) this.bell(first + q * STRIKE_GAP_S, BELL_HOUR_HZ, 1, 6);
  }
}
