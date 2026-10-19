// Brick geometry, built once per catalogue type and cached.
//
// bodyParts(type) returns { body, glass? } in the local frame described in src/shapes.js
// (front toward -z). Ordinary bricks/plates/tiles are bevelled boxes with a small seam
// inset; slopes are extruded side profiles with the thin 0.05 m front lip (CONTRACT v2);
// detail pieces come from src/details.js. Glass and water bricks use a seamless box so a
// stack of them reads as one pane / one water surface.
import { INSET, brickBox, seamlessBox, latheRound, extrudeProfile } from './shapes.js';
import { detailGeometry } from './details.js';

export { INSET };
export const STUD_R = 0.15; // 0.6 of the 0.5 m pitch
export const STUD_H = 0.09;
export const LIP_PLATES = 0.25; // slope front lip, in plates

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

/** Side profile (s from back to front, y up) of a slope: studded back rows, then the incline. */
function slopeProfile(t, S, P) {
  const D = t.d * S, H = t.h * P, lip = LIP_PLATES * P;
  const back = (t.studRows ?? 1) * S;
  const pts = [[0, 0], [D, 0], [D, lip], [back, H]];
  if (back > 0) pts.push([0, H]);
  return pts;
}

/** Ridge (slope_double): slopes down toward both the front and the back. */
function ridgeProfile(t, S, P) {
  const D = t.d * S, H = t.h * P, lip = LIP_PLATES * P, e = 0.02;
  return [[0, 0], [D, 0], [D, lip], [D / 2 + e, H], [D / 2 - e, H], [0, lip]];
}

/** { body, glass? } for catalogue type t. seamless: plain box for glass/water bricks. */
export function bodyParts(t, S, P, seamless = false) {
  const plainKind = ['brick', 'plate', 'tile'].includes(t.kind);
  const key = `${t.id}:${seamless && plainKind ? 'seamless' : 'normal'}`;
  return cached(key, () => {
    const W = t.w * S, D = t.d * S, H = t.h * P;
    if (seamless && plainKind) return { body: seamlessBox(W, H, D) };
    const detail = detailGeometry(t, S, P);
    if (detail) return detail;
    switch (t.kind) {
      case 'slope': return { body: extrudeProfile(slopeProfile(t, S, P), W, D) };
      case 'slope_double': return { body: extrudeProfile(ridgeProfile(t, S, P), W, D) };
      case 'round': return { body: latheRound(Math.min(W, D) / 2 - 0.012, H - INSET, 0.02, 24, true) };
      default: return { body: brickBox(W, H, D) };
    }
  });
}

export function studGeometry() {
  return cached('stud', () => latheRound(STUD_R, STUD_H, 0.018, 20, false));
}
