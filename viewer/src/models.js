// Brick models (CONTRACT section 7.1): small brick assemblies that move as one object.
//
// buildModel turns a model JSON into a THREE.Group whose origin is the model's pivot
// (ground centre) and whose front faces -z (north) at yaw 0, so a pose from src/mover.js
// can be applied directly (poseToObject). Each named part becomes a child group placed at
// its pivot, so rotating that group (rotation.x = about the local i axis) swings the part
// about its hinge. Bricks use the same geometry and batching as the world.
import * as THREE from 'three';
import { BrickBatcher, brickColor, exposedStuds, glassEntry } from './bricks.js';
import { typeExtent, cellKey, ROT_MASK, NO_VARIATION, HIDE_STUDS } from './world.js';
import { gridToThree } from './placement.js';

const CABIN_GLOW = new THREE.Color('#ffd49a').multiplyScalar(0.3);

/** Occupied local cells of a model (for stud exposure). */
function modelCells(model, types) {
  const cells = new Set();
  for (const b of model.bricks) {
    const t = types.get(b.type);
    if (!t) continue;
    const [ei, ej] = typeExtent(t, b.rot & ROT_MASK);
    for (let k = 0; k < t.h; k++)
      for (let dj = 0; dj < ej; dj++)
        for (let di = 0; di < ei; di++) cells.add(cellKey(b.i + di, b.j + dj, b.k + k));
  }
  return cells;
}

/**
 * model: parsed contract/models/<name>.json. palette: Map idx -> entry. types: Map id ->
 * catalogue type. Returns a Group with userData.parts = { name: Group }.
 */
export function buildModel(model, { palette, types, mats, studM = 0.5, plateM = 0.2 }) {
  const cells = modelCells(model, types);
  const covered = (I, J, K) => cells.has(cellKey(I, J, K));
  const pivot = model.pivot || [0, 0, 0];
  const partNames = Object.keys(model.parts || {});
  const batches = new Map([['', new BrickBatcher(mats, studM, plateM)]]);
  for (const name of partNames) batches.set(name, new BrickBatcher(mats, studM, plateM));
  const glass = glassEntry(palette);
  const col = new THREE.Color();
  for (const b of model.bricks) {
    const t = types.get(b.type);
    if (!t) continue;
    const batch = batches.get(b.part && batches.has(b.part) ? b.part : '');
    batch.glassEntry = glass;
    const flags = b.rot || 0, rot = flags & ROT_MASK, exact = !!(flags & NO_VARIATION);
    const entry = palette.get(b.color);
    const lit = mats.classOf(entry) === 'glass' || ['window', 'door'].includes(t.kind);
    batch.addBrick({ I: b.i, J: b.j, K: b.k, t, rot, entry, exact, glow: lit ? CABIN_GLOW : null });
    if (flags & HIDE_STUDS) continue;
    brickColor(entry, b.i, b.j, b.k, exact, col);
    for (const [x, y, z] of exposedStuds(t, rot, b.i, b.j, b.k, covered)) batch.addStud(x, y, z, entry, col);
  }
  const root = new THREE.Group();
  root.name = `model:${model.name}`;
  const parts = {};
  for (const [name, batch] of batches) {
    const built = batch.build();
    const p = name ? model.parts[name].pivot : pivot;
    built.group.position.copy(gridToThree(-p[0], -p[1], -p[2], studM, plateM));
    if (!name) { root.add(built.group); continue; }
    const hinge = new THREE.Group(); // sits at the part pivot, relative to the model pivot
    hinge.name = `part:${name}`;
    hinge.position.copy(gridToThree(p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2], studM, plateM));
    hinge.add(built.group);
    root.add(hinge);
    parts[name] = hinge;
  }
  root.userData.parts = parts;
  root.userData.model = model;
  return root;
}
