// Geometry of the smooth toy figure (an original design, deliberately NOT a toy minifigure:
// rounded-rectangle head with a neck and separate hair, oval lathe torso, two-segment arms
// and legs with mitten hands and shoes). Units: metres, adult at scale 1 (~1.78 m with hair).
// Every part's origin is its joint; limbs hang along -y; the figure's front is -z.
//
// Vertex colours mark fixed details (eyes, smile, belts, soles); the instance colour (the
// variant's skin / clothing colour) multiplies them. Built once, cached (FIGURE_PARTS()).
import * as THREE from 'three';
import { rbox, sphere, capsule, cyl, torus, lathe, place, merge } from './geom.js';

// Skeleton (metres, adult scale 1)
export const BODY = {
  pelvisY: 0.91, // hip joint height above the soles
  hipX: 0.092,
  thigh: 0.42, shin: 0.41, // hip -> knee -> ankle
  shoulderX: 0.18, shoulderY: 0.44, // relative to the pelvis
  upperArm: 0.27, foreArm: 0.24,
  neckY: 0.55, // neck base above the pelvis
  headTop: 0.3, // head top above the neck base (without hair)
};
const DARK = 0.07; // eyes

function head() {
  const neck = place(cyl(0.042, 0.046, 0.09, 1), { at: [0, 0.03, 0] });
  const skull = place(rbox(0.205, 0.24, 0.2, 0.08, 1, 2), { at: [0, 0.06 + 0.12, 0] });
  const eye = (x) => place(sphere(0.017, DARK, 6, 5), { at: [x, 0.19, -0.094], scale: [1, 1.25, 0.6] });
  const shine = (x) => place(sphere(0.006, 3.5, 5, 4), { at: [x + 0.006, 0.197, -0.1] }); // catch-light
  const smile = place(torus(0.026, 0.0055, [0.35, 0.12, 0.1], Math.PI, 5, 10), { at: [0, 0.142, -0.098], rot: [0, 0, Math.PI] });
  const nose = place(sphere(0.016, 0.93, 5, 4), { at: [0, 0.165, -0.1], scale: [1, 0.9, 0.8] });
  const cheek = (x) => place(sphere(0.02, [1, 0.72, 0.68], 5, 4), { at: [x, 0.152, -0.088], scale: [1, 0.7, 0.4] });
  const ear = (x) => place(sphere(0.026, 0.95, 5, 4), { at: [x, 0.175, 0.005], scale: [0.45, 1, 0.8] });
  return merge([neck, skull, eye(-0.047), eye(0.047), shine(-0.047), shine(0.047), smile, nose,
    cheek(-0.066), cheek(0.066), ear(-0.103), ear(0.103)]);
}

// Hair and hats, relative to the neck base (head box: x +-0.1025, y 0.06..0.30, z +-0.1)
const cap = () => place(rbox(0.222, 0.115, 0.218, 0.055, 1, 2), { at: [0, 0.262, 0.008] });
const backHair = (h = 0.16) => place(rbox(0.222, h, 0.09, 0.04, 1, 1), { at: [0, 0.3 - h / 2 - 0.02, 0.066] });
export const HAIR_STYLES = ['short', 'bob', 'long', 'bun', 'ponytail', 'curly', 'cap', 'beanie', 'hat', 'fringe'];

