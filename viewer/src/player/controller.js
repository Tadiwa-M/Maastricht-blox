// Kinematic character controller against the city query API (pure JS, no three.js).
//
// The body is a vertical cylinder (radius r, height h) standing on its feet point
// p = (x, y, z) in three.js metres (x east, y up, z = -north). Collision only asks
// city.isSolid(x, y, z) at sample points: a ring of 8 points + the centre, every 0.15 m up
// the body (finer than a 0.2 m plate). Anything that is not `false` counts as solid, so
// 'unknown' (unloaded) space is a wall and a floor: the player can never walk or fall into it.
//
// Per step: locomotion.js turns the heading toward the wanted direction (arcs, pivots) and eases
// the speed; the body faces its heading. The move is split into sub-steps of at most 0.1 m and resolved one axis at a time (so the body slides
// along walls, also rotated island walls); a blocked axis tries to lift the body by up to
// stepMax (kerbs, stairs: 1-2 plates) and refuses anything higher (walls). Then gravity: the
// fall is sub-stepped too and lands exactly on the surface (bisection). Walking off a step
// snaps down to the lower surface instead of hopping. The wanted direction is camera-relative
// (look.js moveHeading: W walks where the camera looks).

import { angleDelta, moveHeading } from './look.js';
import { Locomotion } from './locomotion.js';

export { angleDelta };

export const DEFAULTS = {
  radius: 0.35, height: 1.9, walk: 1.5, run: 5.0,
  // jump: a quick rise and a faster fall (fallGravity), cut short when the button is let go early
  // (jumpCut: share of the upward speed kept); apex ~0.72 m, ~0.62 s in the air on flat ground
  gravity: 20, fallGravity: 30, jumpSpeed: 5.4, jumpCut: 0.45,
  coyote: 0.12, // s after walking off an edge in which a jump still counts
  jumpBuffer: 0.14, // s a jump pressed just before landing is remembered
  stepEase: 16, // 1/s: how fast the drawn height catches up after a kerb or stair (visualY)
  stepMax: 0.42, maxFall: 30, waterProbe: 8, airGrip: 0.35,
};

const RING = Array.from({ length: 8 }, (_, q) => [Math.cos((q * Math.PI) / 4), Math.sin((q * Math.PI) / 4)]);

