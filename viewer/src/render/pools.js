// Pools of light at night for the comic look (test flag #look=verse): the nearest street lamps and
// shop windows become real (shadowless) point lights that every painted surface and figure
// evaluates in its shader, so a lamp lights the paving, the wall behind and the people under it in
// their own colours (the additive pool discs of render/lamps.js only add a flat glow). Shop windows
// spill warm light onto the pavement, a few in neon colours. Sources register themselves
// (poolSources); PoolLights picks the nearest POOL.cap to the camera.
import * as THREE from 'three';
import { frontDir } from '../rotation.js';

export const POOL = { cap: 48, lampR: 10, lampI: 3.0, shopR: 6.5, shopI: 1.3, from: 0.12, full: 0.45 };
export const SHOP_TYPES = ['shop_window_1x2x4', 'window_1x2x3'];
const WARM = [1.0, 0.7, 0.4], SHOP = [[1.0, 0.78, 0.5], [1.0, 0.86, 0.66], [1.0, 0.3, 0.62], [0.25, 0.9, 0.95], [0.85, 0.9, 1.0]];

export const poolUniforms = {
  uPoolN: { value: 0 },
  uPoolP: { value: Array.from({ length: POOL.cap }, () => new THREE.Vector4()) },
  uPoolC: { value: Array.from({ length: POOL.cap }, () => new THREE.Vector3()) },
};
/** Registered sources: objects with lights() -> [{ p: [x, y, z], r, c: [r, g, b] }] (three.js world). */
export const poolSources = new Set();

const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

/** Light spots in front of the shop windows in raw records (same frame rules as lampsFromRecords). */
export function shopLightsFromRecords(records, I0, J0, types, studM = 0.5, plateM = 0.2) {
  const out = [];
  if (!types?.length) return out;
  const byId = new Map(types.map((t) => [t.id, t]));
  for (let q = 0; q < records.type.length; q++) {
    const t = byId.get(records.type[q]);
    if (!t) continue;
    const rot = records.rotFlags[q] & 3, odd = rot % 2 === 1;
    const ei = odd ? t.d : t.w, ej = odd ? t.w : t.d;
    const [di, dj] = frontDir(rot);
    const I = I0 + records.i[q] + ei / 2 + di * (ei / 2 + 3), J = J0 + records.j[q] + ej / 2 + dj * (ej / 2 + 3);
    const x = I * studM, z = -J * studM, y = records.k[q] * plateM + 0.9;
    const h = hash(x, z);
    out.push({ p: [x, y, z], r: POOL.shopR, c: SHOP[h < 0.6 ? 0 : h < 0.78 ? 1 : h < 0.86 ? 2 : h < 0.94 ? 3 : 4].map((v) => v * POOL.shopI) });
  }
  return out;
}

export const lampPool = (head) => ({ p: head, r: POOL.lampR, c: WARM.map((v) => v * POOL.lampI) });

/** Per frame: the nearest lights to the camera into the shared uniforms, scaled by the night. */
export class PoolLights {
  constructor() { this.lastEye = null; this.picked = []; this.cap = POOL.cap; }

  update(camera, night) {
    const k = Math.max(0, Math.min(1, (night - POOL.from) / (POOL.full - POOL.from)));
    if (k <= 0) { poolUniforms.uPoolN.value = 0; return; }
    const eye = camera.position;
    if (!this.lastEye || this.lastEye.distanceToSquared(eye) > 16 || this.frames++ > 60) {
      this.lastEye = eye.clone(); this.frames = 0;
      const all = [];
      for (const s of poolSources) for (const l of s.lights()) all.push(l);
      const d2 = (l) => (l.p[0] - eye.x) ** 2 + (l.p[1] - eye.y) ** 2 + (l.p[2] - eye.z) ** 2;
      for (const l of all) l.d2 = d2(l);
      all.sort((a, b) => a.d2 - b.d2);
      this.picked = all.slice(0, Math.min(POOL.cap, this.cap));
    }
    const P = poolUniforms.uPoolP.value, C = poolUniforms.uPoolC.value;
    this.picked.forEach((l, i) => { P[i].set(l.p[0], l.p[1], l.p[2], l.r); C[i].set(l.c[0] * k, l.c[1] * k, l.c[2] * k); });
    poolUniforms.uPoolN.value = this.picked.length;
  }
}

/** GLSL for a material with world position wp and world normal wn varyings: adds the pools. */
export const POOL_GLSL = `
  uniform int uPoolN; uniform vec4 uPoolP[${POOL.cap}]; uniform vec3 uPoolC[${POOL.cap}];
  vec3 poolLight(vec3 wp, vec3 wn) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${POOL.cap}; i++) {
      if (i >= uPoolN) break;
      vec4 L = uPoolP[i];
      vec3 d = L.xyz - wp; float dist = length(d);
      // a street light's fall-off: strong under the lamp, a soft edge, never a flat bright disc
      float att = clamp(1.0 - dist / L.w, 0.0, 1.0); att *= att / (1.0 + dist * dist * 0.06);
      if (att <= 0.0) continue;
      sum += uPoolC[i] * att * clamp(dot(wn, d / max(dist, 1e-3)) * 0.8 + 0.2, 0.0, 1.0);
    }
    return sum;
  }`;

/**
 * Shader plumbing shared by part materials (figures, vehicles): local position/normal and the
 * vertex colour (vLocP, vLocN, vLocC), world position/normal (vWP, vWN), and the pools added to
 * the direct diffuse light. Call from onBeforeCompile; `fragCommon` goes after <common>.
 */
export function addPartVaryings(sh, fragCommon = '') {
  Object.assign(sh.uniforms, poolUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLocP; varying vec3 vLocN; varying vec3 vLocC; varying vec3 vWP; varying vec3 vWN;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vLocP = position; vLocN = normal;
      #ifdef USE_COLOR
        vLocC = color.rgb;
      #else
        vLocC = vec3(1.0);
      #endif
      vec4 locW = vec4(transformed, 1.0); vec3 locWN = objectNormal;
      #ifdef USE_INSTANCING
        locW = instanceMatrix * locW; locWN = mat3(instanceMatrix) * locWN;
      #endif
      vWP = (modelMatrix * locW).xyz; vWN = normalize(mat3(modelMatrix) * locWN);`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vLocP; varying vec3 vLocN; varying vec3 vLocC; varying vec3 vWP; varying vec3 vWN;
      float fHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float fNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(fHash(i), fHash(i + vec3(1, 0, 0)), f.x), mix(fHash(i + vec3(0, 1, 0)), fHash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(fHash(i + vec3(0, 0, 1)), fHash(i + vec3(1, 0, 1)), f.x), mix(fHash(i + vec3(0, 1, 1)), fHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float fLine(float x, float w) { float a = fwidth(x) + 1e-5; return 1.0 - smoothstep(w - a, w + a, abs(x)); }
      float fBox(vec2 p, vec2 lo, vec2 hi, float w) { // outline of a rectangle (stitched pocket)
        float inX = step(lo.x - w, p.x) * step(p.x, hi.x + w), inY = step(lo.y - w, p.y) * step(p.y, hi.y + w);
        return max(fLine(p.x - lo.x, w) + fLine(p.x - hi.x, w), 0.0) * inY + max(fLine(p.y - lo.y, w) + fLine(p.y - hi.y, w), 0.0) * inX;
      }
      ${POOL_GLSL}
      ${fragCommon}`)
    .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += diffuseColor.rgb * poolLight(vWP, normalize(vWN));');
}