function hair(style) {
  switch (style) {
    case 'short': return merge([cap(), backHair(0.16)]);
    case 'bob': return merge([cap(), place(rbox(0.236, 0.2, 0.17, 0.06, 1, 2), { at: [0, 0.2, 0.034] }),
      place(rbox(0.21, 0.05, 0.05, 0.02, 1, 2), { at: [0, 0.27, -0.09] })]); // fringe over the forehead
    case 'long': return merge([cap(), place(rbox(0.232, 0.36, 0.08, 0.04, 1, 2), { at: [0, 0.13, 0.075] }),
      place(rbox(0.236, 0.22, 0.12, 0.05, 1, 2), { at: [0, 0.19, 0.03] })]);
    case 'bun': return merge([cap(), backHair(0.12), place(sphere(0.058, 1, 8, 5), { at: [0, 0.31, 0.075] })]);
    case 'ponytail': return merge([cap(), backHair(0.12),
      place(capsule(0.036, 0.14, 1, 2, 7), { at: [0, 0.18, 0.135], rot: [0.25, 0, 0] }),
      place(torus(0.026, 0.01, 0.5, Math.PI * 2, 5, 10), { at: [0, 0.255, 0.115], rot: [Math.PI / 2 + 0.25, 0, 0] })]);
    case 'curly': {
      const s = [];
      for (const [x, y, z] of [[0, 0.3, 0.01], [-0.07, 0.28, -0.04], [0.07, 0.28, -0.04], [-0.085, 0.25, 0.05], [0.085, 0.25, 0.05],
        [0, 0.27, 0.08], [-0.05, 0.31, 0.06], [0.05, 0.31, 0.06], [0, 0.29, -0.06], [-0.09, 0.2, 0.06], [0.09, 0.2, 0.06], [0, 0.2, 0.1]]) {
        s.push(place(sphere(0.058, 1, 6, 5), { at: [x, y, z] }));
      }
      return merge(s);
    }
    case 'cap': return merge([ // baseball cap: dome + forward brim + button
      place(sphere(0.118, 1, 10, 6), { at: [0, 0.225, 0.006], scale: [1, 0.72, 1] }),
      place(rbox(0.17, 0.018, 0.11, 0.008, 1, 2), { at: [0, 0.232, -0.13], rot: [0.12, 0, 0] }),
      place(sphere(0.014, 0.8, 5, 4), { at: [0, 0.31, 0.006] }),
      backHair(0.1)]);
    case 'beanie': return merge([
      place(sphere(0.119, 1, 10, 6), { at: [0, 0.225, 0.006], scale: [1, 0.9, 1] }),
      place(torus(0.116, 0.022, 0.82, Math.PI * 2, 6, 18), { at: [0, 0.232, 0.006], rot: [Math.PI / 2, 0, 0] }),
      place(sphere(0.032, 1, 5, 4), { at: [0, 0.34, 0.006] })]);
    case 'hat': return merge([ // round felt hat with a band
      place(cyl(0.098, 0.106, 0.09, 1, 18), { at: [0, 0.335, 0.004] }),
      place(cyl(0.165, 0.165, 0.014, 1, 22), { at: [0, 0.29, 0.004] }),
      place(cyl(0.108, 0.108, 0.025, 0.3, 18), { at: [0, 0.305, 0.004] }),
      place(sphere(0.105, 1, 9, 4), { at: [0, 0.38, 0.004], scale: [1, 0.25, 1] })]);
    case 'fringe': return merge([ // bald on top, hair round the back and sides
      place(rbox(0.222, 0.075, 0.13, 0.03, 1, 2), { at: [0, 0.19, 0.04] })]);
    default: throw new Error(`hair style ${style}`);
  }
}

// Torso (origin: pelvis). Oval lathe (shoulders rounded, waist slightly in); never a trapezoid.
export const TOP_STYLES = ['shirt', 'jacket', 'coat', 'dress'];
const TORSO = [[0.0, 0.0], [0.15, 0.0], [0.152, 0.06], [0.145, 0.2], [0.158, 0.33], [0.17, 0.43], [0.158, 0.5], [0.12, 0.545], [0.05, 0.565], [0, 0.567]];
const DEPTH = 0.64;

function top(style) {
  const shirt = (w = 1, c = 1) => lathe(TORSO, { depth: DEPTH, width: w, c });
  switch (style) {
    case 'shirt': return merge([shirt(),
      place(torus(0.048, 0.012, 1, Math.PI * 2, 5, 14), { at: [0, 0.548, 0], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1, 0.9] })]);
    case 'jacket': return merge([
      lathe([[0, -0.06], [0.158, -0.06], [0.16, 0.06], ...TORSO.slice(3)], { depth: DEPTH + 0.04, width: 1.05 }),
      place(rbox(0.035, 0.4, 0.012, 0.005, 0.7, 1), { at: [0, 0.2, -0.101] }), // open front: darker placket
      place(sphere(0.011, 0.35, 5, 4), { at: [0.035, 0.24, -0.107] }), place(sphere(0.011, 0.35, 5, 4), { at: [0.035, 0.12, -0.107] }),
      place(rbox(0.13, 0.05, 0.03, 0.012, 0.85, 1), { at: [-0.05, 0.47, -0.088], rot: [0, 0, -0.5] }), // lapels
      place(rbox(0.13, 0.05, 0.03, 0.012, 0.85, 1), { at: [0.05, 0.47, -0.088], rot: [0, 0, 0.5] })]);
    case 'coat': return merge([
      lathe([[0, -0.4], [0.215, -0.4], [0.195, -0.2], [0.172, 0.0], ...TORSO.slice(3)], { depth: DEPTH + 0.14, width: 1.06 }),
      place(torus(0.075, 0.025, 1, Math.PI * 2, 6, 16), { at: [0, 0.53, 0], rot: [Math.PI / 2, 0, 0], scale: [1.1, 0.9, 1] }), // collar
      place(torus(0.16, 0.014, 0.55, Math.PI * 2, 5, 24), { at: [0, 0.06, 0], rot: [Math.PI / 2, 0, 0], scale: [1.1, DEPTH + 0.16, 1] }), // belt
      ...[0.3, 0.2, -0.05, -0.18].map((y) => place(sphere(0.012, 0.4, 5, 4), { at: [0.04, y, -0.12 - (y < 0 ? 0.01 : 0)] }))]);
    case 'dress': return merge([
      lathe([[0, -0.42], [0.225, -0.42], [0.2, -0.24], [0.16, -0.02], [0.145, 0.2], ...TORSO.slice(4)], { depth: DEPTH + 0.04 }),
      place(torus(0.153, 0.012, 0.75, Math.PI * 2, 5, 36), { at: [0, 0.2, 0], rot: [Math.PI / 2, 0, 0], scale: [1, DEPTH, 1] }), // waistband
      place(torus(0.048, 0.012, 1, Math.PI * 2, 5, 14), { at: [0, 0.548, 0], rot: [Math.PI / 2, 0, 0], scale: [1.15, 1, 0.9] })]);
    default: throw new Error(`top style ${style}`);
  }
}

