// Riding a parked bike (pure, tested in test/activities.test.mjs): which bike is in reach, the
// riding speeds the walk controller uses meanwhile, pedals and wheels turning with the distance
// ridden, and where the bike is left (beside the rider, pointing the way they rode).
// Bikes: { x, z (Unity metres), yaw (compass degrees), colour } as life/cyclists.js parkedBikes.

const DEG = Math.PI / 180;

/** Controller speeds while riding (m/s; walk is the cruising pace, run pedalling hard). */
export const RIDE = { walk: 4.6, run: 7.2, jumpSpeed: 0 };
export const CRANK_M = 5.2; // metres ridden per pedal turn (as the city's cyclists)

/** Nearest bike to Unity (x, z) within r: { bike, d } or null. Skips bikes marked `gone`. */
export function nearestBike(bikes, x, z, r = 2) {
  let best = null;
  for (const b of bikes) {
    if (b.gone || !Number.isFinite(b.x)) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d <= r && (!best || d < best.d)) best = { bike: b, d };
  }
  return best;
}

/** Pedal phase and wheel angle from the distance ridden. */
export class Pedals {
  constructor({ crankM = CRANK_M, wheelR = 0.34 } = {}) { Object.assign(this, { crankM, wheelR, dist: 0 }); }
  step(travelled) {
    this.dist += travelled;
    return { phase: (this.dist / this.crankM) * Math.PI * 2, spin: -this.dist / this.wheelR };
  }
}

/**
 * Getting off: the bike stays where it is, pointing the way it was ridden; the rider steps off to
 * the left. x, z: Unity feet, yaw: compass radians. -> { bike: { x, z, yaw (deg) }, step: { x, z } }.
 */
export function dismount(x, z, yaw, side = 0.6) {
  const lx = -Math.cos(yaw), lz = Math.sin(yaw); // left of a heading (compass: x east, z north)
  return { bike: { x, z, yaw: ((yaw / DEG) % 360 + 360) % 360 }, step: { x: x + lx * side, z: z + lz * side } };
}