export class CharacterController {
  /** city: { isSolid(x, y, z), isWater?(x, y, z) }. opts: see DEFAULTS. */
  constructor(city, opts = {}) {
    this.city = city;
    this.o = { ...DEFAULTS, ...opts };
    this.pos = [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0; // compass radians, clockwise from north (forward = (sin, 0, -cos) in three.js)
    this.loco = new Locomotion();
    this.grounded = false;
    this.frozen = false;
    this.travelled = 0;
    this.sinceGround = 1e9; // s since the feet last stood on something (coyote time)
    this.jumpWanted = 1e9; // s since jump was last pressed (jump buffering)
    this.jumping = false; // rising from a jump (not a fall or a knock)
    this.jumped = false; // a jump started this step (sound, animation)
    this.stepLag = 0; // m the drawn body is below (-) / above (+) the collision body after a step
  }

  /** Height to draw the feet at: the body's, eased over kerbs and stairs (no 1-frame pops). */
  get visualY() { return this.pos[1] + this.stepLag; }

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

  /** Body overlaps something (the lowest 2 mm excluded so standing on a surface is free). */
  bodyHits(x, y, z) { return this.hits(x, y, z, 0.002, this.o.height); }

  /** Something under the feet (within `depth` metres)? Centre + the body ring. */
  footSolid(x, y, z, depth = 0.03) {
    const r = this.o.radius * 0.98; // same ring as the body: resting on a ledge edge is standing
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
    this.loco.heading = yaw; this.loco.speed = 0; this.loco.pivoting = false;
    this.stepLag = 0; this.sinceGround = 1e9; this.jumpWanted = 1e9; this.jumping = false;
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

  /**
   * Would the feet end up on water at (x, z)? The first solid cell below the feet (within
   * waterProbe metres: a quay above the river) is a water brick. Water bricks are solid in the
   * query API (movers float on them), so without this the player walks on the river.
   */
  onWater(x, y, z) {
    if (!this.city.isWater) return false;
    for (let d = 0.05; d <= this.o.waterProbe; d += 0.2) {
      if (this.solid(x, y - d, z)) return this.city.isWater(x, y - d, z) === true;
    }
    return false;
  }

  /** Try to move the feet horizontally by (dx, dz); returns true if (part of) it happened. */
  moveAxis(dx, dz) {
    const [x, y, z] = this.pos;
    const nx = x + dx, nz = z + dz;
    // the river is a wall at the bank (decks are not water: bridges stay walkable); once in the
    // water (spawned there, or fallen in), any move is allowed so the player can get out
    if (this.grounded && this.onWater(nx, y, nz) && !this.onWater(x, y, z)) return false;
    if (!this.bodyHits(nx, y, nz)) { this.pos[0] = nx; this.pos[2] = nz; return true; }
    if (!this.grounded) return false; // no stepping in mid-air
    for (let up = 0.05; up <= this.o.stepMax + 1e-9; up += 0.05) {
      if (!this.bodyHits(nx, y + up, nz)) {
        const ny = this.settle(nx, nz, y, y + up);
        this.stepLag -= ny - y; // the drawn body rises smoothly behind
        this.pos = [nx, ny, nz];
        return true;
      }
    }
    return false;
  }

  /**
   * input: { move: [x right, y forward] (|move| <= 1, already camera-relative compass is
   * given by camYaw), speed: wanted m/s, jump: pressed this step, jumpHeld: still held (default: yes;
   * letting go early makes a lower hop) }. camYaw: compass radians the camera
   * looks to. Returns { speed (m/s horizontal), travelled (m) }.
   */
  /** A burst of speed (m/s east, north in three.js x, z) for s seconds on top of walking; walls still stop it. */
  dash(vx, vz, s) { this.boost = [vx, vz]; this.boostT = s; }

  update(dt, { move = [0, 0], speed = 0, jump = false, jumpHeld = true } = {}, camYaw = 0) {
    const o = this.o;
    const [x0, y0, z0] = this.pos;
    // never act inside unloaded space: wait until the city knows what is here
    this.frozen = this.city.isSolid(x0, y0 + 0.5, z0) === 'unknown';
    if (this.frozen || dt <= 0) return { speed: 0, travelled: 0 };
    if (this.bodyHits(x0, y0, z0)) this.unstick();

    // where the body wants to go (heading, turn arcs, pivots, eased speed: locomotion.js); the
    // facing is the heading, so the body never slides sideways
    const m = Math.min(1, Math.hypot(move[0], move[1]));
    const want = m > 1e-3 ? moveHeading(camYaw, move) : null;
    const loco = this.loco;
    loco.update(dt, want, speed * m, this.grounded ? 1 : o.airGrip);
    this.yaw = loco.heading;
    this.vel[0] = loco.vx;
    this.vel[2] = loco.vz;
    if (this.boostT > 0) { this.boostT -= dt; this.vel[0] += this.boost[0]; this.vel[2] += this.boost[1]; } // a dash (dash())

    // jump: forgiving on both sides. Pressed a moment before landing it is remembered (buffer);
    // pressed a moment after walking off an edge it still counts (coyote time).
    this.jumpWanted = jump ? 0 : this.jumpWanted + dt;
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    this.jumped = false;
    if (this.jumpWanted <= o.jumpBuffer && this.sinceGround <= o.coyote && !this.jumping) {
      this.vel[1] = o.jumpSpeed; this.grounded = false;
      this.jumping = this.jumped = true;
      this.jumpWanted = this.sinceGround = 1e9;
    }
    if (this.jumping && !jumpHeld && this.vel[1] > 0) { this.vel[1] *= o.jumpCut; this.jumping = false; } // let go: a short hop
    if (this.vel[1] <= 0) this.jumping = false;

    // horizontal, sub-stepped, axis by axis
    const dx = this.vel[0] * dt, dz = this.vel[2] * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
    const [hx, , hz] = this.pos;
    let stopped = false;
    for (let q = 0; q < n; q++) {
      if (dx && !this.moveAxis(dx / n, 0)) { this.vel[0] = 0; stopped = true; }
      if (dz && !this.moveAxis(0, dz / n)) { this.vel[2] = 0; stopped = true; }
    }
    if (stopped && dt > 0) loco.blocked(Math.hypot(this.pos[0] - hx, this.pos[2] - hz) / dt); // walls slow you down

    // vertical
    const wasGrounded = this.grounded;
    this.vel[1] = Math.max(-o.maxFall, this.vel[1] - (this.vel[1] > 0 ? o.gravity : o.fallGravity) * dt);
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
        this.stepLag += y - this.pos[1]; // the drawn body comes down smoothly
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
    if (this.grounded) { // rest exactly on the surface, not hovering within the foot tolerance
      this.vel[1] = 0;
      this.pos[1] = this.settle(x, z, this.pos[1] - 0.035, this.pos[1]);
    }
    // the drawn height catches up (faster when moving fast, so stairs at a run don't sink the body)
    const lagMax = o.stepMax + 0.1;
    this.stepLag = Math.max(-lagMax, Math.min(lagMax, this.stepLag));
    this.stepLag *= Math.exp(-(o.stepEase + 2.5 * loco.speed) * dt);
    if (Math.abs(this.stepLag) < 1e-4) this.stepLag = 0;
    const travelled = Math.hypot(this.pos[0] - x0, this.pos[2] - z0);
    this.travelled += travelled;
    return { speed: travelled / dt, travelled };
  }
}
