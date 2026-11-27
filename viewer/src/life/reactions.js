// People reacting to the player (walk mode), subtle and cheap: they turn to look when the player
// jumps or lands near them, step aside from a player running at them, and scatter a little
// after the player is knocked down by a vehicle. PlayerWatch turns the player's state, sampled
// once a frame, into those moments; Pedestrians.react (walkers.js) applies them to the groups
// near. Pure, tested in test/life.reactions.test.mjs.

export const REACT = {
  lookM: 7, // jumps and landings are noticed this far
  lookS: [1.2, 2.6], // how long people look (s), by person
  runSpeed: 2.6, // m/s: faster than this is running
  dodgeM: 3.2, // a runner heading for a group this close makes it step aside
  dodgeRate: 2.2, // m/s sideways
  scatterM: 10, // a knock-down this close scatters people
  startleS: 0.6, // they stop and look first
  fleeS: 2.8, // then hurry away
  fleePace: 1.7, // x walking speed
  airS: 0.3, // in the air at least this long for a landing to count
  contactM: 0.55, // the player's body and a person's touch (centre to centre)
  knockSpeed: 4.3, // m/s: running into someone faster than this (a sprint) knocks them over
  shoveM: 0.45, // a slower bump shoves them this far aside
  bumpS: 1.6, // a person bumped is left alone this long (no second bump while they recover)
};

/**
 * Running into a person: null (not touching, or barely moving), 'shove' (pushed aside, stumbles)
 * or 'knock' (sent flying, gets up again). p: the player { x, z, vx, vz, speed } (Unity m, m/s);
 * (mx, mz): the person. Only counts when the player moves toward them.
 */
export function contact(p, mx, mz, o = REACT) {
  const dx = mx - p.x, dz = mz - p.z, d = Math.hypot(dx, dz);
  if (d > o.contactM || p.speed < 0.8) return null;
  if (d > 0.05 && (dx * p.vx + dz * p.vz) / (d * p.speed) < 0.2) return null; // moving away or past
  return p.speed >= o.knockSpeed ? 'knock' : 'shove';
}

/** Player state for life from window.__bloxPlayer (walk mode only), or null. Unity metres. */
export function playerSample(pl) {
  if (!pl || pl.mode !== 'walk' || !pl.ctrl?.pos) return null;
  const c = pl.ctrl;
  return { x: c.pos[0], z: -c.pos[2], y: c.pos[1], grounded: !!c.grounded, vy: c.vel?.[1] ?? 0 };
}

export class PlayerWatch {
  constructor(o = {}) {
    this.o = { ...REACT, ...o };
    this.prev = null;
    this.air = 0;
    this.vx = 0; this.vz = 0;
  }

  /**
   * One frame: s = playerSample (or null), dt s, knocked: the player was hit this frame.
   * Returns { x, z, vx, vz, speed, running, events: [{ kind: 'jump' | 'land' | 'knock', x, z }] } or null.
   */
  sample(s, dt, knocked = false) {
    if (!s) { this.prev = null; this.air = 0; return null; }
    const p = this.prev, events = [];
    if (p && dt > 0) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 5) { // not a teleport (entering walk mode elsewhere)
        const k = Math.min(1, dt * 8); // smoothed: one long frame is not a sprint
        this.vx += ((s.x - p.x) / dt - this.vx) * k;
        this.vz += ((s.z - p.z) / dt - this.vz) * k;
      } else { this.vx = 0; this.vz = 0; }
      if (p.grounded && !s.grounded && s.vy > 2) events.push({ kind: 'jump', x: s.x, z: s.z });
      if (!p.grounded && s.grounded && this.air >= this.o.airS) events.push({ kind: 'land', x: s.x, z: s.z });
    }
    this.air = s.grounded ? 0 : this.air + dt;
    if (knocked) events.push({ kind: 'knock', x: s.x, z: s.z });
    this.prev = s;
    const speed = Math.hypot(this.vx, this.vz);
    return { x: s.x, z: s.z, vx: this.vx, vz: this.vz, speed, running: speed > this.o.runSpeed && s.grounded, events };
  }
}

/**
 * Is (px, pz) inside a footprint of a vehicle moving faster than minSpeed (m/s)? The same test
 * the player's knock-down uses (player/bump.js), on the speeds life already knows (f.v).
 */
export function hitByVehicle(px, pz, vehicles, minSpeed = 1.5, radius = 0.35) {
  for (const f of vehicles) {
    if (!(f.v > minSpeed)) continue;
    const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
    const dx = px - f.x, dz = pz - f.z;
    if (Math.abs(dx * fx + dz * fz) <= f.halfL + radius && Math.abs(dx * fz - dz * fx) <= f.halfW + radius) return true;
  }
  return false;
}

/**
 * Sideways step (metres to the walker's right, + or -) that takes a walker at (x, z) heading
 * (dirX, dirZ) off the line of a runner at (px, pz) moving (vx, vz); 0 when the runner is not
 * coming at it (behind, past, or too far off the line).
 */
export function dodgeSide(x, z, dirX, dirZ, px, pz, vx, vz, reach = REACT.dodgeM) {
  const sp = Math.hypot(vx, vz);
  if (sp < 0.1) return 0;
  const ux = vx / sp, uz = vz / sp, dx = x - px, dz = z - pz;
  const along = dx * ux + dz * uz; // ahead of the runner
  if (along < -0.3 || along > reach) return 0;
  const across = dx * uz - dz * ux; // + : to the runner's right
  if (Math.abs(across) > 1.4) return 0;
  const awayX = across >= 0 ? uz : -uz, awayZ = across >= 0 ? -ux : ux; // away from the runner's line
  const right = awayX * dirZ - awayZ * dirX; // walker's right = (dirZ, -dirX)
  return right >= 0 ? 1 : -1;
}

/** Yaw (degrees clockwise from north) from (x, z) to (tx, tz). */
export const yawTo = (x, z, tx, tz) => ((Math.atan2(tx - x, tz - z) * 180) / Math.PI + 360) % 360;
