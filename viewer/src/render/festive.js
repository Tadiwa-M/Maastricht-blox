// The festive light crowns Maastricht puts up from mid-November (owner's photos, Maagdendries
// and the Vrijthof): a pole with a white wire crown on top, bars rising from a ring and flaring
// out, strung with warm bulbs that glow at night (bloom picks them up). Geometry only; placed by
// life/roadlamps.js next to the old town's street lamps while render/season.js says festive.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CROWN = { pole: 3.6, height: 2.0, r0: 0.32, r1: 0.72, bars: 12, bulbs: 7 };

/** The pole and the white wire crown (one geometry, origin at the foot). */
export function crownFrame() {
  const parts = [new THREE.CylinderGeometry(0.05, 0.06, CROWN.pole, 8).translate(0, CROWN.pole / 2, 0)];
  const y0 = CROWN.pole;
  parts.push(new THREE.TorusGeometry(CROWN.r0, 0.02, 4, 16).rotateX(Math.PI / 2).translate(0, y0 + 0.05, 0));
  parts.push(new THREE.TorusGeometry((CROWN.r0 + CROWN.r1) / 2, 0.015, 4, 18).rotateX(Math.PI / 2).translate(0, y0 + CROWN.height * 0.45, 0));
  for (let k = 0; k < CROWN.bars; k++) {
    const a = (k / CROWN.bars) * Math.PI * 2, h = CROWN.height * (k % 2 ? 0.86 : 1);
    const pts = [0, 0.35, 0.7, 1].map((t) => { const r = CROWN.r0 + (CROWN.r1 - CROWN.r0) * t * t; return new THREE.Vector3(Math.cos(a) * r, y0 + 0.05 + h * t, Math.sin(a) * r); });
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.018, 4, false));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** The bulbs along the bars (small octahedra in one geometry). */
export function crownBulbs() {
  const parts = [];
  for (let k = 0; k < CROWN.bars; k++) {
    const a = (k / CROWN.bars) * Math.PI * 2, h = CROWN.height * (k % 2 ? 0.86 : 1);
    for (let b = 1; b <= CROWN.bulbs; b++) {
      const t = b / (CROWN.bulbs + 0.4), r = CROWN.r0 + (CROWN.r1 - CROWN.r0) * t * t;
      parts.push(new THREE.OctahedronGeometry(0.035).translate(Math.cos(a) * (r + 0.02), CROWN.pole + 0.05 + h * t, Math.sin(a) * (r + 0.02)));
    }
  }
  return mergeGeometries(parts);
}

const WARM = new THREE.Color(1.0, 0.72, 0.38);
/** Bulb colour for a night factor: cream by day, bright warm at night (above 1: it blooms). */
export function bulbColour(night, out = new THREE.Color()) { return out.copy(WARM).multiplyScalar(0.55 + 3.2 * night); }
