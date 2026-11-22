// The manga look's figure (owner: our characters as if from a bizarre-adventure manga, not the
// toy blocks): an original anime build on the same joints, keys and colour slots as the toy
// figure (parts.js), so every pose, walk, the gun, the bike and the crowd instancing work as they
// are. Smooth tapered anatomy (lathe profiles: deltoids, biceps, a V torso, thighs, calves), an
// angular anime head (a tapered jaw and chin, a nose ridge, flat ears; the eyes, brows and lips
// are drawn by the face shader, render/figuresurface.js), sculpted hair (a pompadour, spikes, a
// swept fringe...), tailored clothes (a high collar, lapels, a long coat), hands with fingers,
// pointed shoes. Part frames as in parts.js: head origin at the neck base, front -z; limbs hang
// down -y from their joint. Vertex colours < 1 mark fixed dark details, as in parts.js.
import * as THREE from 'three';
import { BODY, FIGURE_PARTS } from './parts.js';
import { place, sphere, cyl, torus, lathe, merge, tint, rbox } from './geom.js';

/** A limb from [radius, y] points (y going down from the joint), slightly oval front to back. */
const limb = (pts, depth = 0.92, seg = 14) => lathe(pts.map(([r, y]) => [r, y]).reverse(), { depth, seg });

function head() {
  // the skull: a sphere stretched and carved into an anime head: the jaw narrows to a defined chin
  const g = new THREE.SphereGeometry(0.1, 28, 22), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = y / 0.1; // -1 bottom .. 1 top
    if (u < 0.1) { // the lower face: narrower, longer, the chin forward
      const k = Math.min(1, (0.1 - u) / 1.1);
      x *= 1 - 0.42 * k ** 1.2;
      y *= 1 + 0.55 * k;
      if (z < 0) z *= 1 - 0.15 * k; else z *= 1 - 0.35 * k;
    }
    if (u > 0.2) z *= 1 + 0.06 * (u - 0.2); // a fuller back of the skull
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const skull = place(tint(g, 1), { at: [0, 0.19, 0], scale: [1.0, 1.08, 1.0] });
  const neck = place(cyl(0.038, 0.048, 0.12, 1, 14), { at: [0, 0.04, 0.008] });
  // a nose ridge: a narrow wedge down the front of the face
  const nose = place(tint(new THREE.ConeGeometry(0.009, 0.036, 4), 0.96), { at: [0, 0.165, -0.094], rot: [-Math.PI / 2 + 0.35, Math.PI / 4, 0], scale: [1, 1, 0.5] });
  const ear = (x) => place(sphere(0.022, 0.95, 6, 5), { at: [x, 0.175, 0.01], scale: [0.35, 1.15, 0.7] });
  return merge([neck, skull, nose, ear(-0.098), ear(0.098)]);
}

