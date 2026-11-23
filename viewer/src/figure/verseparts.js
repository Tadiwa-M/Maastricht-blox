// The Spider-Verse look's figure (owner: each look's people should belong to it): an original
// street-style build on the same joints, keys and colour slots as the toy figure (parts.js), as the
// manga look has its own (animeparts.js). Graphic faceted heads with a square jaw; streetwear
// silhouettes (an oversized hoodie with headphones, a quilted puffer, a parka with a fur hood, a
// cropped track jacket over a pleated skirt); baggy sleeves and cargos bunched at wrist and ankle;
// chunky high-tops; big mitt hands; its own hair (a high-top fade, an afro puff, a mohawk, a swoop,
// locs, space buns, a high pony, a backwards cap, a slouchy beanie, a bucket hat).
import * as THREE from 'three';
import { BODY, FIGURE_PARTS } from './parts.js';
import { place, sphere, cyl, torus, lathe, merge, tint, rbox } from './geom.js';

const facet = (g) => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; }; // flat planes: a graphic look
const fin = (at, h, len, lean, c = 1) => place(tint(facet(new THREE.ConeGeometry(0.02, h, 4)), c), { at, rot: [lean, 0, 0], scale: [0.45, 1, len] });

function head() {
  const g = new THREE.SphereGeometry(0.1, 12, 9), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const u = y / 0.1;
    if (u < 0.15) { const k = Math.min(1, (0.15 - u) / 1.15); x *= 1 - 0.12 * k; y *= 1 + 0.45 * k; if (z < 0) z *= 1 + 0.06 * k; } // a square, strong jaw
    if (u > 0.3) z *= 1 + 0.1 * (u - 0.3); // a long back of the skull
    p.setXYZ(i, x * 0.96, y, z);
  }
  const skull = place(tint(facet(g), 1), { at: [0, 0.19, 0], scale: [1, 1.1, 1.02] });
  const nose = place(tint(facet(new THREE.ConeGeometry(0.014, 0.045, 3)), 0.95), { at: [0, 0.16, -0.098], rot: [-Math.PI / 2 + 0.25, 0, 0], scale: [1.2, 1, 0.6] });
  const ear = (x) => place(tint(facet(new THREE.SphereGeometry(0.024, 5, 4)), 0.95), { at: [x, 0.18, 0.01], scale: [0.4, 1.1, 0.75] });
  const neck = place(cyl(0.042, 0.05, 0.12, 1, 8), { at: [0, 0.04, 0.008] });
  return merge([neck, skull, nose, ear(-0.096), ear(0.096)]);
}

const crown = (s = 1) => place(tint(new THREE.SphereGeometry(0.106, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), 1), { at: [0, 0.2, 0.006], scale: [1, 0.7 * s, 1.03] });
function hair(style) {
  switch (style) {
    case 'short': return merge([crown(0.8), place(rbox(0.17, 0.13, 0.17, 0.03, 1, 2), { at: [0, 0.32, 0.0], rot: [-0.12, 0, 0] })]); // a high-top fade
    case 'curly': return merge([crown(), ...[[0, 0.33, 0.02], [-0.07, 0.3, 0.03], [0.07, 0.3, 0.03], [0, 0.31, -0.06], [-0.05, 0.31, -0.04], [0.05, 0.31, -0.04], [0, 0.29, 0.08], [-0.08, 0.25, 0.05], [0.08, 0.25, 0.05]]
      .map((at) => place(tint(facet(new THREE.SphereGeometry(0.06, 7, 5)), 1), { at }))]); // an afro puff
    case 'fringe': return merge([crown(0.65), ...[-0.08, -0.04, 0, 0.04, 0.08].map((z, k) => fin([0, 0.33 - Math.abs(z) * 0.4, z], 0.16 - k * 0.012, 3.2, -0.25))]); // a mohawk
    case 'bob': return merge([crown(), place(rbox(0.12, 0.2, 0.05, 0.02, 1, 2), { at: [0.05, 0.22, -0.09], rot: [-0.15, 0, -0.45] }), // a swoop over one eye
      place(rbox(0.21, 0.16, 0.12, 0.04, 1, 2), { at: [0, 0.22, 0.05] })]);
    case 'long': { const locs = []; // locs down the back and sides
      for (let k = 0; k < 11; k++) { const a = (k / 10 - 0.5) * 3.4, x = Math.sin(a) * 0.1, z = Math.cos(a) * 0.08 + 0.01;
        locs.push(place(cyl(0.013, 0.011, 0.26, 1, 5), { at: [x, 0.13, z], rot: [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12] }), place(sphere(0.016, 0.45, 5, 4), { at: [x * 1.1, 0.0, z * 1.1] })); }
      return merge([crown(), ...locs]); }
    case 'bun': return merge([crown(), place(sphere(0.05, 1, 9, 6), { at: [-0.075, 0.31, 0.01] }), place(sphere(0.05, 1, 9, 6), { at: [0.075, 0.31, 0.01] })]); // space buns
    case 'ponytail': return merge([crown(), place(torus(0.025, 0.01, 0.4), { at: [0, 0.33, 0.07], rot: [0.6, 0, 0] }), // a high pony
      place(tint(new THREE.ConeGeometry(0.04, 0.32, 7), 1), { at: [0, 0.22, 0.17], rot: [Math.PI - 0.6, 0, 0] })]);
    case 'cap': return merge([place(tint(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 1), { at: [0, 0.22, 0.004] }), // backwards, the brim behind
      place(rbox(0.16, 0.012, 0.11, 0.005, 1, 2), { at: [0, 0.225, 0.14], rot: [-0.1, 0, 0] }), place(sphere(0.012, 0.6, 5, 4), { at: [0, 0.33, 0] })]);
    case 'beanie': return merge([place(tint(new THREE.SphereGeometry(0.115, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.6), 1), { at: [0, 0.23, 0.02], rot: [0.35, 0, 0], scale: [1, 1.4, 1] }), // slouchy
      place(torus(0.108, 0.02, 0.8, Math.PI * 2, 6, 18), { at: [0, 0.24, 0.006], rot: [Math.PI / 2, 0, 0] })]);
    case 'hat': return merge([place(cyl(0.1, 0.11, 0.08, 1, 14), { at: [0, 0.31, 0.004] }), place(tint(new THREE.CylinderGeometry(0.115, 0.17, 0.05, 16, 1, true), 1), { at: [0, 0.26, 0.004] })]); // a bucket hat
    default: return FIGURE_PARTS().hair[style];
  }
}

