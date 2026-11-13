// Time-of-day look: light, sky, haze and grade values from the sun state (scene.js sunAt).
// Pure numbers and hex colours (no three.js), tested in test/render-look.test.mjs.
//
// Four keys blended continuously:
//   day      white-warm sun, soft blue sky light, crisp and vivid
//   golden   low sun (low -> 1): orange sun, warm horizon, stronger sun scattering in the haze
//   blue     twilight (night ~ 0.5): the sun is gone and the moon not yet up, so direct light
//            dips to almost nothing (this also hides the switch from sun to moon direction); deep
//            blue sky over a pink-orange horizon, windows starting to glow
//   night    cool moonlight with readable shadows, dark blue sky, warm windows and lamps

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const mixRgb = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

const C = Object.fromEntries(Object.entries({
  sunNoon: '#fff1dc', sunGold: '#ffa65a', moon: '#a8bde8',
  dayTop: '#2f6fd0', dayHor: '#cfe0ef', goldTop: '#4a6fae', goldHor: '#ffc08a',
  blueTop: '#1d3470', blueHor: '#c9909a', nightTop: '#070d24', nightHor: '#222f58',
  hemiDay: '#cfe2f7', hemiGold: '#f2d2b0', hemiBlue: '#5d75b8', hemiNight: '#5068a8',
  groundDay: '#6b5a48', groundNight: '#1c1a24',
}).map(([k, v]) => [k, hexToRgb(v)]));

/** Weight of the blue-hour key for a night factor (peaks at 0.5). */
export const blueWeight = (n) => Math.max(0, 1 - Math.abs(n - 0.5) * 2.2);

/**
 * Look for a sun state { night: 0..1, low: 0..1 }. Colours are [r, g, b] in 0..1 (sRGB).
 * Returns sun (colour, intensity), hemi (sky, ground, intensity), sky (top, horizon), env
 * intensity, exposure, haze (scatter strength) and grade (saturation, contrast, vignette,
 * lift, gain for render/grade.js).
 */
export function lookAt({ night: n, low }) {
  const b = blueWeight(n);
  // direct light: sun -> dips through the blue hour -> moon
  const sunI = n < 0.5 ? lerp(lerp(3.1, 2.5, low), 0.12, smooth(n, 0, 0.5)) : lerp(0.12, 0.95, smooth(n, 0.5, 1));
  // the colour reaches the moon's before the direction switches (no pop at the switch)
  const sunColor = mixRgb(mixRgb(C.sunNoon, C.sunGold, low), C.moon, smooth(n, 0.25, 0.5));
  let top = mixRgb(C.dayTop, C.goldTop, low), hor = mixRgb(C.dayHor, C.goldHor, low * 0.8);
  top = mixRgb(mixRgb(top, C.blueTop, Math.min(1, n * 2)), C.nightTop, smooth(n, 0.5, 1));
  hor = mixRgb(mixRgb(hor, C.blueHor, Math.min(1, n * 2)), C.nightHor, smooth(n, 0.45, 1));
  let hemiSky = mixRgb(C.hemiDay, C.hemiGold, low * 0.6);
  hemiSky = mixRgb(mixRgb(hemiSky, C.hemiBlue, Math.min(1, n * 2)), C.hemiNight, smooth(n, 0.5, 1));
  return {
    sunColor, sunIntensity: sunI,
    hemiSky, hemiGround: mixRgb(C.groundDay, C.groundNight, n), hemiIntensity: lerp(lerp(0.6, 0.5, low), 0.5, n) + b * 0.4,
    top, horizon: hor,
    envIntensity: lerp(0.75, 0.3, n),
    exposure: lerp(1.0, 1.9, n) + b * 0.3,
    haze: (1 - smooth(n, 0, 0.5)) * lerp(0.35, 1.1, low), // sun scattering in the fog, strongest at golden hour, gone before the moon takes over
    grade: {
      saturation: lerp(1.08, 1.0, n) + low * 0.04 * (1 - n),
      contrast: lerp(1.08, 1.04, n),
      vignette: lerp(0.16, 0.22, n),
      // shadows cool, highlights warm; at night shadows go bluer, lamps stay warm
      lift: mixRgb([0.975, 0.99, 1.03], [0.96, 0.98, 1.05], n),
      gain: mixRgb([1.03, 1.0, 0.965], [1.05, 1.0, 0.92], Math.max(low * (1 - n), n * 0.6)),
    },
  };
}
