// Figures in the comic look (test flag #look=verse): still toy figures, but each part made of
// its own stuff and finished like a film character (the camera follows the player the whole
// time, so the detail is sized for a figure seen from 2 to 5 m; it fades out where it would be
// under a pixel). Patterns are in the part's own space (they move with the limb), in metres;
// a figure is ~1.8 m tall and faces -z.
//   skin   matte, warm sheen at the edges; brows and a little warmth in the cheeks; knuckles
//   hair   strands: fine streaks down the hair, a soft sheen band
//   top    cloth: fold shading, a zip down the front, collar band, stitched pockets, side seams,
//          a back yoke and centre seam, a neck label, wrinkles at the waist, hem and cuffs; sheen
//   legs   trousers: a belt with a buckle, front and stitched back pockets, a front crease, side seams with light
//          stitching, worn knees, a twill grain
//   shoe   sole band with a welt line, laces, a toe cap
// Accessories keep the toy material.
import { PAINTED_LOOK } from './verse.js';
import { addPartVaryings } from './pools.js';

// every look gets the printed detail; the painted looks also the film materials (matte cloth, skin sheen)
export const FIGURE_LOOK = typeof location !== 'undefined';
const FILM = PAINTED_LOOK;

/** Material kind of a figure part key ('head', 'hair:short', 'top:shirt', 'lo:thigh', ...). */
export function figureKindOf(key) {
  const k = key.replace(/^lo:/, '');
  if (k === 'head') return 'face';
  if (k === 'hand') return 'hand';
  if (k.startsWith('hair:')) return 'hair';
  if (k.startsWith('top:')) return 'top';
  if (k === 'upperArm' || k === 'foreArm') return 'sleeve';
  if (k === 'hips') return 'hips';
  if (k === 'thigh' || k === 'shin') return 'legs';
  if (k === 'shoe') return 'shoe';
  return null;
}

// painted looks: the figures' toy colours pulled a little toward the city's palette (less saturated,
// a touch darker), so people belong to the scene instead of sitting on top of it
const FILM_PALETTE = 'c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 0.8) * 0.94;';

const CLOTH = `float fold = fNoise(vec3(p.x * 9.0, p.y * 3.5, p.z * 9.0));
  float weave = (fHash(floor(p * 420.0)) - 0.5) * (1.0 - smoothstep(0.3, 0.8, fwidth(p.y * 420.0)));
  float k = 1.0 + (fold - 0.5) * 0.26 + weave * 0.06;`;
const TWILL = `float tw = smoothstep(0.4, 0.6, fract((p.y + p.x) * 260.0)) - 0.5;
  float k = 1.0 + tw * 0.08 * (1.0 - smoothstep(0.3, 0.8, fwidth((p.y + p.x) * 260.0))) + (fNoise(p * 25.0) - 0.5) * 0.12;`;
const FRONT = 'float front = step(p.z, 0.0);';