// sculpted hair (origin: the neck base; the skull spans y 0.07..0.31, x +-0.1, z +-0.1)
const crown = (scaleY = 0.62) => place(tint(new THREE.SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 1), { at: [0, 0.205, 0.006], scale: [1.02, scaleY / 0.62, 1.04] });
const back = (h = 0.17) => place(rbox(0.216, h, 0.09, 0.04, 1, 2), { at: [0, 0.3 - h / 2 - 0.02, 0.068] });
const spike = (at, dir, len = 0.11, r = 0.03, c = 1) => {
  const g = tint(new THREE.ConeGeometry(r, len, 5), c);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()));
  g.translate(...at);
  return g;
};
function hair(style) {
  switch (style) {
    case 'short': return merge([crown(), back(), // a swept-up pompadour: a big forward-curling volume
      place(sphere(0.07, 1, 14, 10), { at: [0, 0.32, -0.07], scale: [1.25, 0.85, 1.35], rot: [0.5, 0, 0] }),
      place(sphere(0.055, 1, 12, 8), { at: [0, 0.35, -0.12], scale: [1.15, 0.7, 1.1], rot: [0.9, 0, 0] })]);
    case 'curly': return merge([crown(0.7), back(0.18), // a crown of spikes
      ...[[0, 0.32, -0.04, 0, 1, -0.6], [-0.06, 0.31, -0.02, -0.5, 1, -0.4], [0.06, 0.31, -0.02, 0.5, 1, -0.4], [-0.09, 0.27, 0.03, -1, 0.6, 0.1],
        [0.09, 0.27, 0.03, 1, 0.6, 0.1], [0, 0.31, 0.05, 0, 1, 0.5], [-0.05, 0.3, 0.07, -0.5, 0.8, 0.7], [0.05, 0.3, 0.07, 0.5, 0.8, 0.7]]
        .map(([x, y, z, a, b, c]) => spike([x, y, z], [a, b, c], 0.12, 0.034))]);
    case 'fringe': return merge([crown(), back(), // a long angular fringe swept across one eye
      spike([0.04, 0.29, -0.09], [-0.6, -1, -0.3], 0.17, 0.045), spike([-0.01, 0.29, -0.095], [-0.4, -1, -0.25], 0.14, 0.04),
      spike([0.07, 0.27, -0.08], [-0.3, -1, -0.2], 0.11, 0.035)]);
    case 'bob': return merge([crown(), // a sharp bob, spikes framing the face
      place(rbox(0.232, 0.2, 0.17, 0.05, 1, 2), { at: [0, 0.2, 0.036] }),
      spike([-0.095, 0.22, -0.06], [-0.2, -1, -0.15], 0.11, 0.03), spike([0.095, 0.22, -0.06], [0.2, -1, -0.15], 0.11, 0.03),
      spike([0, 0.3, -0.1], [0, -0.6, -1], 0.08, 0.04)]);
    case 'long': return merge([crown(), // long hair down the back, in locks
      place(rbox(0.23, 0.38, 0.08, 0.035, 1, 2), { at: [0, 0.12, 0.078] }),
      spike([-0.07, 0.0, 0.08], [-0.15, -1, 0.2], 0.12, 0.035), spike([0.07, 0.0, 0.08], [0.15, -1, 0.2], 0.12, 0.035),
      spike([0, 0.29, -0.095], [0.3, -1, -0.3], 0.12, 0.035)]);
    case 'bun': return merge([crown(), back(0.12), place(sphere(0.06, 1, 10, 7), { at: [0, 0.33, 0.07] }),
      spike([0, 0.36, 0.08], [0, 1, 0.3], 0.09, 0.03)]);
    case 'ponytail': return merge([crown(), back(0.12), // swept back into a long tail
      place(tint(new THREE.ConeGeometry(0.045, 0.3, 7), 1), { at: [0, 0.14, 0.17], rot: [Math.PI - 0.35, 0, 0] }),
      place(torus(0.028, 0.01, 0.4, Math.PI * 2, 5, 10), { at: [0, 0.27, 0.12], rot: [Math.PI / 2 + 0.3, 0, 0] })]);
    case 'cap': return merge([ // a tall peaked cap with a badge (worn low), hair at the back
      place(cyl(0.105, 0.112, 0.1, 1, 20), { at: [0, 0.31, 0.004] }), place(cyl(0.122, 0.122, 0.02, 0.4, 20), { at: [0, 0.265, 0.004] }),
      place(rbox(0.2, 0.014, 0.1, 0.006, 0.3, 2), { at: [0, 0.255, -0.12], rot: [0.12, 0, 0] }),
      place(rbox(0.05, 0.035, 0.012, 0.005, [1.4, 1.1, 0.3], 2), { at: [0, 0.31, -0.112] }), back(0.12)]);
    case 'beanie': return merge([place(tint(new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), 1), { at: [0, 0.235, 0.006], scale: [1, 1.05, 1.02] }), // above the brows
      place(torus(0.112, 0.022, 0.8, Math.PI * 2, 6, 20), { at: [0, 0.245, 0.006], rot: [Math.PI / 2, 0, 0] }), back(0.1)]);
    case 'hat': return merge([place(cyl(0.098, 0.108, 0.1, 1, 20), { at: [0, 0.35, 0.004] }), back(0.1),
      place(cyl(0.18, 0.18, 0.014, 1, 24), { at: [0, 0.3, 0.004] }), place(cyl(0.11, 0.11, 0.025, 0.3, 20), { at: [0, 0.315, 0.004] })]);
    default: return FIGURE_PARTS().hair[style];
  }
}

