// Each painted look's own bus and river boat (owner: every look adopts its own vehicles): smooth
// models in place of the brick ones (CONTRACT 7.1 models stay the data; the Classic look draws
// them as bricks). Same sizes, pivot (ground / waterline centre), front (-z), wheel hinges and
// livery slot as the brick model, so the bus flow, the liveries and boarding work unchanged.
//   manga: a rounded retro coach in two tones (a pale roof over the livery, a chrome strip and
//          bumpers, round lamps, a wraparound windscreen); a white river yacht with a navy stripe,
//          a flared bow, two decks of rounded cabins and a chrome rail
//   verse: a chunky city bus (a dark skirt, big windows, roof units; graffiti from the body
//          shader); a squat ferry with neon trim and a tagged hull
import * as THREE from 'three';
import { rbox, sphere, cyl, tube, place, merge } from '../figure/geom.js';
import { figureMaterial } from '../figure/parts.js';
import { vehicleMaterialFor } from '../render/vehiclesurface.js';

const LIVERY = 38; // the bus model's body colour (buses.js recolours it per route)
const DARK = 0.16, GLASS = [0.05, 0.07, 0.1];
const decal = (r, g, b) => [r + 2, g + 2, b + 2];
const CHROME = decal(0.86, 0.88, 0.92), PALE = decal(0.95, 0.92, 0.84);
let mats = null;
const materials = () => (mats ||= { body: vehicleMaterialFor(figureMaterial(), 'body'), glass: vehicleMaterialFor(figureMaterial(), 'glass'), wheel: vehicleMaterialFor(figureMaterial(), 'wheel') });

function busBody(look, W, L, H) {
  if (look === 'manga') return merge([
    place(rbox(W, H * 0.42, L, 0.3, 1, 3), { at: [0, 0.3 + H * 0.21, 0] }), // the livery, low
    place(rbox(W * 0.97, H * 0.18, L * 0.97, 0.45, PALE, 3), { at: [0, H * 0.86, 0.1] }), // a pale rounded roof
    place(rbox(W + 0.03, 0.06, L * 0.96, 0.02, CHROME), { at: [0, 0.3 + H * 0.38, 0] }), // a chrome strip
    place(rbox(W + 0.08, 0.16, 0.2, 0.08, CHROME), { at: [0, 0.32, -L / 2 - 0.04] }), place(rbox(W + 0.08, 0.16, 0.2, 0.08, CHROME), { at: [0, 0.32, L / 2 + 0.04] }),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((az) => place(sphere(0.5, 1, 12, 8), { at: [sx * (W / 2 - 0.12), 0.5, az * (L / 2 - 2.3)], scale: [0.35, 0.75, 1.5] }))), // fender swells
  ]);
  return merge([
    place(rbox(W, H * 0.5, L, 0.12, 1, 2), { at: [0, 0.32 + H * 0.25, 0] }),
    place(rbox(W * 0.99, H * 0.12, L * 0.99, 0.12, 1, 2), { at: [0, H * 0.9, 0] }),
    place(rbox(W + 0.06, 0.3, L + 0.04, 0.06, DARK), { at: [0, 0.36, 0] }), // a dark skirt
    place(rbox(W * 0.5, 0.3, L * 0.2, 0.06, DARK), { at: [0, H + 0.12, L * 0.15] }), place(rbox(W * 0.4, 0.22, L * 0.12, 0.05, DARK), { at: [0, H + 0.08, -L * 0.22] }), // roof units
    place(rbox(W + 0.02, 0.08, L * 0.98, 0.02, decal(1, 0.2, 0.6)), { at: [0, 0.32 + H * 0.5, 0] }), // a neon line
  ]);
}
function busGlass(look, W, L, H) {
  const band = look === 'manga' ? [W * 1.005, H * 0.26, L * 0.94, 0.25, H * 0.64] : [W * 1.005, H * 0.3, L * 0.97, 0.06, H * 0.66];
  const lamp = (x, c, r) => (look === 'manga' ? place(cyl(r, r, 0.06, c, 14), { at: [x, 0.62, -L / 2 - 0.04], rot: [Math.PI / 2, 0, 0] }) : place(rbox(r * 2.6, r, 0.06, 0.02, c), { at: [x, 0.62, -L / 2 - 0.02] }));
  return merge([place(rbox(band[0], band[1], band[2], band[3], GLASS, 2), { at: [0, band[4], 0] }),
    place(rbox(W * 0.9, H * 0.34, 0.08, look === 'manga' ? 0.3 : 0.05, GLASS), { at: [0, H * 0.6, -L / 2 - 0.02] }), // the windscreen
    lamp(-W / 2 + 0.35, [1.5, 1.45, 1.25], 0.13), lamp(W / 2 - 0.35, [1.5, 1.45, 1.25], 0.13),
    place(rbox(W * 0.6, 0.28, 0.06, 0.03, 0.08), { at: [0, H * 0.84, -L / 2 - 0.04] })]); // the destination box
}
function busWheel(look, R) {
  return merge([place(cyl(R, R, 0.36, 0.1, 18), { rot: [0, 0, Math.PI / 2] }),
    place(cyl(R * 0.6, R * 0.6, 0.37, 0.86, look === 'manga' ? 16 : 6), { rot: [0, 0, Math.PI / 2] })]);
}

