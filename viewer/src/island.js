// Islands (CONTRACT 5.1): buildings on their own grid, turned by a yaw, placed as one rigid object.
//
// An island is loaded as its own World in LOCAL cells (I = i, J = j, K = global k). Everything
// that works on a World (occupancy grid, exterior flood fill, stud exposure, hidden-face
// culling, window glow, colour variation hashed on the cell, picking) then runs unchanged in
// island space; only the THREE.Group holding its meshes carries the pose.
//
// Pose: origin = Unity (x east, z north) of local cell (0, 0) min corner, yaw clockwise from
// north. Local +j points to (sin yaw, cos yaw) in (east, north), local +i to (cos yaw, -sin yaw).
// three.js has x = east, z = -north, and local cells map to three.js (u, y, -v) like chunks, so
// the group sits at (originX, 0, -originZ) turned by -yaw about +Y (clockwise from above is a
// negative angle about +Y in a right-handed y-up frame). test/island.test.mjs checks this
// against contract/test_vectors/islands.json.
import * as THREE from 'three';
import { parseBxi } from './bxi.js';
import { World, b64ToBytes } from './world.js';

const DEG = Math.PI / 180;

/** Local point (u along +i, v along +j, metres) -> Unity world [x east, z north]. */
export function localToWorld(origin, yawDeg, u, v) {
  const s = Math.sin(yawDeg * DEG), c = Math.cos(yawDeg * DEG);
  return [origin[0] + u * c + v * s, origin[1] - u * s + v * c];
}

/** Rotation about three.js +Y for an island yaw (clockwise from north). */
export const yawToThreeY = (yawDeg) => -yawDeg * DEG;

/** Put an Object3D at an island pose (its children are in island-local three.js coords). */
export function applyIslandPose(obj, origin, yawDeg) {
  obj.position.set(origin[0], 0, -origin[1]);
  obj.rotation.set(0, yawToThreeY(yawDeg), 0);
  obj.updateMatrix();
  obj.updateMatrixWorld(true);
  return obj;
}

/** World of one island from its parsed file (local cells). meta as for World. */
export function islandWorld(meta, { header: h, records: r }) {
  const w = new World(meta);
  w.allocate(h.brickCount);
  for (let q = 0; q < h.brickCount; q++) {
    w.I[q] = r.i[q]; w.J[q] = r.j[q]; w.K[q] = r.k[q];
    w.type[q] = r.type[q]; w.color[q] = r.color[q];
    w.rotFlags[q] = r.rotFlags[q]; w.feature[q] = r.feature[q];
  }
  w.finish();
  w.island = { id: h.islandId, cx: h.cx, cy: h.cy, origin: [h.originX, h.originZ], yawDeg: h.yawDeg };
  return w;
}

/** Islands embedded by build.mjs ({ file name: base64 }) -> [World with .island]. */
export async function loadIslands(data) {
  const out = [];
  for (const b64 of Object.values(data.islands || {})) {
    const w = islandWorld(data, await parseBxi(b64ToBytes(b64)));
    if (w.count) out.push(w);
  }
  return out;
}

/** Matrix island-local three.js -> world three.js. */
export function islandMatrix(island) {
  return applyIslandPose(new THREE.Object3D(), island.origin, island.yawDeg).matrixWorld.clone();
}

/** Island-local three.js box of a World's bounds. */
export function localBox(world) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const S = world.studM, P = world.plateM;
  return new THREE.Box3(new THREE.Vector3(I0 * S, K0 * P, -J1 * S), new THREE.Vector3(I1 * S, K1 * P, -J0 * S));
}

/** Axis-aligned world three.js box around an island. */
export function islandWorldBox(world) {
  return localBox(world).applyMatrix4(islandMatrix(world.island));
}

/**
 * Facing (rot 0..3, local frame) that most window/door pieces of the island look to: the
 * street side. Falls back to rot 2 (local -j).
 */
export function mainFacing(world) {
  const n4 = [0, 0, 0, 0];
  for (let n = 0; n < world.count; n++) {
    const kind = world.typeOf(n)?.kind;
    if (kind === 'window' || kind === 'door') n4[world.rot(n)] += kind === 'door' ? 4 : 1;
  }
  const best = n4.indexOf(Math.max(...n4));
  return n4[best] ? best : 2;
}

/**
 * World three.js point or direction -> island-local three.js (inverse pose; pure math, so
 * picking can run in island space). Returns { x, y, z }.
 */
export function worldToLocalThree(island, p, isDirection = false) {
  const s = Math.sin(island.yawDeg * DEG), c = Math.cos(island.yawDeg * DEG);
  const dx = p.x - (isDirection ? 0 : island.origin[0]);
  const dz = -p.z - (isDirection ? 0 : island.origin[1]); // Unity z = -three z
  const u = dx * c - dz * s, v = dx * s + dz * c;
  return { x: u, y: p.y, z: -v };
}