// a V torso: broad chest and shoulders, a narrow waist (radius, y above the pelvis)
const TORSO = [[0, 0], [0.13, 0], [0.128, 0.08], [0.14, 0.2], [0.17, 0.33], [0.19, 0.42], [0.18, 0.49], [0.13, 0.54], [0.05, 0.565], [0, 0.567]];
const D = 0.6;
function top(style) {
  // a stand-up collar framing the neck, open at the front so the chin shows
  const collar = (h = 0.05, r = 0.07) => place(tint(new THREE.CylinderGeometry(r + 0.012, r, h, 16, 1, true, Math.PI * 0.25, Math.PI * 1.5), 1), { at: [0, 0.545 + h / 2, 0.012] });
  const lapel = (s) => place(rbox(0.05, 0.22, 0.02, 0.008, 0.82, 1), { at: [s * 0.06, 0.4, -0.1], rot: [0.1, 0, s * 0.35] });
  switch (style) {
    case 'shirt': return merge([lathe(TORSO, { depth: D }), collar(0.035, 0.055),
      place(rbox(0.03, 0.2, 0.012, 0.005, 0.85, 1), { at: [0, 0.42, -0.097] })]); // an open V at the neck
    case 'jacket': return merge([lathe([[0, -0.08], [0.15, -0.08], ...TORSO.slice(2)], { depth: D + 0.05, width: 1.06 }), collar(0.05, 0.068), lapel(-1), lapel(1),
      ...[0.28, 0.18, 0.08].map((y) => place(sphere(0.012, [1.3, 1.0, 0.3], 5, 4), { at: [-0.05, y, -0.11] }))]); // gold buttons
    case 'coat': return merge([ // a long open coat with a tall collar, flaring to the knee
      lathe([[0, -0.52], [0.22, -0.52], [0.19, -0.3], [0.16, -0.05], [0.14, 0.12], ...TORSO.slice(3)], { depth: D + 0.16, width: 1.08 }),
      collar(0.075, 0.075), lapel(-1), lapel(1),
      place(rbox(0.035, 0.6, 0.014, 0.006, 0.6, 1), { at: [0, 0.02, -0.12] })]); // the open front
    case 'dress': return merge([lathe([[0, -0.45], [0.23, -0.45], [0.19, -0.24], [0.13, 0.05], [0.14, 0.2], ...TORSO.slice(4)], { depth: D + 0.06 }), collar(0.03, 0.055)]);
    default: return FIGURE_PARTS().top[style];
  }
}

const hips = () => merge([lathe([[0, -0.12], [0.11, -0.13], [0.14, -0.05], [0.135, 0.02], [0, 0.02]], { depth: D + 0.02 }),
  place(torus(0.135, 0.012, 0.25, Math.PI * 2, 5, 24), { at: [0, 0.01, 0], rot: [Math.PI / 2, 0, 0], scale: [1, D + 0.02, 1] })]);
// limbs: a shoulder ball, a deltoid and biceps swelling, a forearm muscle tapering to the wrist,
// a thigh tapering to the knee, a calf to a slim ankle
const upperArm = () => merge([limb([[0.055, 0.02], [0.062, -0.02], [0.056, -0.09], [0.05, -0.15], [0.04, -0.24], [0.036, -BODY.upperArm]]),
  place(sphere(0.06, 1, 10, 7), { at: [0, -0.005, 0] })]);
const foreArm = () => limb([[0.038, 0.02], [0.046, -0.05], [0.04, -0.13], [0.03, -0.21], [0.027, -BODY.foreArm]]);
const hand = () => { // a palm and four slightly curled fingers and a thumb
  const parts = [place(rbox(0.06, 0.07, 0.03, 0.012, 1, 2), { at: [0, -0.04, 0] })];
  for (let k = 0; k < 4; k++) parts.push(place(cyl(0.0085, 0.0075, 0.055, 1, 6), { at: [-0.021 + k * 0.014, -0.1, -0.006], rot: [0.35, 0, 0] }));
  parts.push(place(cyl(0.009, 0.008, 0.045, 1, 6), { at: [0.032, -0.05, -0.016], rot: [0.5, 0, 0.7] }));
  return merge(parts);
};
const thigh = () => limb([[0.08, 0.03], [0.085, -0.04], [0.078, -0.16], [0.065, -0.3], [0.052, -BODY.thigh]], 0.95);
const shin = () => merge([limb([[0.055, 0.04], [0.062, -0.06], [0.056, -0.15], [0.04, -0.3], [0.034, -BODY.shin]], 0.95), place(sphere(0.058, 1, 8, 6), { at: [0, 0, 0] })]);
const shoe = () => merge([ // a pointed dress shoe (origin: the ankle)
  place(rbox(0.08, 0.07, 0.17, 0.03, 1, 2), { at: [0, -0.04, -0.03] }),
  place(tint(new THREE.ConeGeometry(0.042, 0.1, 6), 1), { at: [0, -0.05, -0.15], rot: [-Math.PI / 2, 0, 0], scale: [1, 1, 0.6] }),
  place(rbox(0.086, 0.016, 0.26, 0.007, 0.35, 1), { at: [0, -0.072, -0.06] })]);

let cache = null;
/** The manga figure's part geometries, keyed exactly as FIGURE_PARTS (far LOD and accessories shared). */
export function ANIME_PARTS() {
  if (cache) return cache;
  const P = FIGURE_PARTS();
  cache = { ...P, head: head(), hips: hips(), upperArm: upperArm(), foreArm: foreArm(), hand: hand(), thigh: thigh(), shin: shin(), shoe: shoe(),
    hair: Object.fromEntries(Object.keys(P.hair).map((s) => [s, hair(s)])),
    top: Object.fromEntries(Object.keys(P.top).map((s) => [s, top(s)])) };
  return cache;
}