/** { prims, hinges } for InstancedModel in a painted look, or null (bricks). hinges: from the brick model. */
export function lookBusPrims(look, model, hinges, { studM = 0.5, plateM = 0.2, palette } = {}) {
  if ((look !== 'manga' && look !== 'verse') || model.name !== 'bus') return null;
  const [si, sj, sk] = model.size, W = si * studM, L = sj * studM, H = sk * plateM, M = materials();
  const id = new THREE.Matrix4(), white = new THREE.Color(1, 1, 1);
  const srgb = palette?.get(LIVERY)?.srgb, base = new THREE.Color(srgb || '#C8102E');
  const body = busBody(look, W, L, H), glass = busGlass(look, W, L, H);
  const R = Math.max(0.3, Math.abs(Object.values(hinges)[0]?.y || 0.3) + 0.08), wheel = busWheel(look, R);
  const prims = [{ geometry: body, material: M.body, key: 'bus:body', matrix: id, part: '', color: LIVERY, base, glow: null },
    { geometry: glass, material: M.glass, key: 'bus:glass', matrix: id, part: '', color: -1, base: white, glow: null }];
  for (const part of Object.keys(hinges)) prims.push({ geometry: wheel, material: M.wheel, key: 'bus:wheel', matrix: id, part, color: -1, base: white, glow: null });
  return { prims, hinges };
}

/** The river boat in a painted look: a Group (pivot at the waterline, front -z), or null (bricks). */
export function lookBoat(look, model, { studM = 0.5, plateM = 0.2 } = {}) {
  if (look !== 'manga' && look !== 'verse') return null;
  const [si, sj] = model.size, W = si * studM, L = sj * studM, below = (model.pivot?.[2] || 3) * plateM;
  const M = materials(), g = new THREE.Group(), manga = look === 'manga';
  const hullMat = M.body.clone(); hullMat.color.set(manga ? '#f4f1ea' : '#1f8a9b'); hullMat.onBeforeCompile = M.body.onBeforeCompile; hullMat.customProgramCacheKey = M.body.customProgramCacheKey;
  const hl = L * 0.82, top = 1.0;
  const bow = place(new THREE.ConeGeometry(W / 2, L * 0.2, 4, 1), { at: [0, top / 2 - below / 2 + 0.05, -hl / 2 - L * 0.08], rot: [-Math.PI / 2, Math.PI / 4, 0], scale: [1, 1, 0.55] });
  const hull = merge([place(rbox(W, top + below, hl, manga ? 0.35 : 0.15, 1, 2), { at: [0, (top - below) / 2, 0] }), bow,
    place(rbox(W + 0.04, 0.18, hl * 0.98, 0.04, manga ? decal(0.06, 0.12, 0.35) : decal(1, 0.2, 0.6)), { at: [0, top * 0.55, 0] }), // the stripe
    place(rbox(W * 0.94, 0.06, hl * 0.96, 0.02, manga ? decal(0.55, 0.36, 0.2) : decal(0.2, 0.22, 0.26)), { at: [0, top + 0.03, 0] })]); // the deck
  g.add(new THREE.Mesh(hull, hullMat));
  const cab = (w, h, l, y, z, r) => place(rbox(w, h, l, r, manga ? 1 : decal(0.95, 0.95, 0.92), 2), { at: [0, y, z] });
  const cabins = merge([cab(W * 0.8, 1.3, hl * 0.62, top + 0.7, hl * 0.06, manga ? 0.4 : 0.08), cab(W * 0.6, 1.0, hl * 0.32, top + 1.95, hl * 0.1, manga ? 0.35 : 0.08),
    ...(manga ? [place(cyl(0.03, 0.03, 2.2, CHROME, 6), { at: [0, top + 3.2, hl * 0.1] })] // a flag mast
      : [place(rbox(W * 0.62, 0.08, hl * 0.33, 0.02, decal(0.2, 0.9, 1)), { at: [0, top + 2.47, hl * 0.1] })])]); // a neon roof edge
  const cabMat = manga ? hullMat : M.body;
  g.add(new THREE.Mesh(cabins, cabMat));
  const glass = merge([place(rbox(W * 0.82, 0.55, hl * 0.6, manga ? 0.25 : 0.04, GLASS), { at: [0, top + 0.85, hl * 0.06] }),
    place(rbox(W * 0.62, 0.45, hl * 0.3, manga ? 0.2 : 0.04, GLASS), { at: [0, top + 2.0, hl * 0.1] })]);
  g.add(new THREE.Mesh(glass, M.glass));
  const rail = []; // a rail round the upper deck
  for (const sx of [-1, 1]) rail.push(tube([sx * W * 0.4, top + 2.75, -hl * 0.08], [sx * W * 0.4, top + 2.75, hl * 0.28], 0.02, manga ? CHROME : DARK, 4));
  g.add(new THREE.Mesh(merge(rail), M.body));
  for (const m of g.children) { m.castShadow = true; m.receiveShadow = true; }
  g.userData.parts = {};
  return g;
}
