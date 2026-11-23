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
import { PAINTED_LOOK, LOOK } from './verse.js';
import { setProportions } from '../figure/rig.js';
import { addPartVaryings } from './pools.js';

// every look gets the printed detail; the painted looks also the film materials (matte cloth, skin sheen)
export const FIGURE_LOOK = typeof location !== 'undefined';
// the manga look: the heroic build of that world (figure/rig.js PROPORTION)
if (LOOK === 'verse') setProportions({ shoulder: 1.06, chest: 1.0, waist: 0.9, leg: 1.16, head: 0.98, arm: 1.1, swag: true }); // lanky, swaggering
if (LOOK === 'manga') setProportions({ shoulder: 1.12, chest: 1.06, waist: 0.92, leg: 1.17, head: 0.9, arm: 1.05, pose: true, spine: true }); // (the anime figure carries most of the build itself)
const FILM = PAINTED_LOOK;

/**
 * The manga look's organic silhouette (owner: less stiff, like the mockup): each limb and the
 * torso reshaped once, in the part's own space: upper arms and thighs swell into a muscle and
 * taper to the joint below, the shin into a calf, the torso a V from a broad chest to a narrow
 * waist, hair fuller. Changes the geometry itself (a copy per part), so the ink outline follows.
 */
const PROFILE = {
  upperArm: (y) => 1 + 0.22 * Math.exp(-(((y + 0.09) / 0.09) ** 2)) - 0.14 * smooth(-0.15, -0.28, y),
  foreArm: (y) => 1 + 0.12 * Math.exp(-(((y + 0.05) / 0.07) ** 2)) - 0.2 * smooth(-0.12, -0.25, y),
  thigh: (y) => 1 + 0.16 * Math.exp(-(((y + 0.1) / 0.12) ** 2)) - 0.2 * smooth(-0.25, -0.45, y),
  shin: (y) => 1 + 0.16 * Math.exp(-(((y + 0.09) / 0.08) ** 2)) - 0.22 * smooth(-0.2, -0.41, y),
  top: (y) => 0.84 + 0.3 * smooth(0.05, 0.42, y) - 0.06 * smooth(0.48, 0.57, y),
  hips: () => 0.94,
};
function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
const shaped = new Map();
export function mangaShape(key, geo) {
  if (LOOK !== 'manga' || !geo || !key.startsWith('lo:')) return geo; // (the near parts are the anime figure, already shaped: only the far blocks get the profile)
  const k = key.replace(/^lo:/, ''), base = k.startsWith('top:') ? 'top' : k.startsWith('hair:') ? 'hair' : k;
  const f = PROFILE[base];
  if (!f && base !== 'hair') return geo;
  if (shaped.has(key)) return shaped.get(key);
  const g = geo.clone(), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (base === 'hair') { pos.setXYZ(i, pos.getX(i) * 1.12, 0.12 + (y - 0.12) * 1.3, pos.getZ(i) * 1.12); continue; } // fuller, taller hair
    const s = f(y);
    pos.setX(i, pos.getX(i) * s); pos.setZ(i, pos.getZ(i) * (base === 'top' ? 0.6 + 0.4 * s : s));
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  shaped.set(key, g);
  return g;
}

/** Material kind of a figure part key ('head', 'hair:short', 'top:shirt', 'lo:thigh', ...). */
export function figureKindOf(key) {
  const k = key.replace(/^lo:/, '');
  if (k === 'head') return 'face';
  if (k === 'hand') return 'hand';
  if (k.startsWith('hair:')) return 'hair';
  if (k.startsWith('top:') || k.startsWith('belly:')) return 'top';
  if (k === 'upperArm' || k === 'foreArm') return 'sleeve';
  if (k === 'hips') return 'hips';
  if (k === 'thigh' || k === 'shin') return 'legs';
  if (k === 'shoe') return 'shoe';
  return null;
}

// painted looks: the figures' toy colours pulled a little toward the city's palette (less saturated,
// a touch darker), so people belong to the scene instead of sitting on top of it
// the manga look: louder than life (bold, saturated clothes and hair; skin warm)
const MANGA_PALETTE = 'c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.55), 0.0) * 1.04;';
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

