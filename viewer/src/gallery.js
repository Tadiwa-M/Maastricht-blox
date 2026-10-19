// Piece gallery (#view=gallery): every catalogue piece at all four facings, to check
// geometry and rotation by eye. Records are made here in JS (not by the pipeline), with
// the same facing rule every caller should use: say N/E/S/W, never a raw rot.
//
// Each piece stands on a grey baseplate; a yellow 1x1 tile is placed two studs in front
// of it (in the direction its FRONT should face). If a piece's decorated side does not
// look at its yellow marker, its geometry or rotation is wrong.
// Options: #view=gallery&ids=38-47 (or ids=29,30,46) shows only those types.
import * as THREE from 'three';
import { World } from './world.js';
import { FACING_NAMES, facingToRot, rotatedExtent, frontDir } from './rotation.js';
import { label } from './labels.js';

const SLOT = 11, ROW = 13, ORIGIN = 64;
const BASE = { type: 23, color: 9 };                  // plate_4x4, light grey
const MARKER = { type: 24, color: 37 };               // tile_1x1, signal yellow
const COLOR_BY_KIND = { slope: 13, slope_double: 14, arch: 1, window: 8, door: 7, fence: 11,
  round: 20, round_tile: 43, jumper: 44, tile_grille: 10, tile: 21, plate: 41, brick: 4 };

/** "38-47" or "29,30,46" -> Set of ids (null = all). */
export function parseIds(spec) {
  if (!spec) return null;
  const ids = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let id = a; id <= (b || a); id++) ids.add(id);
  }
  return ids;
}

/** Record for type t placed with its FRONT facing `facing`, centred in a slot. */
function place(t, facing, cI, cJ, K) {
  const rot = facingToRot(facing);
  const [ei, ej] = rotatedExtent(t.w, t.d, rot);
  const I = cI - Math.floor(ei / 2), J = cJ - Math.floor(ej / 2);
  const [fi, fj] = frontDir(rot);
  // marker: two cells beyond the middle of the front edge
  const mI = fi > 0 ? I + ei + 1 : fi < 0 ? I - 2 : I + Math.floor((ei - 1) / 2);
  const mJ = fj > 0 ? J + ej + 1 : fj < 0 ? J - 2 : J + Math.floor((ej - 1) / 2);
  return [{ I, J, K, type: t.id, color: COLOR_BY_KIND[t.kind] ?? 4, rot },
    { I: mI, J: mJ, K, type: MARKER.type, color: MARKER.color, flags: 4 }];
}

/** Builds { world, labels (THREE.Group) } from the embedded palette + catalogue. */
export function galleryWorld(meta, ids) {
  const types = meta.catalogue.types.filter((t) => !ids || ids.has(t.id));
  const cols = types.length > 24 ? 4 : types.length > 12 ? 3 : types.length > 3 ? 2 : 1, rows = Math.ceil(types.length / cols);
  const width = cols * 4 * SLOT, depth = rows * ROW;
  const recs = [];
  for (let J = 0; J < depth; J += 4)
    for (let I = 0; I < width; I += 4) recs.push({ I: ORIGIN + I, J: ORIGIN + J, K: 0, ...BASE });
  const labels = new THREE.Group();
  const S = 0.5, P = 0.2;
  types.forEach((t, q) => {
    const col = q % cols, row = Math.floor(q / cols);
    const J = ORIGIN + depth - (row + 1) * ROW + 6; // first row at the north (back)
    FACING_NAMES.forEach((f, s) => {
      const I = ORIGIN + (col * 4 + s) * SLOT + 5;
      recs.push(...place(t, f, I, J, 1));
      labels.add(label(f, new THREE.Vector3((I + 0.5) * S, 0.35, -(J - 5) * S), 0.8));
    });
    const lI = ORIGIN + col * 4 * SLOT + 2 * SLOT;
    labels.add(label(`${t.id} ${t.name}`, new THREE.Vector3(lI * S, (t.h + 4) * P, -(J + 5.5) * S), 0.9));
  });
  const world = World.fromRecords({ ...meta, features: { features: [] } }, recs);
  return { world, labels };
}
