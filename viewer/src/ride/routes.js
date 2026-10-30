// The selected line's route drawn on the city: a flat ribbon a few metres wide floating just
// above the ground along each of the route's shapes (Timetable shapes: Unity x, north metres).
import * as THREE from 'three';

const WIDTH_M = 5, LIFT_M = 1.2;

/** Ribbon triangles along pts ([[x, north], ...]) at ground(x, zThree) + lift. Pure arrays. */
export function ribbonArrays(pts, ground, width = WIDTH_M, lift = LIFT_M) {
  const pos = [], idx = [];
  for (let q = 0; q < pts.length; q++) {
    const a = pts[Math.max(0, q - 1)], b = pts[Math.min(pts.length - 1, q + 1)];
    let dx = b[0] - a[0], dz = -(b[1] - a[1]);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const x = pts[q][0], z = -pts[q][1], y = ground(x, z) + lift;
    const ox = -dz * width / 2, oz = dx * width / 2; // left normal in three's x/z
    pos.push(x + ox, y, z + oz, x - ox, y, z - oz);
    if (q > 0) { const v = 2 * q; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
  }
  return { pos: new Float32Array(pos), idx };
}

export class RouteLines {
  constructor(scene, ground) {
    this.group = new THREE.Group();
    this.group.name = 'ride:routes';
    this.group.renderOrder = 5;
    this.ground = ground;
    scene.add(this.group);
  }

  /** shapes: Timetable shapes ([{ pts }]) or null to clear; colour: CSS colour. */
  show(shapes, colour = '#F2A900') {
    for (const c of this.group.children) c.geometry.dispose();
    this.group.clear();
    if (!shapes) return;
    const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    for (const sh of shapes) {
      const { pos, idx } = ribbonArrays(sh.pts, this.ground);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 5;
      this.group.add(m);
    }
  }
}
