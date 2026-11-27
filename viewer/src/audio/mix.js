// The sound mix as numbers: where the ear is, how loud and from which side each layer is
// (bells, rain, the pad), by distance, time of day and weather. Pure (no Web Audio), so it is
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
 * Footstep sounds by surface, all soft low taps: f the tap's pitch (Hz), len (s), vol, and a hint
 * of texture (low-passed noise below tex Hz, grain = its share). Cobbles tap a little higher,
 * paving lower, gravel has the most texture, grass is the softest.
 */
export const SURFACES = {
  cobble: { f: 185, len: 0.07, vol: 1, tex: 800, grain: 0.3 },
  stone: { f: 160, len: 0.06, vol: 0.9, tex: 650, grain: 0.22 },
  gravel: { f: 150, len: 0.09, vol: 0.8, tex: 1100, grain: 0.5 },
  grass: { f: 125, len: 0.09, vol: 0.6, tex: 450, grain: 0.3 },
};

/** Daylight 0..1 from the hour of the day (0..24): up 6-8, down 19-22; the pad's brightness. */
export function dayLevel(hour) {
  if (!Number.isFinite(hour)) return 1;
  const h = ((hour % 24) + 24) % 24, s = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
  return Math.min(s((h - 6) / 2), s((22 - h) / 3));
}

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