const D = 0.72;
function top(style) {
  const BOX = [[0, -0.02], [0.17, -0.02], [0.18, 0.06], [0.185, 0.3], [0.19, 0.45], [0.17, 0.52], [0.1, 0.56], [0, 0.565]]; // boxy, dropped shoulders
  switch (style) {
    case 'shirt': return merge([lathe(BOX, { depth: D, seg: 10 }), // an oversized hoodie, the hood bunched at the neck, headphones
      place(torus(0.075, 0.03, 1, Math.PI * 2, 6, 12), { at: [0, 0.56, 0.02], rot: [Math.PI / 2 - 0.3, 0, 0] }),
      place(sphere(0.08, 1, 8, 6), { at: [0, 0.53, 0.12], scale: [1.3, 0.8, 0.8] }),
      place(rbox(0.2, 0.1, 0.02, 0.01, 0.82, 1), { at: [0, 0.14, -0.135] }),
      place(cyl(0.004, 0.004, 0.13, 1.4, 4), { at: [-0.03, 0.46, -0.13] }), place(cyl(0.004, 0.004, 0.13, 1.4, 4), { at: [0.03, 0.46, -0.13] }),
      place(torus(0.085, 0.01, 0.22, Math.PI * 1.2, 5, 14), { at: [0, 0.6, -0.01], rot: [Math.PI / 2 + 0.2, 0, Math.PI * 0.4] }),
      place(cyl(0.032, 0.032, 0.025, 0.22, 10), { at: [-0.085, 0.6, -0.04], rot: [0, 0, Math.PI / 2] }), place(cyl(0.032, 0.032, 0.025, 0.22, 10), { at: [0.085, 0.6, -0.04], rot: [0, 0, Math.PI / 2] })]);
    case 'jacket': return merge([lathe(BOX, { depth: D, seg: 10 }), // a quilted puffer: fat bands and a funnel collar
      ...[0.06, 0.17, 0.28, 0.39].map((y) => place(torus(0.175, 0.04, 1, Math.PI * 2, 6, 14), { at: [0, y, 0], rot: [Math.PI / 2, 0, 0], scale: [1.05, D + 0.08, 1] })),
      place(cyl(0.085, 0.1, 0.1, 1, 12), { at: [0, 0.58, 0.01] }), place(rbox(0.012, 0.5, 0.01, 0.004, 0.4, 1), { at: [0, 0.3, -0.16] })]);
    case 'coat': return merge([lathe([[0, -0.5], [0.22, -0.5], [0.2, -0.2], ...BOX.slice(2)], { depth: D, seg: 10 }), // a long parka, fur round the hood
      place(torus(0.09, 0.04, 1.35, Math.PI * 2, 6, 14), { at: [0, 0.57, 0.03], rot: [Math.PI / 2 - 0.4, 0, 0] }),
      ...[-1, 1].map((s) => place(rbox(0.1, 0.11, 0.025, 0.01, 0.85, 1), { at: [s * 0.1, 0.0, -0.14] }))]);
    case 'dress': return merge([ // a cropped track jacket over a pleated skirt
      lathe([[0, -0.38], [0.22, -0.38], [0.2, -0.36], [0.15, -0.05], [0.13, 0.05], [0, 0.05]], { depth: D, seg: 14 }),
      lathe([[0, 0.18], [0.17, 0.18], [0.17, 0.3], [0.175, 0.45], [0.156, 0.52], [0.092, 0.56], [0, 0.565]], { depth: D, seg: 10 }),
      ...[-1, 1].map((s) => place(rbox(0.012, 0.36, 0.01, 0.004, 1.5, 1), { at: [s * 0.16, 0.36, -0.1], rot: [0, 0, s * 0.08] })),
      place(cyl(0.075, 0.09, 0.06, 1, 12), { at: [0, 0.57, 0.01] })]);
    default: return FIGURE_PARTS().top[style];
  }
}

