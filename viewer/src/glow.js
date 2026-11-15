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

/**
 * Share of rooms with the light on at a clock hour (0..24): evenings most, after midnight few,
 * a morning bump before work. The near glass shader picks which ones (stable per window,
 * changing now and then).
 */
export function litShare(hours) {
  const h = ((hours % 24) + 24) % 24;
  const keys = [[0, 0.32], [1, 0.16], [3, 0.06], [5.5, 0.08], [6.5, 0.32], [8, 0.2], [10, 0.1], [16, 0.12], [18, 0.5], [20, 0.68], [22.5, 0.58], [24, 0.32]];
  for (let q = 1; q < keys.length; q++) {
    const [h1, v1] = keys[q], [h0, v0] = keys[q - 1];
    if (h <= h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
  }
  return keys[0][1];
}
const WARM_A = new THREE.Color('#ff9a3c'), WARM_B = new THREE.Color('#ffe1ae');
const TV_BLUE = new THREE.Color('#7da6ff');
const COOL = new THREE.Color('#e4ecff'), TEAL = new THREE.Color('#7fe3d6'), PINK = new THREE.Color('#ff9ccf');

/** Glow colour for one window keyed by (feature, I, J, K). Black when unlit. */
export function windowColor(feature, I, J, K, out = new THREE.Color(), all = false) {
  const h = (salt) => hash3(I + salt * 7919, J ^ (feature * 2654435761), K + salt * 104729);
  if (!all && h(0) >= LIT_SHARE) return out.setRGB(0, 0, 0);
  const kind = h(1);
  if (kind < 0.08) return out.copy(TV_BLUE).multiplyScalar(0.35 + h(2) * 0.35);
  // the colours a real street has at night: cool LED white, a teal kitchen, a pink bedroom lamp
  if (kind < 0.2) return out.copy(COOL).multiplyScalar(0.5 + h(2) * 0.6);
  if (kind < 0.25) return out.copy(TEAL).multiplyScalar(0.45 + h(2) * 0.4);
  if (kind < 0.29) return out.copy(PINK).multiplyScalar(0.45 + h(2) * 0.4);
  return out.copy(WARM_A).lerp(WARM_B, h(3)).multiplyScalar(0.45 + h(2) * 0.85);
}

/** Map brick number -> glow colour for every glass brick and window/door piece. */
/**
 * all: every window gets its room colour and the near glass shader decides which are lit now
 * (materials.js windowGlass: by the hour, switching now and then); the far look keeps the fixed
 * LIT_SHARE cut (baked).
 */
export function windowGlow(world, isGlass, { all = false } = {}) {
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
    if (!byRoot.has(r)) byRoot.set(r, windowColor(world.feature[r], world.I[r], world.J[r], world.K[r], new THREE.Color(), all));
    out.set(n, byRoot.get(r));
  }
  return out;
}
