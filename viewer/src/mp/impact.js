// How a match's hits FEEL (owner, 2026-11-24: "heavier, more satisfying", the weight a fight needs).
// Pure data plus one small player: the numbers are the spec (plain JSON-able values, no engine
// calls), so the Unity version reads the same table later. Combat only names the event.
//   shake  camera shake in radians, over `len` seconds (the same shake the guns use)
//   voice  layers of synthesised sound (no sample files): noise bursts and falling tones
// A layer is { n: 'noise', f, type, len, gain, at } or { n: 'tone', f0, f1, len, gain, at } (at: seconds after the event).
export const IMPACT = {
  hit: { shake: 0.004, len: 0.12, voice: [ // my shot landed: a bright tick over a short knock
    { n: 'noise', type: 'highpass', f: 3200, len: 0.03, gain: 0.5 },
    { n: 'tone', f0: 1500, f1: 900, len: 0.05, gain: 0.35 },
    { n: 'tone', f0: 190, f1: 90, len: 0.09, gain: 0.5, at: 0.012 }] },
  kill: { shake: 0.014, len: 0.3, voice: [ // a knock-out: the crack, a deep thump, a rising ring
    { n: 'noise', type: 'highpass', f: 2400, len: 0.05, gain: 0.7 },
    { n: 'tone', f0: 150, f1: 38, len: 0.32, gain: 1 },
    { n: 'noise', type: 'lowpass', f: 700, len: 0.2, gain: 0.7, at: 0.01 },
    { n: 'tone', f0: 880, f1: 1320, len: 0.22, gain: 0.25, at: 0.05 }] },
  hurt: { shake: 0.02, len: 0.25, voice: [ // I was hit: a heavy thud, the air going out
    { n: 'tone', f0: 110, f1: 40, len: 0.22, gain: 1 },
    { n: 'noise', type: 'lowpass', f: 520, len: 0.16, gain: 0.8 },
    { n: 'noise', type: 'bandpass', f: 1800, len: 0.08, gain: 0.35, at: 0.02 }] },
  down: { shake: 0.03, len: 0.6, voice: [ // I went down: a long fall in pitch and a settling rumble
    { n: 'tone', f0: 140, f1: 28, len: 0.7, gain: 1 },
    { n: 'noise', type: 'lowpass', f: 380, len: 0.5, gain: 0.8 },
    { n: 'tone', f0: 60, f1: 30, len: 0.5, gain: 0.7, at: 0.25 }] },
};

/** The camera shake for an event: { amp (rad), len (s) }, or null when the event has none. */
export function impactShake(kind) {
  const e = IMPACT[kind];
  return e ? { amp: e.shake, len: e.len } : null;
}

/** Plays IMPACT voices on the Web Audio context (made on first use), at the player's volume; never throws. */
export class ImpactSound {
  constructor(makeContext = () => new (window.AudioContext || window.webkitAudioContext)()) { this.make = makeContext; this.ac = null; }
  play(kind, gain = 1) {
    const e = IMPACT[kind];
    const prefs = globalThis.window?.__bloxAudio?.prefs;
    if (!e || prefs?.muted || prefs?.volume === 0 || gain < 0.02) return false;
    try {
      const ac = (this.ac ||= this.make()), t0 = ac.currentTime;
      const vol = 0.2 * gain * (prefs?.volume ?? 0.35) / 0.35;
      for (const v of e.voice) {
        const at = t0 + (v.at || 0), g = ac.createGain();
        g.gain.setValueAtTime(vol * v.gain, at); g.gain.exponentialRampToValueAtTime(0.001, at + v.len);
        g.connect(ac.destination);
        if (v.n === 'tone') {
          const o = ac.createOscillator();
          o.frequency.setValueAtTime(v.f0, at); o.frequency.exponentialRampToValueAtTime(v.f1, at + v.len);
          o.connect(g); o.start(at); o.stop(at + v.len);
        } else {
          const buf = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * v.len)), ac.sampleRate), d = buf.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
          const n = ac.createBufferSource(), flt = ac.createBiquadFilter();
          n.buffer = buf; flt.type = v.type; flt.frequency.value = v.f;
          n.connect(flt); flt.connect(g); n.start(at);
        }
      }
      return true;
    } catch { return false; /* no audio here */ }
  }
}
