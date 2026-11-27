// The things you see in the city: golden studs (spinning, bobbing), plaque posts in front of
// landmarks and the little burst of gold bricks when a stud is collected. three.js only; the
// rules (what is near, what is touched) are in logic.js.
import * as THREE from 'three';

const SHOW_STUDS_M = 90; // studs are drawn within this distance of the camera
const SHOW_PLAQUES_M = 160;
const HOVER_M = 0.75; // stud centre above the ground

const gold = () => new THREE.MeshStandardMaterial({ color: 0xffc83a, metalness: 0.85, roughness: 0.22,
  emissive: 0x6a4300, emissiveIntensity: 0.55 });

/** One golden stud: a round 1x1 plate with its stud on top, stood up like a coin. */
function studGeometry() {
  const base = new THREE.CylinderGeometry(0.3, 0.3, 0.12, 28);
  const top = new THREE.CylinderGeometry(0.19, 0.19, 0.1, 24).translate(0, 0.11, 0);
  const g = mergeTwo(base, top);
  g.rotateX(Math.PI / 2);
  return g;
}

function mergeTwo(a, b) {
  const pos = [...a.attributes.position.array, ...b.attributes.position.array];
  const nor = [...a.attributes.normal.array, ...b.attributes.normal.array];
  const off = a.attributes.position.count;
  const idx = [...a.index.array, ...[...b.index.array].map((i) => i + off)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export class Props {
  /** studs / landmarks: data items (Unity at, y hint). city: groundHeight(x, zThree, fromY). */
  constructor(scene, studs, landmarks, city) {
    this.city = city;
    this.group = new THREE.Group();
    this.group.name = 'explore';
    scene.add(this.group);
    this.mat = gold();
    const sg = studGeometry();
    this.studs = studs.map((s, q) => {
      const m = new THREE.Mesh(sg, this.mat);
      m.position.set(s.at[0], s.y + HOVER_M, -s.at[1]);
      m.rotation.y = q * 1.7;
      m.castShadow = true;
      m.visible = false;
      this.group.add(m);
      return { data: s, mesh: m, ground: s.y, settled: false, phase: q * 0.9 };
    });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.8 });
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x8a6436, metalness: 0.6, roughness: 0.38 });
    const postG = new THREE.BoxGeometry(0.2, 0.95, 0.2).translate(0, 0.475, 0);
    const plateG = new THREE.BoxGeometry(0.64, 0.42, 0.05);
    this.plaques = landmarks.map((l) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(postG, postMat));
      const plate = new THREE.Mesh(plateG, plateMat);
      plate.position.set(0, 1.02, 0.04);
      plate.rotation.x = -0.45; // tilted back, face toward the reader
      g.add(plate);
      for (const c of g.children) { c.castShadow = true; c.receiveShadow = true; }
      // the plate faces away from its building: the reader looks at the landmark over it
      const dx = l.at[0] - l.anchor[0], dn = l.at[1] - l.anchor[1];
      g.rotation.y = Math.hypot(dx, dn) > 0.5 ? Math.atan2(dx, -dn) : 0;
      g.position.set(l.at[0], l.y, -l.at[1]);
      g.visible = false;
      this.group.add(g);
      return { data: l, obj: g, ground: l.y, settled: false };
    });
    this.burst = this.makeBurst();
    this.settleT = 0;
  }

  makeBurst() {
    const n = 16;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.07, 0.09), this.mat, n);
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, n, t: 1, at: new THREE.Vector3(), vel: Array.from({ length: n }, () => new THREE.Vector3()) };
  }

  /** Ground under a thing, once the streamed city knows it (else keep the picked height). */
  settle(item, x, z) {
    const g = this.city?.groundHeight?.(x, -z, item.ground + 2.5);
    if (typeof g === 'number' && Math.abs(g - item.ground) < 6) { item.ground = g; item.settled = true; }
    else if (g === null) item.settled = true; // no brick there: keep the picked height
  }

  /** got: { studId: time } collected; camera: THREE camera; t: seconds. */
  update(dt, t, camera, got) {
    const cx = camera.position.x, cz = camera.position.z;
    const settleNow = (this.settleT -= dt) <= 0;
    if (settleNow) this.settleT = 0.75;
    for (const s of this.studs) {
      const near = !got[s.data.id] && Math.hypot(s.data.at[0] - cx, -s.data.at[1] - cz) < SHOW_STUDS_M;
      s.mesh.visible = near;
      if (!near) continue;
      if (settleNow && !s.settled) this.settle(s, s.data.at[0], s.data.at[1]);
      s.mesh.rotation.y += dt * 2.2;
      s.mesh.position.y = s.ground + HOVER_M + 0.08 * Math.sin(t * 2.4 + s.phase);
    }
    for (const p of this.plaques) {
      const near = Math.hypot(p.data.at[0] - cx, -p.data.at[1] - cz) < SHOW_PLAQUES_M;
      p.obj.visible = near;
      if (near && settleNow && !p.settled) { this.settle(p, p.data.at[0], p.data.at[1]); p.obj.position.y = p.ground; }
    }
    this.stepBurst(dt);
  }

  /** The ground a stud stands on now (for the touch test). */
  studGround(id) { return this.studs.find((s) => s.data.id === id)?.ground; }

  /** Collected: the stud vanishes in a burst of little gold bricks. */
  pop(id) {
    const s = this.studs.find((x) => x.data.id === id);
    if (!s) return;
    s.mesh.visible = false;
    const b = this.burst;
    b.at.copy(s.mesh.position);
    b.t = 0;
    b.vel.forEach((v, q) => {
      const a = (q / b.n) * Math.PI * 2 + Math.random() * 0.4;
      v.set(Math.cos(a) * (1.2 + Math.random()), 2.6 + Math.random() * 1.8, Math.sin(a) * (1.2 + Math.random()));
    });
    b.mesh.visible = true;
  }

  stepBurst(dt) {
    const b = this.burst;
    if (b.t >= 1) return;
    b.t = Math.min(1, b.t + dt / 0.8);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const T = b.t * 0.8, k = Math.max(0.01, 1 - b.t);
    for (let i = 0; i < b.n; i++) {
      const v = b.vel[i];
      p.set(b.at.x + v.x * T, b.at.y + v.y * T - 4.9 * T * T, b.at.z + v.z * T);
      e.set(T * 7 + i, T * 5, 0);
      q.setFromEuler(e);
      sc.setScalar(k);
      b.mesh.setMatrixAt(i, m.compose(p, q, sc));
    }
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.t >= 1) b.mesh.visible = false;
  }

  setVisible(on) { this.group.visible = on; }
}
