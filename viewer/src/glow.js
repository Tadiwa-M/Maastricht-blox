// Night-time window lighting: which windows are lit, how warm and how bright.
//
// A "window" is either one window/door piece, or a connected group of glass bricks (older
// data builds windows from stacked glass bricks). Groups are found with union-find over
// touching cells. Each window then gets a hash of (feature id, window position):
// about 60 % are lit, with varied warmth and strength, and a few glow TV-blue.
// The result is a colour per brick (already scaled by strength), fed to the glass shader.
import * as THREE from 'three';
import { hash3 } from './hash.js';
import { cellKey } from './world.js';

const LIT_SHARE = 0.6;
const WARM_A = new THREE.Color('#ff9a3c'), WARM_B = new THREE.Color('#ffe1ae');
const TV_BLUE = new THREE.Color('#7da6ff');

/** Glow colour for one window keyed by (feature, I, J, K). Black when unlit. */
export function windowColor(feature, I, J, K, out = new THREE.Color()) {
  const h = (salt) => hash3(I + salt * 7919, J ^ (feature * 2654435761), K + salt * 104729);
  if (h(0) >= LIT_SHARE) return out.setRGB(0, 0, 0);
  if (h(1) < 0.1) return out.copy(TV_BLUE).multiplyScalar(0.35 + h(2) * 0.35);
  return out.copy(WARM_A).lerp(WARM_B, h(3)).multiplyScalar(0.45 + h(2) * 0.85);
}

/** Map brick number -> glow colour for every glass brick and window/door piece. */
export function windowGlow(world, isGlass) {
  const parent = new Map();
  const find = (n) => {
    while (parent.get(n) !== n) { const p = parent.get(parent.get(n)); parent.set(n, p); n = p; }
    return n;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb)); // root = lowest number
  };
  const glassBrick = (n) => n >= 0 && isGlass(n) && !['window', 'door'].includes(world.typeOf(n)?.kind);
  for (let n = 0; n < world.count; n++) {
    const kind = world.typeOf(n)?.kind;
    if (kind === 'window' || kind === 'door' || glassBrick(n)) parent.set(n, n);
  }
  for (const n of parent.keys()) {
    if (!glassBrick(n)) continue;
    const t = world.typeOf(n), [ei, ej] = world.extentOf(n);
    for (let k = 0; k < t.h; k++)
      for (let dj = 0; dj < ej; dj++)
        for (let di = 0; di < ei; di++) {
          const I = world.I[n] + di, J = world.J[n] + dj, K = world.K[n] + k;
          for (const [a, b, c] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
            const m = world.cells.get(cellKey(I + a, J + b, K + c));
            if (m !== undefined && m !== n && glassBrick(m)) union(n, m);
          }
        }
  }
  const out = new Map(), byRoot = new Map();
  for (const n of parent.keys()) {
    const r = find(n);
    if (!byRoot.has(r)) byRoot.set(r, windowColor(world.feature[r], world.I[r], world.J[r], world.K[r]));
    out.set(n, byRoot.get(r));
  }
  return out;
}