// The manga look's fashion (owner: our characters as if from that world): each top and pair of
// trousers gets a bold printed pattern picked from where the figure stands (stripes, zigzags,
// hearts, checks, a solid with a contrast panel), tops a gold chain across the chest and a pin;
// faces heavy brows and a dark ink shadow under them, coloured lips. In the part's own space.
// (the Spider-Verse figure borrows the drawn face: its graphic head needs real eyes, brows and a mouth)
const MANGA_FASHION = {
  top: `
    float pick = fHash(vec3(floor(diffuseColor.r * 9.0), floor(diffuseColor.g * 9.0), floor(diffuseColor.b * 9.0))); // per outfit colour: the same print on a whole top
    float fc = floor(vFash + 0.5), noChain = step(7.5, fc), pc = fc - 8.0 * noChain; // a player's own choice (figure/custom.js PRINTS), 0: auto
    if (pc > 0.5) pick = pc < 1.5 ? -1.0 : pc < 2.5 ? 0.1 : pc < 3.5 ? 0.3 : pc < 4.5 ? 0.5 : pc < 5.5 ? 0.62 : 0.8;
    vec3 ink = c * 0.28, light = mix(c, vec3(1.0), 0.55);
    if (pick < -0.5) { } // plain
    else if (pick < 0.2) c = mix(c, ink, step(0.5, fract(p.y * 18.0)));                                   // bold stripes
    else if (pick < 0.4) c = mix(c, light, step(0.5, fract(p.x * 14.0 + abs(fract(p.y * 7.0) - 0.5) * 2.0))); // zigzag
    else if (pick < 0.55) { vec2 q = fract(vec2(p.x, p.y) * 9.0) - 0.5; q.y -= abs(q.x) * 0.5; c = mix(c, vec3(0.95, 0.2, 0.45), step(length(q), 0.24)); } // hearts
    else if (pick < 0.7) c = mix(c, ink, step(0.0, sin(p.x * 50.0) * sin(p.y * 50.0)));                // checks
    else c = mix(c, vec3(1.0) - c * 0.6, step(0.06, abs(p.x)) * step(abs(p.x), 0.11));               // a contrast panel
    // a gold chain across the chest and a pin
    float chain = fLine(p.y - 0.4 + p.x * 0.6, 0.008) * step(0.0, -p.z) * step(-0.14, p.x) * step(p.x, 0.14);
    chain *= 1.0 - noChain;
    c = mix(c, vec3(1.0, 0.78, 0.2) * (0.8 + 0.4 * step(0.5, fract(p.x * 90.0))), chain);
    float pin = 1.0 - smoothstep(0.012, 0.016, length(vec2(p.x + 0.1, p.y - 0.46))); c = mix(c, vec3(0.95, 0.85, 0.3), pin * step(0.0, -p.z) * (1.0 - noChain));
    // muscles drawn through the cloth, as the manga inks them: the pecs' lower arcs, the sternum,
    // a six-pack of short hatches, the obliques; on the back the shoulder blades
    float mf = step(p.z, -0.02), mb = step(0.02, p.z);
    vec2 pq = vec2(abs(p.x) - 0.062, p.y - 0.415);
    float pec = fLine(pq.y + 0.035 - pq.x * pq.x * 7.0 - pq.x * 0.12, 0.0035) * step(-0.052, pq.x) * step(pq.x, 0.07) * mf; // a heavy line under each pec, rising to the armpit
    float pecS = smoothstep(0.03, -0.02, pq.y + 0.045) * smoothstep(-0.075, -0.03, pq.y) * step(abs(p.x), 0.13) * mf; // the shadow under the pecs
    float stern = fLine(p.x, 0.0025) * step(0.13, p.y) * step(p.y, 0.4) * mf;
    float abY = fract((p.y - 0.13) / 0.062);
    float abs6 = fLine(abY - 0.5, 0.05) * step(0.13, p.y) * step(p.y, 0.32) * step(0.008, abs(p.x)) * step(abs(p.x), 0.045) * mf;
    float obl = fLine(abs(p.x) - 0.07 - (p.y - 0.12) * 0.25, 0.003) * step(0.1, p.y) * step(p.y, 0.3) * mf;
    vec2 sb = vec2(abs(p.x) - 0.07, p.y - 0.38);
    float blade = fLine(length(sb * vec2(1.4, 1.0)) - 0.055, 0.0035) * step(sb.x, 0.0) * mb;
    c *= 1.0 - (pec * 0.55 + pecS * 0.22 + stern * 0.4 + abs6 * 0.4 + obl * 0.35 + blade * 0.4);`,
  sleeve: `
    // the deltoid's cut and the biceps' groove, inked; a highlight down the swell
    float sf = step(p.z, 0.0);
    float delt = fLine(p.y + 0.075 + p.x * p.x * 9.0 - p.z * 0.3, 0.0035) * step(-0.12, p.y);
    float bic = fLine(p.x - 0.014 * sin(p.y * 22.0), 0.003) * step(-0.2, p.y) * step(p.y, -0.06) * sf;
    float swell = exp(-pow((p.y + 0.11) / 0.05, 2.0)) * smoothstep(0.0, -0.04, p.z);
    c *= 1.0 - delt * 0.45 - bic * 0.35 + swell * 0.12;`,
  legs: `
    float pick = fHash(vec3(floor(diffuseColor.r * 9.0), floor(diffuseColor.g * 9.0) + 3.0, floor(diffuseColor.b * 9.0)));
    if (pick < 0.3) c = mix(c, c * 0.35, fLine(abs(p.x) - 0.05, 0.012));                                // a racing stripe
    else if (pick < 0.45) c = mix(c, mix(c, vec3(1.0), 0.5), step(0.5, fract((p.x + p.y) * 12.0)));     // diagonal print
    // the quads' teardrop above the knee and the calf's curve behind
    float quad = fLine(length(vec2(p.x + 0.025, (p.y + 0.33) * 0.55)) - 0.035, 0.003) * step(p.z, -0.01) * step(-0.38, p.y) * step(p.y, -0.24);
    float calf = fLine(abs(p.x) - 0.02 - 0.02 * sin((p.y + 0.05) * 9.0), 0.003) * step(0.01, p.z) * step(-0.25, p.y) * step(p.y, -0.04);
    c *= 1.0 - quad * 0.4 - calf * 0.3;`,
  hair: `
    // anime hair: two hard cel bands, inked strand cuts, and the bright highlight band around the crown
    float ha = atan(p.x, p.z);
    float band = 0.255 + 0.012 * cos(ha * 5.0);
    c *= mix(0.6, 1.1, step(band - 0.02, p.y));                                       // shade below, lit crown above
    float cut = fLine(fract(ha * 2.6 + p.y * 3.0) - 0.5, 0.03) * step(band, p.y);
    c *= 1.0 - cut * 0.4;
    float ring = (1.0 - smoothstep(0.008, 0.013, abs(p.y - band - 0.022))) * step(0.35, fract(ha * 2.4 + 0.2));
    c = mix(c, mix(c, vec3(1.0), 0.7), ring);                                         // the highlight band, broken into dashes`,
  face: `
    // anime eyes: an almond of white, a dark iris with a highlight, a heavy upper lid line with a
    // flick at the outer corner, a thin lower line; the nose's shadow line; the jaw's shadow
    for (int s = -1; s <= 1; s += 2) {
      vec2 e = vec2(p.x - float(s) * 0.041, p.y - 0.19);
      float alm = length(e / vec2(0.03, 0.014 * (1.0 - 0.35 * abs(e.x) / 0.03)));
      float front = step(p.z, -0.05);
      c = mix(c, vec3(0.97, 0.96, 0.95), (1.0 - smoothstep(0.9, 1.0, alm)) * front);
      float iris = 1.0 - smoothstep(0.0105, 0.0125, length(e - vec2(-float(s) * 0.003, 0.0)));
      c = mix(c, vec3(0.12, 0.08, 0.16), iris * (1.0 - smoothstep(0.9, 1.0, alm)) * front);
      c = mix(c, vec3(1.0), (1.0 - smoothstep(0.002, 0.003, length(e - vec2(-float(s) * 0.006, 0.004)))) * front);
      float lid = (1.0 - smoothstep(0.0, 0.0058, abs(e.y - 0.014 * (1.0 - (e.x / 0.03) * (e.x / 0.03)) + 0.001))) * step(abs(e.x), 0.033 + 0.008 * step(0.0, e.x * float(s)));
      c = mix(c, vec3(0.05, 0.03, 0.07), lid * front);
      float low = (1.0 - smoothstep(0.0, 0.0016, abs(e.y + 0.013 * (1.0 - (e.x / 0.03) * (e.x / 0.03))))) * step(abs(e.x), 0.026);
      c = mix(c, c * 0.45, low * front);
      float lash = fLine(e.y - 0.012 - (e.x * float(s) - 0.03) * 0.9, 0.0025) * step(0.028, e.x * float(s)) * step(e.x * float(s), 0.04);
      c = mix(c, vec3(0.05, 0.03, 0.07), lash * front);                                 // the flick of the lashes
      float bag = fLine(e.y + 0.02 + e.x * e.x * 8.0, 0.0014) * step(-0.018, e.x * float(s)) * step(e.x * float(s), 0.022);
      c = mix(c, c * 0.6, bag * front);                                                 // the line under the eye
      vec2 ck = vec2(e.x * float(s) - 0.012, e.y + 0.045);
      float hatch = fLine(fract((ck.x - ck.y * 0.8) * 160.0) - 0.5, 0.18) * step(abs(ck.x), 0.016) * step(abs(ck.y), 0.008);
      c = mix(c, c * vec3(0.62, 0.5, 0.66), hatch * front * 0.8);                       // cheekbone hatching
    }
    float bridge = (1.0 - smoothstep(0.003, 0.007, abs(p.x + 0.013))) * step(0.16, p.y) * step(p.y, 0.205) * step(p.z, -0.05);
    c = mix(c, c * vec3(0.7, 0.6, 0.75), bridge * 0.6);                                  // the nose bridge's shaded side
    float under = (1.0 - smoothstep(0.0, 0.004, abs(p.y - 0.137 + abs(p.x) * 0.3))) * step(abs(p.x), 0.014) * step(p.z, -0.05);
    c = mix(c, c * 0.5, under);                                                          // under the nose
    float chin = fLine(p.y - 0.082 - p.x * p.x * 12.0, 0.002) * step(abs(p.x), 0.018) * step(p.z, -0.04);
    c = mix(c, c * 0.62, chin);                                                          // the chin's crease
    float noseL = (1.0 - smoothstep(0.0, 0.003, abs(p.x - 0.008))) * step(0.135, p.y) * step(p.y, 0.175) * step(p.z, -0.05);
    c = mix(c, c * 0.6, noseL);
    float jaw = smoothstep(0.13, 0.08, p.y) * smoothstep(0.03, 0.08, abs(p.x)) * step(p.z, 0.02);
    c = mix(c, c * vec3(0.7, 0.6, 0.78), jaw * 0.55);
    float bshadow = smoothstep(0.235, 0.205, p.y) * smoothstep(0.17, 0.2, p.y) * step(abs(p.x), 0.085) * step(p.z, 0.0);
    c = mix(c, c * vec3(0.45, 0.32, 0.55), bshadow * 0.75);                         // the brow's ink shadow
    float heavy = (1.0 - smoothstep(0.006, 0.009, abs(p.y - 0.218 + (abs(p.x) - 0.04) * 0.3))) * step(abs(p.x), 0.078) * step(0.012, abs(p.x)) * step(p.z, -0.04);
    c = mix(c, vec3(0.08, 0.04, 0.1), heavy);                                        // heavy, angled brows
    float lipY = 0.118 - p.x * p.x * 6.0; // a slight downturn: a stern mouth
    float lips = (1.0 - smoothstep(0.0015, 0.003, abs(p.y - lipY))) * (1.0 - smoothstep(0.016, 0.022, abs(p.x))) * step(p.z, -0.04);
    c = mix(c, vec3(0.32, 0.1, 0.2), lips * 0.9); // the mouth: one firm line, coloured
    float lower = (1.0 - smoothstep(0.002, 0.004, abs(p.y - lipY + 0.006))) * (1.0 - smoothstep(0.008, 0.012, abs(p.x))) * step(p.z, -0.04);
    c = mix(c, c * vec3(0.8, 0.6, 0.7), lower * 0.6);`,
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
    if (LOOK === 'manga' && kind === 'top') { // the figure's own print and chain (crowd.js aFash)
      sh.vertexShader = 'attribute float aFash;\nvarying float vFash;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFash = aFash;');
      sh.fragmentShader = 'varying float vFash;\n' + sh.fragmentShader;
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec3 c = diffuseColor.rgb; vec3 p = vLocP; ${spec.glsl} ${LOOK === 'manga' ? MANGA_FASHION[kind] || '' : LOOK === 'verse' && kind === 'face' ? MANGA_FASHION.face : ''}
      ${LOOK === 'manga' ? MANGA_PALETTE : FILM ? FILM_PALETTE : ''}
      diffuseColor.rgb = max(c, 0.0); }`); // (new lines: a // comment at the end of a block must not swallow the rest)
  };
  m.customProgramCacheKey = () => `figure:${kind}:${FILM ? 'film' : 'toy'}:${LOOK || ''}`;
  return m;
}