/** Hips/shorts block under the torso in the trousers colour. Origin pelvis. */
function hips() {
  return merge([lathe([[0, -0.12], [0.12, -0.13], [0.156, -0.06], [0.158, 0.02], [0, 0.02]], { depth: DEPTH + 0.02 }),
    place(torus(0.152, 0.011, 0.45, Math.PI * 2, 5, 24), { at: [0, 0.012, 0] , rot: [Math.PI / 2, 0, 0], scale: [1, DEPTH + 0.02, 1] })]); // belt
}

const upperArm = () => merge([place(capsule(0.05, BODY.upperArm - 0.06, 1), { at: [0, -BODY.upperArm / 2 + 0.01, 0] }),
  place(sphere(0.053, 1, 8, 5), { at: [0, -0.012, 0] })]); // shoulder ball
const foreArm = () => merge([place(capsule(0.043, BODY.foreArm - 0.05, 1), { at: [0, -BODY.foreArm / 2 + 0.01, 0] }),
  place(torus(0.043, 0.008, 0.85, Math.PI * 2, 4, 12), { at: [0, -BODY.foreArm + 0.035, 0], rot: [Math.PI / 2, 0, 0] })]); // cuff
const hand = () => merge([ // rounded mitten + thumb, never a C-shaped hand
  place(sphere(0.048, 1, 8, 5), { at: [0, -0.055, 0], scale: [0.72, 1.25, 0.95] }),
  place(sphere(0.022, 1, 5, 4), { at: [0, -0.04, -0.038], scale: [1, 1.3, 1] })]);
const thigh = () => place(capsule(0.072, BODY.thigh - 0.07, 1, 2, 9), { at: [0, -BODY.thigh / 2 + 0.01, 0] });
const shin = () => merge([place(capsule(0.06, BODY.shin - 0.08, 1, 2, 9), { at: [0, -BODY.shin / 2 + 0.02, 0] }),
  place(sphere(0.064, 1, 6, 5), { at: [0, -0.005, 0] })]); // knee
const shoe = () => merge([ // origin ankle
  place(rbox(0.088, 0.075, 0.205, 0.035, 1, 1), { at: [0, -0.04, -0.04] }),
  place(rbox(0.092, 0.02, 0.21, 0.009, 0.55, 1), { at: [0, -0.07, -0.04] })]); // sole: at the ground

// Accessories
export const ACCESSORIES = ['none', 'backpack', 'bag', 'umbrella'];
function accessory(kind) {
  switch (kind) {
    case 'backpack': return merge([ // origin pelvis, on the back (+z)
      place(rbox(0.26, 0.32, 0.12, 0.05, 1, 1), { at: [0, 0.32, 0.16] }),
      place(rbox(0.2, 0.12, 0.05, 0.02, 0.8, 1), { at: [0, 0.24, 0.225] }),
      place(rbox(0.035, 0.36, 0.02, 0.01, 0.6, 1), { at: [-0.1, 0.33, -0.01], rot: [0.05, 0, 0] }),
      place(rbox(0.035, 0.36, 0.02, 0.01, 0.6, 1), { at: [0.1, 0.33, -0.01], rot: [0.05, 0, 0] })]);
    case 'bag': return merge([ // origin hand (wrist): a shopping bag hanging from the mitten
      place(rbox(0.22, 0.26, 0.09, 0.02, 1, 1), { at: [0, -0.25, 0] }),
      place(torus(0.045, 0.008, 0.9, Math.PI, 4, 10), { at: [0, -0.115, 0] })]);
    case 'umbrella': return merge([ // origin hand: shaft up, canopy above the head
      place(cyl(0.008, 0.008, 1.0, 0.3, 6), { at: [0, 0.42, 0] }),
      place(cyl(0.02, 0.55, 0.22, 1, 16), { at: [0, 0.82, 0] }),
      place(sphere(0.02, 0.3, 5, 4), { at: [0, 0.94, 0] })]);
    default: return null;
  }
}

