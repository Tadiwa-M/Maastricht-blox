// The raiders of the night raid (owner: monsters, not smiling people): marl golems from the caves
// under Sint-Pietersberg. Hunched blocks of pale yellow stone, a head with no face but two glowing
// eye slits, long arms that swing as they lumber, moss in the cracks. One InstancedMesh per part
// (6 draw calls for any number); posed each frame from where the room says they are. Knocked out,
// one sinks and tips over into the ground.
import * as THREE from 'three';
import { OUTLINE_ON, outlineFor } from '../render/outline.js';

export const GOLEM = { scale: 1.3, cap: 32 };
const MARL = '#cdbb86', DARK = '#8f7f55';

function part(w, h, d, y = 0) { return new THREE.BoxGeometry(w, h, d).translate(0, y, 0); }

export class Golems {
  constructor(scene) {
    const stone = new THREE.MeshStandardMaterial({ color: MARL, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 1 });
    const eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.55, 0.15), toneMapped: false });
    const P = {
      torso: [part(0.9, 0.95, 0.6, 0.48), stone], // origin at the hips
      hips: [part(0.7, 0.35, 0.5, -0.12), dark],
      head: [part(0.48, 0.42, 0.46, 0.21), stone], // origin at the neck
      eyes: [mergeEyes(), eyes],
      arm: [part(0.26, 1.05, 0.28, -0.5), stone], // origin at the shoulder
      leg: [part(0.3, 0.62, 0.32, -0.31), dark], // origin at the hip joint
    };
    this.meshes = {};
    this.group = new THREE.Group(); this.group.name = 'golems';
    for (const [k, [g, m]] of Object.entries(P)) {
      const n = GOLEM.cap * (k === 'arm' || k === 'leg' ? 2 : 1);
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = k !== 'eyes';
      const outline = OUTLINE_ON && k !== 'eyes' ? outlineFor(mesh) : null;
      this.meshes[k] = { mesh, n: 0, outline };
      this.group.add(mesh);
      if (outline) this.group.add(outline);
    }
    scene.add(this.group);
    this._m = new THREE.Matrix4(); this._b = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
  }

  begin() { for (const e of Object.values(this.meshes)) e.n = 0; }

  put(k, m) { const e = this.meshes[k]; if (e.n < e.mesh.count + 9999 && e.n < e.mesh.instanceMatrix.count) e.mesh.setMatrixAt(e.n++, m); }

  /** One golem: feet (three.js), yaw (rotY), walk phase (rad), speed (m/s), down 0..1 (sinking). */
  add(x, y, z, rotY, phase, speed, down = 0) {
    const S = GOLEM.scale, sw = Math.min(1, speed / 3) * 0.6, t = phase;
    const body = this._b.compose(this._v.set(x, y - down * 1.2 * S, z), this._q.setFromEuler(this._e.set(down * 1.2, rotY, down * 0.4, 'YXZ')), this._s.setScalar(S));
    const at = (k, px, py, pz, rx = 0, rz = 0) => {
      this._m.compose(this._v.set(px, py, pz), this._q.setFromEuler(this._e.set(rx, 0, rz)), this._s.setScalar(1));
      this.put(k, this._m.premultiply(body));
    };
    const hipY = 0.62 + Math.abs(Math.sin(t)) * 0.04 * sw;
    at('leg', -0.18, hipY, 0, Math.sin(t) * sw); at('leg', 0.18, hipY, 0, -Math.sin(t) * sw);
    at('hips', 0, hipY, 0);
    at('torso', 0, hipY, 0.05, 0.35); // hunched forward
    const sh = hipY + 0.82;
    at('arm', -0.58, sh, -0.12, -Math.sin(t) * sw * 1.2 - 0.25, 0.08); at('arm', 0.58, sh, -0.12, Math.sin(t) * sw * 1.2 - 0.25, -0.08);
    at('head', 0, sh + 0.02, -0.3, 0.15); at('eyes', 0, sh + 0.02, -0.3, 0.15);
  }

  end() { for (const e of Object.values(this.meshes)) { e.mesh.count = e.n; e.mesh.instanceMatrix.needsUpdate = true; if (e.outline) e.outline.count = e.n; } }
}

function mergeEyes() { // two glowing slits on the front of the head (head origin at the neck, front -z)
  const a = new THREE.BoxGeometry(0.12, 0.04, 0.02).translate(-0.11, 0.25, -0.235);
  const b = new THREE.BoxGeometry(0.12, 0.04, 0.02).translate(0.11, 0.25, -0.235);
  const g = new THREE.BufferGeometry();
  const pa = a.toNonIndexed().attributes.position.array, pb = b.toNonIndexed().attributes.position.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
