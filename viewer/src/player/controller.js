// Kinematic character controller against the city query API (pure JS, no three.js).
//
// The body is a vertical cylinder (radius r, height h) standing on its feet point
// p = (x, y, z) in three.js metres (x east, y up, z = -north). Collision only asks
// city.isSolid(x, y, z) at sample points: a ring of 8 points + the centre, every 0.15 m up
// the body (finer than a 0.2 m plate). Anything that is not `false` counts as solid, so
// 'unknown' (unloaded) space is a wall and a floor: the player can never walk or fall into it.
//
// Per step: horizontal velocity eases toward the wanted velocity (acceleration), the move is
// split into sub-steps of at most 0.1 m and resolved one axis at a time (so the body slides
// along walls, also rotated island walls); a blocked axis tries to lift the body by up to
// stepMax (kerbs, stairs: 1-2 plates) and refuses anything higher (walls). Then gravity: the
// fall is sub-stepped too and lands exactly on the surface (bisection). Walking off a step
// snaps down to the lower surface instead of hopping. Yaw turns toward the move direction.

export const DEFAULTS = {
  radius: 0.25, height: 1.9, walk: 1.4, run: 4.0, accel: 12, airAccel: 3,
  gravity: 18, jumpSpeed: 4.4, stepMax: 0.42, turnRate: 12, maxFall: 30,
};

const RING = Array.from({ length: 8 }, (_, q) => [Math.cos((q * Math.PI) / 4), Math.sin((q * Math.PI) / 4)]);
const TAU = Math.PI * 2;