// Far level of detail (beyond ~30 m): ~800 triangles a figure, fewer parts (forearm + hand,
// shin + shoe merged), three hair shapes, two top lengths. Same joints, same instance colours.
export const LO_HAIR = { short: 'cap', fringe: 'cap', cap: 'cap', beanie: 'cap', hat: 'cap', long: 'long', bob: 'long', ponytail: 'long', bun: 'puff', curly: 'puff' };
function loParts() {
  const skull = () => place(rbox(0.205, 0.24, 0.2, 0.08, 1, 1), { at: [0, 0.18, 0] });
  const eyes = [-0.047, 0.047].map((x) => place(rbox(0.026, 0.034, 0.01, 0.004, 0.07, 1), { at: [x, 0.19, -0.1] }));
  const cap0 = () => place(rbox(0.222, 0.115, 0.218, 0.05, 1, 1), { at: [0, 0.262, 0.008] });
  const lathe8 = (pts, o) => lathe(pts, { ...o, seg: 8 });
  return {
    head: merge([place(cyl(0.044, 0.044, 0.09, 1, 6), { at: [0, 0.03, 0] }), skull(), ...eyes]),
    hair: {
      cap: merge([cap0(), place(rbox(0.222, 0.14, 0.09, 0.04, 1, 1), { at: [0, 0.2, 0.066] })]),
      long: merge([cap0(), place(rbox(0.232, 0.34, 0.1, 0.04, 1, 1), { at: [0, 0.14, 0.07] })]),
      puff: merge([place(sphere(0.125, 1, 7, 5), { at: [0, 0.26, 0.03] }), place(sphere(0.065, 1, 6, 4), { at: [0, 0.32, 0.1] })]),
    },
    top: {
      short: lathe8(TORSO, { depth: DEPTH }),
      long: lathe8([[0, -0.42], [0.215, -0.42], [0.18, -0.2], [0.16, 0.0], ...TORSO.slice(3)], { depth: DEPTH + 0.08 }),
    },
    hips: lathe8([[0, -0.12], [0.12, -0.13], [0.156, -0.06], [0.158, 0.02], [0, 0.02]], { depth: DEPTH + 0.02 }),
    upperArm: place(capsule(0.05, BODY.upperArm - 0.05, 1, 1, 6), { at: [0, -BODY.upperArm / 2 + 0.01, 0] }),
    foreArm: merge([place(capsule(0.043, BODY.foreArm - 0.04, 1, 1, 6), { at: [0, -BODY.foreArm / 2 + 0.01, 0] }),
      place(sphere(0.045, 1.0, 6, 4), { at: [0, -BODY.foreArm - 0.05, 0], scale: [0.75, 1.2, 0.9] })]),
    thigh: place(capsule(0.072, BODY.thigh - 0.06, 1, 1, 6), { at: [0, -BODY.thigh / 2 + 0.01, 0] }),
    shin: merge([place(capsule(0.06, BODY.shin - 0.06, 1, 1, 6), { at: [0, -BODY.shin / 2 + 0.02, 0] }),
      place(rbox(0.09, 0.09, 0.21, 0.03, 0.3, 1), { at: [0, -BODY.shin - 0.045, -0.04] })]),
    backpack: merge([place(rbox(0.26, 0.32, 0.12, 0.05, 1, 1), { at: [0, 0.32, 0.16] })]),
  };
}

let cache = null;
/** All part geometries: { head, hips, upperArm, foreArm, hand, thigh, shin, shoe, hair: {}, top: {}, acc: {}, lo: {...far LOD} }. */
export function FIGURE_PARTS() {
  if (cache) return cache;
  cache = { head: head(), hips: hips(), upperArm: upperArm(), foreArm: foreArm(), hand: hand(), thigh: thigh(), shin: shin(), shoe: shoe(),
    hair: Object.fromEntries(HAIR_STYLES.map((s) => [s, hair(s)])),
    top: Object.fromEntries(TOP_STYLES.map((s) => [s, top(s)])),
    acc: Object.fromEntries(ACCESSORIES.filter((a) => a !== 'none').map((a) => [a, accessory(a)])), lo: loParts() };
  return cache;
}

/** Glossy toy plastic like the city's (materials.js), colours from vertex x instance colour. */
export function figureMaterial({ clippingPlanes = null } = {}) {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0,
    clearcoat: 0.45, clearcoatRoughness: 0.25, specularIntensity: 0.6, clippingPlanes });
}
