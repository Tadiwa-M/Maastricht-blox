// Turns brick records into a few InstancedMeshes: one per (geometry, material) pair.
//
// BrickBatcher is shared by the world, the piece gallery and the brick models: callers add
// bricks in grid coordinates and the batcher groups identical geometry + material so a
// whole city is drawn in a handful of draw calls. Per-instance data: transform, colour
// (with a small deterministic variation) and, for glass, the night glow colour.
import * as THREE from 'three';
import { bodyParts, studGeometry, INSET } from './geometry.js';
import { typeExtent, typeCell, studCells, ROT_MASK, NO_VARIATION, HIDE_STUDS } from './world.js';
import { brickMatrix, gridToThree } from './placement.js';
import { hash3 } from './hash.js';
import { brickColor } from './bricks-color.js';
import { exteriorAir, occupancyGrid } from './exterior.js';
import { cellCodeOf } from './farmesh.js';
import { windowGlow } from './glow.js';

export { hash3, brickColor };
const BLACK = new THREE.Color(0, 0, 0);

/**
 * Grid positions [I, J, K] (fractional, stud base centre) of the studs a brick shows.
 * covered(I, J, K) says whether the cell above a stud hides it.
 */
export function exposedStuds(t, rot, I, J, K, covered) {
  const top = K + t.h, out = [];
  if (t.studs === 'center') { // jumper: one stud centred on the whole footprint
    const [ei, ej] = typeExtent(t, rot);
    for (let dj = 0; dj < ej; dj++) for (let di = 0; di < ei; di++) if (covered(I + di, J + dj, top)) return out;
    out.push([I + ei / 2, J + ej / 2, top]);
    return out;
  }
  for (const [a, b] of studCells(t)) {
    const [di, dj] = typeCell(t, rot, a, b);
    if (!covered(I + di, J + dj, top)) out.push([I + di + 0.5, J + dj + 0.5, top]);
  }
  return out;
}

class Bucket {
  constructor(geometry, material, key) {
    Object.assign(this, { geometry, material, key, mats: [], cols: [], glow: null });
  }
  push(matrix, color, glow) {
    this.mats.push(matrix.clone());
    this.cols.push(color.clone());
    if (glow) (this.glow ||= new Array(this.mats.length - 1).fill(BLACK)).push(glow);
    else if (this.glow) this.glow.push(BLACK);
  }
  build() {
    let geometry = this.geometry;
    if (this.glow) { // per-instance glow: needs its own copy of the geometry
      geometry = geometry.clone();
      geometry.userData.owned = true; // freed with the mesh (src/lod.js)
      const a = new Float32Array(this.glow.length * 3);
      this.glow.forEach((c, q) => c.toArray(a, q * 3));
      geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(a, 3));
    }
    const mesh = new THREE.InstancedMesh(geometry, this.material, this.mats.length);
    this.mats.forEach((m, q) => { mesh.setMatrixAt(q, m); mesh.setColorAt(q, this.cols[q]); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = !this.material.transparent;
    mesh.receiveShadow = true;
    mesh.name = this.key;
    return mesh;
  }
}

export class BrickBatcher {
  /** lite: cheaper bevels and studs (src/geometry.js), used by the near LOD below high quality. */
  constructor(mats, studM, plateM, lite = false) {
    Object.assign(this, { mats, S: studM, P: plateM, lite, buckets: new Map(), bricks: 0, studs: 0 });
    this.glassEntry = null; // palette entry used for window/door panes
  }

  bucket(geometry, material, key) {
    const k = `${geometry.uuid}|${key}`;
    if (!this.buckets.has(k)) this.buckets.set(k, new Bucket(geometry, material, key));
    return this.buckets.get(k);
  }

  /** One brick: body in its material (+ panes in glass). glow: night colour for glass. */
  addBrick({ I, J, K, t, rot, entry, exact = false, glow = null }) {
    const { key, material, cls } = this.mats.forEntry(entry);
    const seamless = cls === 'glass' || cls === 'water';
    const parts = bodyParts(t, this.S, this.P, seamless, this.lite);
    const m4 = brickMatrix(I, J, K, t.w, t.d, rot, this.S, this.P);
    const col = brickColor(entry, I, J, K, exact);
    this.bucket(parts.body, material, `${t.name}|${key}`).push(m4, col, cls === 'glass' ? glow : null);
    if (parts.glass) {
      const g = this.glassEntry || entry;
      const gm = this.mats.forEntry(g);
      this.bucket(parts.glass, gm.material, `${t.name}:pane|${gm.key}`).push(m4, brickColor(g, I, J, K, true), glow);
    }
    this.bricks++;
  }

  /** One stud at grid position (I, J, K) = centre of its base. */
  addStud(I, J, K, entry, color) {
    const { key, material } = this.mats.forEntry(entry);
    const p = gridToThree(I, J, K, this.S, this.P);
    const m4 = new THREE.Matrix4().makeTranslation(p.x, p.y - INSET, p.z);
    this.bucket(studGeometry(this.lite), material, `stud|${key}`).push(m4, color, null);
    this.studs++;
  }

  build() {
    const group = new THREE.Group();
    const meshes = [];
    for (const b of this.buckets.values()) {
      const mesh = b.build();
      group.add(mesh);
      meshes.push(mesh);
    }
    return { group, meshes, bricks: this.bricks, studs: this.studs };
  }
}

/** First palette entry with the glass material (window panes use it). */
export function glassEntry(palette) {
  for (const e of palette.values()) if (e.material === 'glass') return e;
  return null;
}

/**
 * Load-time facts shared by every mesh build of a World: the occupancy grid (with the cell
 * codes the far LOD needs), which air is outside (stud exposure) and the window glow colours.
 */
export function worldContext(world, mats) {
  const codeOf = cellCodeOf(world, (e) => mats.classOf(e));
  const grid = occupancyGrid(world, codeOf);
  const outside = exteriorAir(world, grid);
  return {
    grid, codeOf,
    covered: (I, J, K) => world.occupied(I, J, K) || !outside(I, J, K),
    glows: windowGlow(world, (n) => mats.classOf(world.palette.get(world.color[n])) === 'glass'),
    glassEntry: glassEntry(world.palette),
  };
}

/**
 * Build bricks (all, or the brick numbers in `list`) and their visible studs.
 * Returns { group, meshes, bricks, studs }; stud meshes are named 'stud|...'.
 */
export function buildWorldMeshes(world, mats, { list = null, ctx = worldContext(world, mats), lite = false } = {}) {
  const batch = new BrickBatcher(mats, world.studM, world.plateM, lite);
  batch.glassEntry = ctx.glassEntry;
  const col = new THREE.Color();
  const count = list ? list.length : world.count;
  for (let q = 0; q < count; q++) {
    const n = list ? list[q] : q;
    const t = world.typeOf(n);
    if (!t) continue;
    const I = world.I[n], J = world.J[n], K = world.K[n], flags = world.rotFlags[n];
    const entry = world.palette.get(world.color[n]);
    const exact = !!(flags & NO_VARIATION);
    batch.addBrick({ I, J, K, t, rot: flags & ROT_MASK, entry, exact, glow: ctx.glows.get(n) });
    if (flags & HIDE_STUDS) continue;
    brickColor(entry, I, J, K, exact, col);
    for (const [x, y, z] of exposedStuds(t, flags & ROT_MASK, I, J, K, ctx.covered)) batch.addStud(x, y, z, entry, col);
  }
  return batch.build();
}
