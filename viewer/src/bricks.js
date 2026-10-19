// Turns a World into InstancedMeshes: one per (geometry, material key), per-instance colour.
import * as THREE from 'three';
import { bodyGeometry, studGeometry, INSET } from './geometry.js';
import { extent, footprintCell, studCells, ROT_MASK, NO_VARIATION } from './world.js';

const VARIATION = 0.03; // +-3 % value

export function hash3(I, J, K) {
  let h = Math.imul(I | 0, 0x8da6b343) ^ Math.imul(J | 0, 0xd8163841) ^ Math.imul(K | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function brickColor(world, n, out) {
  const e = world.palette.get(world.color[n]);
  out.set(e?.srgb || '#ff00ff');
  if (!(world.rotFlags[n] & NO_VARIATION)) {
    const f = 1 + (hash3(world.I[n], world.J[n], world.K[n]) * 2 - 1) * VARIATION;
    out.convertLinearToSRGB().multiplyScalar(f).convertSRGBToLinear();
  }
  return out;
}

class Bucket {
  constructor(geometry, material, key) {
    Object.assign(this, { geometry, material, key, mats: [], cols: [], owner: [] });
  }
  push(matrix, color, n) { this.mats.push(matrix.clone()); this.cols.push(color.clone()); this.owner.push(n); }
  build() {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.mats.length);
    for (let q = 0; q < this.mats.length; q++) {
      mesh.setMatrixAt(q, this.mats[q]);
      mesh.setColorAt(q, this.cols[q]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox?.();
    const transparent = this.material.transparent;
    mesh.castShadow = !transparent;
    mesh.receiveShadow = true;
    mesh.name = this.key;
    mesh.userData.owner = Int32Array.from(this.owner);
    return mesh;
  }
}

/** Build all brick + stud meshes. Returns { group, meshes, bricks, studs }. */
export function buildBrickMeshes(world, mats) {
  const S = world.studM, P = world.plateM;
  const buckets = new Map();
  const bucket = (key, geom, mat) => {
    if (!buckets.has(key)) buckets.set(key, new Bucket(geom, mat, key));
    return buckets.get(key);
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const studG = studGeometry();
  let studs = 0, bricks = 0;
  for (let n = 0; n < world.count; n++) {
    const t = world.types.get(world.type[n]);
    if (!t) continue;
    const rot = world.rotFlags[n] & ROT_MASK;
    const [ei, ej] = extent(t, rot);
    const I = world.I[n], J = world.J[n], K = world.K[n];
    const { key, material } = mats.forEntry(world.palette.get(world.color[n]));
    brickColor(world, n, col);
    pos.set((I + ei / 2) * S, K * P, -(J + ej / 2) * S);
    q.setFromAxisAngle(up, -rot * Math.PI / 2); // clockwise from above
    m4.compose(pos, q, one);
    bucket(`${t.name}|${key}`, bodyGeometry(t, { studM: S, plateM: P }), material).push(m4, col, n);
    bricks++;
    const topK = K + t.h;
    for (const [a, b] of studCells(t)) {
      const [di, dj] = footprintCell(t, rot, a, b);
      if (world.occupied(I + di, J + dj, topK)) continue;
      pos.set((I + di + 0.5) * S, topK * P - INSET, -(J + dj + 0.5) * S);
      m4.makeTranslation(pos.x, pos.y, pos.z);
      bucket(`stud|${key}`, studG, material).push(m4, col, n);
      studs++;
    }
  }
  const group = new THREE.Group();
  group.name = 'bricks';
  const meshes = [];
  for (const b of buckets.values()) {
    const mesh = b.build();
    group.add(mesh);
    meshes.push(mesh);
  }
  return { group, meshes, bricks, studs };
}
