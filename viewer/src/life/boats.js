// River cruise boats on the Maas: a loop up one side of the river and back down the other
// (keeping right), from life/river.json's centreline. Boat pivot = waterline (CONTRACT 7.1).
import { PathMover, poseToObject } from '../mover.js';
import { buildModel } from '../models.js';

/** Polyline [[x, z], ...] offset sideways by d metres (+ = right of the direction of travel). */
export function offsetLine(pts, d) {
  return pts.map((p, q) => {
    const a = pts[Math.max(0, q - 1)], b = pts[Math.min(pts.length - 1, q + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    return [p[0] + (dz / L) * d, p[1] - (dx / L) * d]; // right of north (+z) is east (+x)
  });
}

/** Closed loop: right lane forward, then the other bank's lane back. */
export function riverLoop(pts, lane) {
  return [...offsetLine(pts, lane), ...offsetLine([...pts].reverse(), lane)];
}

export class Boats {
  /** river: river.json doc. model: boat JSON. waterY: Unity y of the water surface. */
  constructor({ river, model, opts, waterY, count = 2 }) {
    const pts = [];
    for (let q = 0; q < river.path.length; q += 2) pts.push([river.path[q], river.path[q + 1]]);
    const lane = Math.min(18, (river.widthM || 100) * 0.22);
    const loop = riverLoop(pts, lane).map(([x, z]) => [x, waterY, z]);
    this.items = [];
    this.group = null;
    if (pts.length < 2) return;
    const L0 = new PathMover({ path: loop, loop: true }).length;
    for (let q = 0; q < count; q++) {
      const obj = buildModel(model, opts);
      obj.name = 'life:boat';
      this.items.push({ obj, mover: new PathMover({ path: loop, loop: true, speed: 3 + q * 0.4, turnRadius: 14, start: (L0 * q) / count + 40 }) });
    }
  }

  update(dt) {
    for (const b of this.items) poseToObject(b.mover.update(dt).pose, b.obj);
  }
}