const hips = () => lathe([[0, -0.17], [0.13, -0.17], [0.16, -0.06], [0.155, 0.02], [0, 0.02]], { depth: D, seg: 12 }); // low and baggy
// baggy sleeves, bunched at the wrist; big mitt hands
const upperArm = () => merge([lathe([[0, 0.03], [0.07, 0.02], [0.074, -0.08], [0.068, -0.18], [0.07, -BODY.upperArm], [0, -BODY.upperArm]], { seg: 9 }), place(sphere(0.075, 1, 9, 6), { at: [0, -0.01, 0] })]);
const foreArm = () => merge([lathe([[0, 0.02], [0.062, 0.02], [0.066, -0.1], [0.07, -0.18], [0, -0.18]], { seg: 9 }),
  place(torus(0.055, 0.02, 1, Math.PI * 2, 5, 10), { at: [0, -0.19, 0], rot: [Math.PI / 2, 0, 0] }), place(torus(0.048, 0.018, 0.92, Math.PI * 2, 5, 10), { at: [0, -0.215, 0], rot: [Math.PI / 2, 0, 0] })]);
const hand = () => { const ps = [place(tint(facet(new THREE.BoxGeometry(0.08, 0.085, 0.042)), 1), { at: [0, -0.045, 0] })];
  for (let k = 0; k < 4; k++) ps.push(place(cyl(0.012, 0.011, 0.06, 1, 5), { at: [-0.028 + k * 0.0187, -0.11, -0.008], rot: [0.4, 0, 0] }));
  ps.push(place(cyl(0.013, 0.012, 0.05, 1, 5), { at: [0.042, -0.05, -0.02], rot: [0.5, 0, 0.7] })); return merge(ps); };
// cargos: wide legs, a side pocket, stacked folds at the ankle
const thigh = () => merge([lathe([[0, 0.04], [0.1, 0.03], [0.1, -0.2], [0.092, -BODY.thigh], [0, -BODY.thigh]], { seg: 10 }),
  place(rbox(0.04, 0.11, 0.09, 0.012, 0.88, 1), { at: [0.095, -0.22, 0] })]);
const shin = () => merge([lathe([[0, 0.04], [0.092, 0.03], [0.088, -0.25], [0.08, -0.33], [0, -0.33]], { seg: 10 }),
  ...[-0.34, -0.37, -0.395].map((y, k) => place(torus(0.074 - k * 0.006, 0.02, 1, Math.PI * 2, 5, 12), { at: [0, y, 0], rot: [Math.PI / 2, 0, 0] }))]);
const shoe = () => merge([ // a chunky high-top: big upper, ankle collar, a thick light sole, lace bars
  place(rbox(0.12, 0.1, 0.24, 0.04, 1, 2), { at: [0, -0.03, -0.04] }), place(cyl(0.07, 0.075, 0.08, 1, 10), { at: [0, 0.03, 0.01] }),
  place(rbox(0.13, 0.035, 0.27, 0.015, 1.7, 2), { at: [0, -0.085, -0.045] }),
  ...[0, 1, 2].map((k) => place(rbox(0.07, 0.008, 0.012, 0.003, 0.3, 1), { at: [0, 0.015 - k * 0.022, -0.07 - k * 0.03], rot: [0.5, 0, 0] }))]);

let cache = null;
/** The Spider-Verse figure's part geometries, keyed exactly as FIGURE_PARTS (far LOD and accessories shared). */
export function VERSE_PARTS() {
  if (cache) return cache;
  const P = FIGURE_PARTS();
  cache = { ...P, head: head(), hips: hips(), upperArm: upperArm(), foreArm: foreArm(), hand: hand(), thigh: thigh(), shin: shin(), shoe: shoe(),
    hair: Object.fromEntries(Object.keys(P.hair).map((s) => [s, hair(s)])), top: Object.fromEntries(Object.keys(P.top).map((s) => [s, top(s)])) };
  return cache;
}
