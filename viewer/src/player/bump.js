// Contacts between the player and vehicles (pure JS, tested in test/player-bump.test.mjs).
//
// Vehicles come from the life system as footprints (Unity metres: x east, z north; yaw degrees,
// forward = (sin, cos); halfW/halfL). Their speed is not published, so it is measured: each
// footprint is matched to the nearest one of the same size in the previous frame. A vehicle
// creeping or parked pushes the player out to its nearer long side (you can't walk through a
// bus); one moving faster than KNOCK_SPEED knocks the player flying (the figure pops apart:
// scatter.js), along its travel direction and away from its centre line, upward.

export const KNOCK_SPEED = 1.5; // m/s
const RADIUS = 0.35; // the player's body

export class VehicleContacts {
  constructor() { this.prev = []; }

  /**
   * feet: [x, z] Unity metres; vehicles: footprints; dt s. Returns null, { push: [dx, dz] } or
   * { knock: [vx, vy, vz] } (Unity metres / s, y up).
   */
  check(feet, vehicles, dt) {
    const now = vehicles.map((v) => ({ ...v, speed: this.speedOf(v, dt) }));
    this.prev = vehicles.map((v) => ({ x: v.x, z: v.z, halfW: v.halfW, halfL: v.halfL }));
    for (const v of now) {
      const r = (v.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r); // forward; right = (fz, -fx)
      const hw = v.halfW + RADIUS, hl = v.halfL + RADIUS;
      const dx = feet[0] - v.x, dz = feet[1] - v.z;
      if (dx * dx + dz * dz > (hl + hw) * (hl + hw)) continue;
      const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (Math.abs(along) > hl || Math.abs(across) > hw) continue;
      const side = across >= 0 ? 1 : -1;
      if (v.speed > KNOCK_SPEED) {
        const k = Math.min(v.speed, 14);
        return { knock: [fx * k * 0.8 + fz * side * 2.5, 3.5 + k * 0.25, fz * k * 0.8 - fx * side * 2.5], speed: v.speed };
      }
      const push = side * hw - across;
      return { push: [fz * push, -fx * push] };
    }
    return null;
  }

  speedOf(v, dt) {
    if (!(dt > 0)) return 0;
    let best = Infinity;
    for (const p of this.prev) {
      if (Math.abs(p.halfW - v.halfW) > 1e-3 || Math.abs(p.halfL - v.halfL) > 1e-3) continue;
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < best) best = d;
    }
    return best < 4 ? best / dt : 0; // nothing nearby last frame: a new vehicle, assume still
  }
}

/** Footprints of everything driving near the player, from the life state (life/index.js). */
export function lifeVehicles(life, near, busHalf = [1.3, 6], trainHalf = [1.5, 12]) {
  if (!life) return [];
  const out = [];
  for (const b of life.vehicles || []) {
    const h = b.mode === 'rail' ? trainHalf : busHalf;
    out.push({ x: b.x, z: b.z, yaw: b.yaw, halfW: h[0], halfL: h[1] });
  }
  if (life.cars?.footprints) out.push(...life.cars.footprints(near, 30));
  return out;
}
