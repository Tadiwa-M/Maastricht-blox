// The green "racing line" on the ground (trip guide): chevrons every SPACING metres along the
// walking route, lying on the street (the column top under the route, bridges included), flowing
// toward the target like the racing line in a driving game. One InstancedMesh; three.js only.

import * as THREE from 'three';

export const SPACING = 1.6; // m between chevrons
export const FLOW = 2.2; // m/s the chevrons drift toward the target
const MAX = 900;
const SAMPLE = 0.5; // route sampled this finely for ground heights

/** A flat chevron (pointing +z in its own frame), about 0.9 m wide, lying in the XZ plane. */
function chevronGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.45, -0.25); s.lineTo(0, 0.2); s.lineTo(0.45, -0.25); s.lineTo(0.45, 0.02); s.lineTo(0, 0.47); s.lineTo(-0.45, 0.02); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2); // into the ground plane, pointing -z (three.js forward = north)
  g.rotateY(Math.PI); // point +z in the instance frame; rotation.y turns it onto the path
  return g;
}

export class GroundLine {
  /** groundAt(x, zThree) -> y of the walkable surface. */
  constructor(scene, groundAt) {
    this.groundAt = groundAt;
    this.mat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.92, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(chevronGeometry(), this.mat, MAX);
    this.mesh.name = 'trip:line';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.path = null; this.offset = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** pts: route [[x, z], ...] in Unity metres (x east, z north), or null to hide. */
  set(pts) {
    if (!pts || pts.length < 2) { this.path = null; this.mesh.count = 0; return; }
    // resample finely, with the ground height at each sample (three.js: z = -north)
    const xs = [], ys = [], zs = [], ds = [];
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / SAMPLE));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const u = k / n, x = ax + (bx - ax) * u, z = -(az + (bz - az) * u);
        xs.push(x); zs.push(z); ys.push(this.groundAt(x, z)); ds.push(d + len * u);
      }
      d += len;
    }
    this.path = { xs, ys, zs, ds, total: d };
  }

  /** Point and heading at distance s along the path. */
  at(s) {
    const p = this.path, ds = p.ds;
    let lo = 0, hi = ds.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ds[m] <= s) lo = m; else hi = m; }
    const u = ds[hi] > ds[lo] ? (s - ds[lo]) / (ds[hi] - ds[lo]) : 0;
    return {
      x: p.xs[lo] + (p.xs[hi] - p.xs[lo]) * u, y: p.ys[lo] + (p.ys[hi] - p.ys[lo]) * u, z: p.zs[lo] + (p.zs[hi] - p.zs[lo]) * u,
      yaw: Math.atan2(p.xs[hi] - p.xs[lo], p.zs[hi] - p.zs[lo]),
    };
  }

  update(dt) {
    if (!this.path) return;
    this.offset = (this.offset + FLOW * dt) % SPACING;
    let n = 0;
    for (let s = this.offset; s < this.path.total && n < MAX; s += SPACING) {
      const a = this.at(s);
      if (!Number.isFinite(a.y)) continue;
      this._p.set(a.x, a.y + 0.07, a.z);
      this._q.setFromAxisAngle(this._up, a.yaw);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