/** Shortest signed angle from a to b (radians). */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export class CharacterController {
  /** city: { isSolid(x, y, z) }. opts: see DEFAULTS. */
  constructor(city, opts = {}) {
    this.city = city;
    this.o = { ...DEFAULTS, ...opts };
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0; // compass radians, clockwise from north (forward = (sin, 0, -cos) in three.js)
    this.grounded = false;
    this.frozen = false;
    this.travelled = 0;
  }

  solid(x, y, z) { return this.city.isSolid(x, y, z) !== false; }

  /** Any body sample solid between heights y + from and y + to? */
  hits(x, y, z, from, to) {
    const r = this.o.radius * 0.98;
    for (let h = from; h <= to + 1e-9; h += 0.15) {
      const yy = y + Math.min(h, to);
      if (this.solid(x, yy, z)) return true;
      for (const [c, s] of RING) if (this.solid(x + c * r, yy, z + s * r)) return true;
    }
    return false;
  }

  /** Body overlaps something (feet excluded by 1 cm so standing on a surface is free). */
  bodyHits(x, y, z) { return this.hits(x, y, z, 0.01, this.o.height); }

  /** Something under the feet (within `depth` metres)? Uses the centre and an inner ring. */
  footSolid(x, y, z, depth = 0.03) {
    const r = this.o.radius * 0.7;
    if (this.solid(x, y - depth, z)) return true;
    for (const [c, s] of RING) if (this.solid(x + c * r, y - depth, z + s * r)) return true;
    return false;
  }

  /** Lowest y in [lo, hi] where the body is free (assumes hi is free): lands on surfaces. */
  settle(x, z, lo, hi) {
    for (let q = 0; q < 14; q++) {
      const mid = (lo + hi) / 2;
      if (this.bodyHits(x, mid, z)) lo = mid; else hi = mid;
    }
    return hi;
  }

  /** Place the feet at (x, y, z); lifts out of geometry (up to 4 m) if spawned inside. */
  spawn(x, y, z, yaw = this.yaw) {
    this.pos = [x, y, z];
    this.vel = [0, 0, 0];
    this.yaw = yaw;
    this.unstick();
    this.grounded = this.footSolid(...this.pos);
  }

  unstick() {
    const [x, y, z] = this.pos;
    if (!this.bodyHits(x, y, z)) return true;
    for (let up = 0.1; up <= 4; up += 0.1) {
      if (!this.bodyHits(x, y + up, z)) {
        this.pos[1] = this.settle(x, z, y + up - 0.1, y + up);
        return true;
      }
    }
    return false;
  }

  /** Try to move the feet horizontally by (dx, dz); returns true if (part of) it happened. */
  moveAxis(dx, dz) {
    const [x, y, z] = this.pos;
    const nx = x + dx, nz = z + dz;
    if (!this.bodyHits(nx, y, nz)) { this.pos[0] = nx; this.pos[2] = nz; return true; }
    if (!this.grounded) return false; // no stepping in mid-air
    for (let up = 0.05; up <= this.o.stepMax + 1e-9; up += 0.05) {
      if (!this.bodyHits(nx, y + up, nz)) {
        this.pos = [nx, this.settle(nx, nz, y, y + up), nz];
        return true;
      }
    }
    return false;
  }

  /**
   * input: { move: [x right, y forward] (|move| <= 1, already camera-relative compass is
   * given by camYaw), speed: wanted m/s, jump: bool }. camYaw: compass radians the camera
   * looks to. Returns { speed (m/s horizontal), travelled (m) }.
   */
  update(dt, { move = [0, 0], speed = 0, jump = false } = {}, camYaw = 0) {
    const o = this.o;
    const [x0, y0, z0] = this.pos;
    // never act inside unloaded space: wait until the city knows what is here
    this.frozen = this.city.isSolid(x0, y0 + 0.5, z0) === 'unknown';
    if (this.frozen || dt <= 0) return { speed: 0, travelled: 0 };
    if (this.bodyHits(x0, y0, z0)) this.unstick();

    const m = Math.min(1, Math.hypot(move[0], move[1]));
    let wx = 0, wz = 0;
    if (m > 1e-3) {
      const heading = camYaw + Math.atan2(move[0], move[1]);
      wx = Math.sin(heading) * speed * m; wz = -Math.cos(heading) * speed * m;
      this.yaw += angleDelta(this.yaw, heading) * Math.min(1, o.turnRate * dt);
      this.yaw = ((this.yaw % TAU) + TAU) % TAU;
    }
    const a = (this.grounded ? o.accel : o.airAccel) * dt;
    const ease = (v, w) => v + Math.max(-a * Math.max(speed, o.walk), Math.min(a * Math.max(speed, o.walk), w - v));
    this.vel[0] = ease(this.vel[0], wx);
    this.vel[2] = ease(this.vel[2], wz);

    if (jump && this.grounded) { this.vel[1] = o.jumpSpeed; this.grounded = false; }

    // horizontal, sub-stepped, axis by axis
    const dx = this.vel[0] * dt, dz = this.vel[2] * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    for (let q = 0; q < n; q++) {
      if (dx && !this.moveAxis(dx / n, 0)) this.vel[0] = 0;
      if (dz && !this.moveAxis(0, dz / n)) this.vel[2] = 0;
    }

    // vertical
    const wasGrounded = this.grounded;
    this.vel[1] = Math.max(-o.maxFall, this.vel[1] - o.gravity * dt);
    if (this.grounded && this.vel[1] < 0) this.vel[1] = 0;
    const [x, , z] = this.pos;
    if (this.vel[1] > 0) { // rising: stop at ceilings
      const up = this.vel[1] * dt;
      if (this.bodyHits(x, this.pos[1] + up, z)) this.vel[1] = 0; else this.pos[1] += up;
    }
    if (!this.footSolid(x, this.pos[1], z)) {
      // walked off something: snap down a step if there is one close below
      const y = this.pos[1];
      if (wasGrounded && this.vel[1] <= 0 && this.hits(x, y - o.stepMax - 0.01, z, 0, o.stepMax)) {
        this.pos[1] = this.settle(x, z, y - o.stepMax - 0.01, y);
      } else {
        this.grounded = false;
        const fall = this.vel[1] < 0 ? -this.vel[1] * dt : 0;
        const steps = Math.max(1, Math.ceil(fall / 0.1));
        for (let q = 0; q < steps; q++) {
          const yy = this.pos[1] - fall / steps;
          if (this.bodyHits(x, yy, z) || this.footSolid(x, yy, z, 0.001)) {
            this.pos[1] = this.settle(x, z, yy - 0.001, this.pos[1]);
            this.vel[1] = 0;
            break;
          }
          this.pos[1] = yy;
        }
      }
    }
    this.grounded = this.vel[1] <= 0 && this.footSolid(x, this.pos[1], z);
    if (this.grounded) this.vel[1] = 0;
    const travelled = Math.hypot(this.pos[0] - x0, this.pos[2] - z0);
    this.travelled += travelled;
    return { speed: travelled / dt, travelled };
  }
}
