// Figures in the comic look (test flag #look=verse): still toy figures, but each part made of
// its own stuff, like the film's characters. Patterns are in the part's own space (they move
// with the limb), in metres (a figure is ~1.8 m):
//   skin   matte, warm light bleeding at the edges (soft, not plastic gloss)
//   hair   strands: fine streaks down the hair, a soft sheen band
//   top    cloth: soft fold shading, seams at the sides, a hem and cuff band; fabric sheen
//   legs   trousers: a front crease, side seams, worn lighter at the knees, a twill grain
//   shoe   a sole band at the bottom, matte upper
// Accessories keep the toy material.
import { lookFromHash } from './verse.js';
import { POOL_GLSL, poolUniforms } from './pools.js';

export const FIGURE_LOOK = typeof location !== 'undefined' && lookFromHash(location.hash) === 'verse';

/** Material kind of a figure part key ('head', 'hair:short', 'top:shirt', 'lo:thigh', ...). */
export function figureKindOf(key) {
  const k = key.replace(/^lo:/, '');
  if (k === 'head' || k === 'hand') return 'skin';
  if (k.startsWith('hair:')) return 'hair';
  if (k.startsWith('top:') || k === 'upperArm' || k === 'foreArm') return 'top';
  if (k === 'hips' || k === 'thigh' || k === 'shin') return 'legs';
  if (k === 'shoe') return 'shoe';
  return null;
}

const COMMON = `
  varying vec3 vFigP; varying vec3 vFigN;
  float fHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float fNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(fHash(i), fHash(i + vec3(1, 0, 0)), f.x), mix(fHash(i + vec3(0, 1, 0)), fHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(fHash(i + vec3(0, 0, 1)), fHash(i + vec3(1, 0, 1)), f.x), mix(fHash(i + vec3(0, 1, 1)), fHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fLine(float x, float w) { float a = fwidth(x) + 1e-5; return 1.0 - smoothstep(w - a, w + a, abs(x)); }`;

const KIND = {
  skin: { params: { clearcoat: 0.05, roughness: 0.62, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0xff9a7a },
    glsl: 'c *= 1.0 + (fNoise(p * 60.0) - 0.5) * 0.04;' },
  hair: { params: { clearcoat: 0.0, roughness: 0.5, sheen: 0.6, sheenRoughness: 0.35, sheenColor: 0xffffff },
    glsl: `float a = atan(p.x, p.z);
      float strand = fNoise(vec3(a * 22.0, p.y * 6.0, 0.0)) * 0.6 + fNoise(vec3(a * 61.0, p.y * 14.0, 3.0)) * 0.4;
      float fade = 1.0 - smoothstep(0.4, 1.0, fwidth(a * 22.0));
      c *= 1.0 + (strand - 0.5) * 0.55 * fade;` },
  top: { params: { clearcoat: 0.0, roughness: 0.85, sheen: 0.5, sheenRoughness: 0.75, sheenColor: 0xffffff },
    glsl: `float fold = fNoise(vec3(p.x * 9.0, p.y * 3.5, p.z * 9.0));
      float seam = fLine(p.x - sign(p.x) * 0.16, 0.004) * step(0.1, abs(p.x));
      float hem = fLine(p.y - 0.018, 0.006) + fLine(p.y + 0.215, 0.005);
      float weave = (fHash(floor(p * 420.0)) - 0.5) * (1.0 - smoothstep(0.3, 0.8, fwidth(p.y * 420.0)));
      c *= 1.0 + (fold - 0.5) * 0.28 - (seam + hem) * 0.22 + weave * 0.06;` },
  legs: { params: { clearcoat: 0.0, roughness: 0.82, sheen: 0.3, sheenRoughness: 0.8, sheenColor: 0xffffff },
    glsl: `float crease = fLine(p.x, 0.0035) * step(0.0, p.z) * step(p.y, -0.02);
      float seam = fLine(abs(p.x) - 0.062, 0.004) * step(p.y, -0.02);
      float knee = exp(-pow((p.y + 0.43) / 0.07, 2.0)) * step(0.0, p.z);
      float twill = fract((p.y + p.x) * 260.0);
      float tf = 1.0 - smoothstep(0.3, 0.8, fwidth((p.y + p.x) * 260.0));
      c *= 1.0 - crease * 0.18 - seam * 0.2 + knee * 0.12 + (smoothstep(0.4, 0.6, twill) - 0.5) * 0.08 * tf + (fNoise(p * 25.0) - 0.5) * 0.12;` },
  shoe: { params: { clearcoat: 0.15, roughness: 0.55 },
    glsl: `float sole = 1.0 - smoothstep(-0.066, -0.062, p.y);
      c = mix(c, vec3(0.75, 0.73, 0.7) * max(0.25, dot(c, vec3(0.33)) * 1.6), sole * 0.75);
      c *= 1.0 - fLine(p.y + 0.062, 0.003) * 0.4;` },
};

/** A clone of the figure material for a part kind (see KIND), or the material itself. */
export function figureMaterialFor(base, kind) {
  const spec = KIND[kind];
  if (!spec) return base;
  const m = base.clone();
  for (const [k, v] of Object.entries(spec.params)) {
    if (k === 'sheenColor') m.sheenColor.set(v); else m[k] = v;
  }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, poolUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFigP; varying vec3 vFigN; varying vec3 vFigW; varying vec3 vFigWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFigP = position; vFigN = normal;
        vec4 figW = vec4(transformed, 1.0); vec3 figWN = objectNormal;
        #ifdef USE_INSTANCING
          figW = instanceMatrix * figW; figWN = mat3(instanceMatrix) * figWN;
        #endif
        vFigW = (modelMatrix * figW).xyz; vFigWN = normalize(mat3(modelMatrix) * figWN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\nvarying vec3 vFigW; varying vec3 vFigWN;\n${POOL_GLSL}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += diffuseColor.rgb * poolLight(vFigW, normalize(vFigWN));')
      .replace('#include <color_fragment>', `#include <color_fragment>
        { vec3 c = diffuseColor.rgb; vec3 p = vFigP; ${spec.glsl} diffuseColor.rgb = max(c, 0.0); }`);
  };
  m.customProgramCacheKey = () => `figure:${kind}`;
  return m;
}
