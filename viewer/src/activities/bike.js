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
  constructor({ crankM = CRANK_M, wheelR = 0.34 } = {}) { Object.assign(this, { crankM, wheelR, dist: 0, crank: 0 }); }
  /** travelled m; pedalling: the legs push (else the cranks stop level and the bike rolls). */
  step(travelled, pedalling = true, dt = 0) {
    this.dist += travelled;
    if (pedalling) this.crank += (travelled / this.crankM) * Math.PI * 2;
    else { // coasting: cranks settle level (feet side by side), as people do
      const rest = Math.round((this.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crank += (rest - this.crank) * Math.min(1, dt * 6);
    }
    return { phase: this.crank, spin: -this.dist / this.wheelR };
  }
}

/**
 * How the rider sits on a moving bike: bank (rad, roll into the turn, as physics wants: tan =
 * v * yaw rate / g, capped), standing (0..1: out of the saddle when pushing hard from slow), and a
 * side-to-side rock while standing. speed m/s, angVel rad/s (+ clockwise), accel m/s².
 */
export function riderLean(speed, angVel, accel, phase = 0) {
  const bank = Math.max(-0.45, Math.min(0.45, Math.atan((speed * angVel) / 9.81)));
  const standing = Math.max(0, Math.min(1, (accel - 1.2) / 1.0)) * (speed < 4.5 ? 1 : 0);
  return { bank, standing, rock: standing * 0.09 * Math.sin(phase) };
}

/**
 * Getting off: the bike stays where it is, pointing the way it was ridden; the rider steps off to
 * the left. x, z: Unity feet, yaw: compass radians. -> { bike: { x, z, yaw (deg) }, step: { x, z } }.
 */
export function dismount(x, z, yaw, side = 0.6) {
  const lx = -Math.cos(yaw), lz = Math.sin(yaw); // left of a heading (compass: x east, z north)
  return { bike: { x, z, yaw: ((yaw / DEG) % 360 + 360) % 360 }, step: { x: x + lx * side, z: z + lz * side } };
}
