// Small brick ducks (an original toy style: rounded blocks with two studs on the back) and the
// bread crumbs, as three InstancedMeshes (drakes, hens, crumbs): 3 draw calls at most, none when
// no duck is near. Origin: the waterline; front = -z (as the figures).
import * as THREE from 'three';
import { rbox, cyl, place, merge } from '../figure/geom.js';
import { figureMaterial } from '../figure/parts.js';
import { DUCK } from './ducks.js';

const DUCK_SCALE = 1.4; // a toy duck a little larger than life, to read at walking distance
const DRAKE = { body: [0.55, 0.55, 0.5], chest: [0.2, 0.08, 0.035], head: [0.02, 0.17, 0.06], beak: [0.85, 0.62, 0.06], tail: [0.04, 0.04, 0.05] };
const HEN = { body: [0.3, 0.17, 0.08], chest: [0.26, 0.15, 0.07], head: [0.24, 0.14, 0.065], beak: [0.78, 0.32, 0.04], tail: [0.18, 0.1, 0.05] };

function duckGeometry(c) {
  return merge([
    place(rbox(0.2, 0.13, 0.34, 0.03, c.body), { at: [0, 0.04, 0.01] }),
    place(rbox(0.19, 0.11, 0.09, 0.03, c.chest), { at: [0, 0.05, -0.14] }),
    place(rbox(0.1, 0.1, 0.12, 0.025, c.head), { at: [0, 0.17, -0.15] }),
    place(rbox(0.065, 0.025, 0.07, 0.01, c.beak), { at: [0, 0.155, -0.235] }),
    place(rbox(0.12, 0.05, 0.08, 0.015, c.tail), { at: [0, 0.11, 0.18], rot: [-0.5, 0, 0] }),
    place(cyl(0.032, 0.032, 0.025, c.body, 10), { at: [0, 0.115, -0.02] }), // studs
    place(cyl(0.032, 0.032, 0.025, c.body, 10), { at: [0, 0.115, 0.08] }),
  ]);
}

export class DuckMeshes {
  constructor({ cap = 8, crumbs = 32 } = {}) {
    const mat = figureMaterial();
    this.group = new THREE.Group();
    this.group.name = 'ducks';
    const mk = (geo, n, name) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.drakes = mk(duckGeometry(DRAKE), cap, 'duck:drake');
    this.hens = mk(duckGeometry(HEN), cap, 'duck:hen');
    this.bread = mk(merge([rbox(0.05, 0.022, 0.04, 0.008, [0.75, 0.52, 0.26])]), crumbs, 'duck:bread');
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._ds = new THREE.Vector3(DUCK_SCALE, DUCK_SCALE, DUCK_SCALE);
  }

  /** ducks: Ducks.visible(); crumbs: Ducks.crumbs; t: seconds (bobbing). Empty lists hide all. */
  draw(ducks, crumbs, t) {
    let nd = 0, nh = 0, nb = 0;
    for (const d of ducks) {
      const mesh = d.drake ? this.drakes : this.hens, i = d.drake ? nd : nh;
      if (i >= mesh.instanceMatrix.count) continue;
      const dab = d.eat > 0 ? Math.sin(Math.min(1, d.eat / 0.9) * Math.PI) * 0.9 : 0; // dabbling: nose down
      const bob = 0.012 * Math.sin(t * 2.1 + d.seed);
      this._e.set(-dab + 0.04 * Math.sin(t * 1.7 + d.seed), -d.h, 0.05 * Math.sin(t * 1.3 + d.seed * 2));
      this._m.compose(this._p.set(d.x, d.y + bob, d.z), this._q.setFromEuler(this._e), this._ds);
      mesh.setMatrixAt(i, this._m);
      if (d.drake) nd++; else nh++;
    }
    for (const c of crumbs) {
      if (nb >= this.bread.instanceMatrix.count) break;
      const u = Math.max(0, Math.min(1, c.t / DUCK.flight));
      const x = c.from[0] + (c.x - c.from[0]) * u, z = c.from[2] + (c.z - c.from[2]) * u;
      const y = u < 1 ? c.from[1] + (c.y - c.from[1]) * u + 1.2 * 4 * u * (1 - u) : c.y + 0.005 + 0.006 * Math.sin(t * 2 + c.x * 7);
      this._e.set(0, c.x * 13, 0);
      this._m.compose(this._p.set(x, y, z), this._q.setFromEuler(this._e), this._s);
      this.bread.setMatrixAt(nb++, this._m);
    }
    for (const [m, n] of [[this.drakes, nd], [this.hens, nh], [this.bread, nb]]) {
      m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true;
    }
  }
}