const KIND = {
  face: { params: { clearcoat: 0.05, roughness: 0.6, sheen: 0.1, sheenRoughness: 0.7, sheenColor: 0xffc0a8 }, // (more sheen glowed in low sun)
    glsl: `${FRONT}
      float brow = 0.0;
      for (int s = -1; s <= 1; s += 2) { vec2 d = vec2(p.x - float(s) * 0.047, p.y - 0.226 + pow(p.x - float(s) * 0.047, 2.0) * 6.0); brow += (1.0 - smoothstep(0.9, 1.1, length(d / vec2(0.024, 0.0055)))); }
      float cheek = exp(-pow(length(vec2(abs(p.x) - 0.062, p.y - 0.155)) / 0.022, 2.0));
      c = mix(c, c * vec3(1.08, 0.86, 0.82), cheek * 0.5 * front);
      c = mix(c, c * 0.32, clamp(brow, 0.0, 1.0) * front * step(0.98, vLocC.r));
      c *= 1.0 + (fNoise(p * 60.0) - 0.5) * 0.04;` },
  hand: { params: { clearcoat: 0.05, roughness: 0.6, sheen: 0.1, sheenRoughness: 0.7, sheenColor: 0xffc0a8 },
    glsl: 'c *= 1.0 - (fLine(p.y + 0.045, 0.002) + fLine(p.y + 0.075, 0.002)) * 0.12;' },
  hair: { params: { clearcoat: 0.0, roughness: 0.55, sheen: 0.25, sheenRoughness: 0.45, sheenColor: 0xffffff },
    glsl: `float a = atan(p.x, p.z);
      float strand = fNoise(vec3(a * 22.0, p.y * 6.0, 0.0)) * 0.6 + fNoise(vec3(a * 61.0, p.y * 14.0, 3.0)) * 0.4;
      c *= 1.0 + (strand - 0.5) * 0.55 * (1.0 - smoothstep(0.4, 1.0, fwidth(a * 22.0)));` },
  top: { params: { clearcoat: 0.0, roughness: 0.85, sheen: 0.12, sheenRoughness: 0.85, sheenColor: 0xffffff },
    glsl: `${CLOTH} ${FRONT}
      float zip = fLine(p.x, 0.004) * front * step(0.04, p.y);
      float teeth = zip * step(0.5, fract(p.y * 220.0));
      float collar = smoothstep(0.52, 0.525, p.y);
      float pockets = (fBox(vec2(abs(p.x), p.y), vec2(0.055, 0.07), vec2(0.13, 0.16), 0.0025)) * front;
      float seams = fLine(abs(p.x) - 0.16, 0.003) * step(0.1, abs(p.x));
      float hem = fLine(p.y - 0.018, 0.006);
      float back = 1.0 - front; // what the follow camera sees most: a yoke seam, a centre seam, wrinkles at the waist
      float yoke = fLine(p.y - 0.455 + abs(p.x) * 0.12, 0.003) * back;
      float spine = fLine(p.x, 0.0025) * back * step(p.y, 0.45) * 0.6;
      float wrinkle = smoothstep(0.55, 0.8, fNoise(vec3(p.x * 18.0, p.y * 70.0, 0.0))) * (1.0 - smoothstep(0.05, 0.2, p.y));
      float label = back * step(abs(p.x), 0.025) * step(0.495, p.y) * step(p.y, 0.515);
      k -= zip * 0.25 - teeth * 0.15 + collar * 0.12 + pockets * 0.28 + seams * 0.2 + hem * 0.22 + yoke * 0.24 + spine * 0.15 + wrinkle * 0.14 - label * 0.35;
      c *= k;` },
  sleeve: { params: { clearcoat: 0.0, roughness: 0.85, sheen: 0.12, sheenRoughness: 0.85, sheenColor: 0xffffff },
    glsl: `${CLOTH}
      float cuff = smoothstep(-0.2, -0.205, p.y) * step(p.y, -0.15);
      float rib = cuff * step(0.5, fract(atan(p.x, p.z) * 9.0));
      k -= cuff * 0.06 + rib * 0.08;
      c *= k;` },
  hips: { params: { clearcoat: 0.0, roughness: 0.82, sheen: 0.1, sheenRoughness: 0.85, sheenColor: 0xffffff },
    glsl: `${TWILL} ${FRONT}
      float belt = step(-0.03, p.y) * step(p.y, 0.012);
      float buckle = belt * front * step(abs(p.x), 0.024);
      float pocket = fLine(length(vec2(abs(p.x) - 0.16, p.y + 0.01)) - 0.075, 0.003) * front * step(p.y, -0.03);
      float stitch = fLine(abs(p.x) - 0.16, 0.002) * step(0.5, fract(p.y * 90.0));
      vec2 bp = vec2(abs(p.x), p.y); // back pockets, stitched, with a yoke seam above
      float bpo = fBox(bp, vec2(0.04, -0.125), vec2(0.13, -0.04), 0.0025) * (1.0 - front);
      float bps = fBox(bp, vec2(0.047, -0.118), vec2(0.123, -0.047), 0.0013) * (1.0 - front) * step(0.5, fract((bp.x + bp.y) * 120.0));
      float byoke = fLine(p.y + 0.035 + abs(p.x) * 0.1, 0.0025) * (1.0 - front);
      stitch = max(stitch, bps);
      c *= k * (1.0 - pocket * 0.3 - bpo * 0.3 - byoke * 0.22);
      c = mix(c, vec3(0.05, 0.035, 0.03), belt * (1.0 - buckle));
      c = mix(c, vec3(0.72, 0.68, 0.6), buckle * (1.0 - fLine(abs(p.x) - 0.016, 0.003) * 0.5));
      c = mix(c, vec3(0.8, 0.62, 0.3), stitch * 0.5 * (1.0 - belt));` },
  legs: { params: { clearcoat: 0.0, roughness: 0.82, sheen: 0.1, sheenRoughness: 0.85, sheenColor: 0xffffff },
    glsl: `${TWILL} ${FRONT}
      float crease = fLine(p.x, 0.0035) * front * step(p.y, -0.02);
      float seam = fLine(abs(p.x) - 0.062, 0.004) * step(p.y, -0.02);
      float stitch = fLine(abs(p.x) - 0.055, 0.0018) * step(0.5, fract(p.y * 90.0)) * step(p.y, -0.02);
      float knee = exp(-pow((p.y + 0.43) / 0.07, 2.0)) * front;
      c *= k * (1.0 - crease * 0.18 - seam * 0.2 + knee * 0.12);
      c = mix(c, vec3(0.8, 0.62, 0.3), stitch * 0.45);` },
  shoe: { params: { clearcoat: 0.15, roughness: 0.55 },
    glsl: `${FRONT}
      float sole = 1.0 - smoothstep(-0.066, -0.062, p.y);
      c = mix(c, vec3(0.75, 0.73, 0.7) * max(0.25, dot(c, vec3(0.33)) * 1.6), sole * 0.75);
      c *= 1.0 - fLine(p.y + 0.062, 0.003) * 0.4 - fLine(p.y + 0.052, 0.0015) * 0.25;
      float laceZone = step(-0.045, p.y) * step(p.z, -0.01) * step(-0.09, p.z) * step(abs(p.x), 0.025);
      float laces = laceZone * fLine(fract(p.z * 55.0) - 0.5, 0.12);
      float toe = fLine(length(vec2(p.x * 1.4, p.z + 0.1)) - 0.045, 0.002) * step(p.z, -0.08);
      c = mix(c, vec3(0.85, 0.83, 0.8) * max(0.3, dot(c, vec3(0.33)) * 2.0), laces * 0.8);
      c *= 1.0 - toe * 0.3;` },
};

/** A clone of the figure material for a part kind (see KIND), or the material itself. */
export function figureMaterialFor(base, kind) {
  const spec = KIND[kind];
  if (!spec) return base;
  const m = base.clone();
  for (const [k, v] of Object.entries(FILM ? spec.params : {})) {
    if (k === 'sheenColor') m.sheenColor.set(v); else m[k] = v;
  }
  m.onBeforeCompile = (sh) => {
    addPartVaryings(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec3 c = diffuseColor.rgb; vec3 p = vLocP; ${spec.glsl} ${FILM ? FILM_PALETTE : ''} diffuseColor.rgb = max(c, 0.0); }`);
  };
  m.customProgramCacheKey = () => `figure:${kind}:${FILM ? 'film' : 'toy'}`;
  return m;
}
