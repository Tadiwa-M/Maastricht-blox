// The sound mix as numbers: where the ear is, how loud and from which side each layer is (traffic,
// crowd, birds, bells, rain), by distance, time of day and weather. Pure (no Web Audio), so it is
// tested with node --test (test/audio.test.mjs); synth.js turns the numbers into sound.
//
// Coordinates are Unity metres (x east, z north; three.js z = -north). Loudness is an amplitude
// 0..1. Many sources add up as intensities (amplitudes squared), then soften (1 - e^-x), so a
// busy street is louder than one car but never clips.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Amplitude falloff with distance d (m): 1 at the source, 1/2 at ref metres. */
export const att = (d, ref) => ref / (ref + Math.max(0, d));

/**
 * The ear from the camera: pos [x, y, z] three.js, right [x, y, z] the camera's right vector
 * (three.js), groundY the street height under it (three.js y). An override position (the walking
 * player) puts the ear on the street there. -> { x, z (Unity), h (m above the street), rx, rz }.
 */
export function earFrom(pos, right, groundY = 0, at = null) {
  const rl = Math.hypot(right[0], right[2]) || 1;
  const base = { rx: right[0] / rl, rz: -right[2] / rl };
  if (at) return { x: at[0], z: -at[2], h: 1.6, ...base };
  return { x: pos[0], z: -pos[2], h: Math.max(1.6, pos[1] - groundY), ...base };
}

/** Distance (3D, the source on the street) and stereo pan (-1 left .. 1 right) of a point. */
export function placeOf(ear, x, z) {
  const dx = x - ear.x, dz = z - ear.z, flat = Math.hypot(dx, dz);
  const d = Math.hypot(flat, ear.h);
  const pan = flat > 1e-6 ? clamp(((dx * ear.rx + dz * ear.rz) / d) * 0.85, -0.85, 0.85) : 0;
  return { d, pan };
}

/**
 * Many sources -> one layer: items [{ x, z, ... }], loud(item) amplitude at the source, ref the
 * falloff distance. -> { level 0..1, pan (intensity-weighted), near (the loudest one's amplitude) }.
 */
export function busyLevel(ear, items, loud, ref) {
  let I = 0, P = 0, near = 0;
  for (const it of items) {
    const a = loud(it);
    if (!(a > 0)) continue;
    const { d, pan } = placeOf(ear, it.x, it.z);
    const amp = a * att(d, ref), i = amp * amp;
    I += i; P += i * pan;
    if (amp > near) near = amp;
  }
  return { level: 1 - Math.exp(-Math.sqrt(I) * 1.2), pan: I > 0 ? P / I : 0, near };
}

/** Two layers' amplitudes combined (as intensities). */
export const addLevels = (a, b) => Math.sqrt(a * a + b * b);

/** Street detail fades as the camera rises: 1 at street level, ~0.15 at 300 m. */
export const heightFade = (h) => att(Math.max(0, h - 3), 50);

/** Piecewise-linear curve over hours [[h, v], ...] (sorted, 0..24). */
export function curveAt(table, hours) {
  const h = ((hours % 24) + 24) % 24;
  for (let q = 1; q < table.length; q++) {
    const [h1, v1] = table[q];
    if (h <= h1) { const [h0, v0] = table[q - 1]; return v0 + (v1 - v0) * ((h - h0) / (h1 - h0 || 1)); }
  }
  return table[table.length - 1][1];
}

/** Birdsong by hour: the dawn chorus, a quieter day, a little dusk song, silent nights. */
export const BIRDS = [[0, 0], [4.5, 0], [5.5, 0.8], [6.5, 1], [8, 0.7], [10, 0.4], [17, 0.4], [19.5, 0.55], [21, 0.15], [22, 0], [24, 0]];
export const birdCurve = (hours) => curveAt(BIRDS, hours);

/** How green it is at (x, z): the strongest park around, fading over its edge. */
export function greenAt(x, z, parks = []) {
  let g = 0;
  for (const p of parks) {
    const d = Math.hypot(x - p.x, z - p.z);
    const edge = Math.max(30, p.r * 0.35);
    g = Math.max(g, p.g * clamp((p.r + edge - d) / (2 * edge)));
  }
  return g;
}

/**
 * Bird calls per second: the hour, how green it is, rain (none), height and the street's own
 * noise (birds are drowned out next to a busy road).
 */
export function birdRate({ hours, green = 0, rain = 0, h = 1.6, traffic = 0 }) {
  return birdCurve(hours) * (0.12 + 1.4 * green) * (1 - clamp(rain)) * heightFade(h) * (1 - 0.6 * clamp(traffic));
}

/**
 * Footstep sounds by surface: filter (type, Hz, Q), length (s) and loudness. Cobbles click,
 * smooth paving taps, gravel crunches, grass thuds softly.
 */
export const SURFACES = {
  cobble: { type: 'bandpass', f: 1700, q: 1.1, len: 0.07, vol: 1, heel: 0.5 },
  stone: { type: 'bandpass', f: 1200, q: 0.9, len: 0.06, vol: 0.85, heel: 0.4 },
  gravel: { type: 'highpass', f: 2200, q: 0.7, len: 0.14, vol: 0.75, heel: 0.2 },
  grass: { type: 'lowpass', f: 700, q: 0.7, len: 0.1, vol: 0.5, heel: 0.15 },
};

/** Surface under the feet: gravel paths in the parks, cobbles in the old town, paving elsewhere. */
export function surfaceAt(x, z, places) {
  if (greenAt(x, z, places?.parks) > 0.6) return 'gravel';
  const o = places?.oldTown;
  if (!o || Math.hypot(x - o.x, z - o.z) < o.r) return 'cobble';
  return 'stone';
}

/** Rain 0..1 from a weather source (rain field) or the URL (#rain=0..1). */
export function rainLevel(weather, hash = '') {
  if (Number.isFinite(weather?.rain)) return clamp(weather.rain);
  const v = +(new URLSearchParams(String(hash).replace(/^#/, '')).get('rain') || 0);
  return Number.isFinite(v) ? clamp(v) : 0;
}

/** Bus engine: firing note (Hz), filter cutoff (Hz) and loudness factor by speed (m/s). */
export function engineVoice(v = 0) {
  const s = clamp(Math.abs(v) / 10);
  return { freq: 34 + 26 * s, cut: 260 + 640 * s, loud: 0.55 + 0.45 * s };
}
