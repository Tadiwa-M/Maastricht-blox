// Motion state of the player's figure (pure JS, tested in test/player-motion.test.mjs): turns
// what the body is doing (speed, turning, accelerating, airborne, landing) into the rig's motion
// fields (figure/rig.js: blend, lean, bank, air, dip, look) and advances the stride.
//
// Patterns from third-person action games: the walk fades in and out with speed (no pop between
// standing and walking); the gait itself is motion-captured (figure/gait.js) and its stride
// length grows with speed as a real person's does, so feet don't skate; the body leans
// into acceleration and back when braking, and banks into turns (more at speed); the head leads
// the turn toward where you steer; a jump tucks the legs; a landing dips the hips and knees in
// proportion to the fall.

import { MODE } from '../figure/rig.js';
import { strideAt } from '../figure/gait.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (cur, want, rate, dt) => cur + (want - cur) * Math.min(1, rate * dt);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Stride (m per step, before the figure's scale) at a speed: from the motion capture (figure/gait.js). */
export { strideAt };

export class MotionState {
  constructor() {
    this.speed = 0; this.phase = 0; this.t = 0;
    this.lean = 0; this.bank = 0; this.look = 0; this.air = 0; this.dip = 0;
    this.wasGrounded = true; this.fallSpeed = 0; this.idle = 0;
  }

  /**
   * dt s; s: { speed m/s, travelled m, angVel rad/s (+ clockwise), accel m/s², steer rad,
   * grounded, vy m/s (vertical velocity) }; scale: the figure's size. Returns the pose fields.
   */
  update(dt, s, scale = 1) {
    this.t += dt;
    this.speed = smooth(this.speed, s.speed, 10, dt);
    this.phase += (s.travelled / (strideAt(this.speed) * scale)) * Math.PI;
    // lean: forward into acceleration, back when braking hard (the captured run already leans)
    const wantLean = clamp(s.accel * 0.025, -0.12, 0.16);
    this.lean = smooth(this.lean, wantLean, 8, dt);
    // bank into turns: centripetal acceleration v * omega, capped (rotY is -yaw, so roll the other way)
    const wantBank = clamp(-(this.speed * s.angVel) * 0.022, -0.22, 0.22);
    this.bank = smooth(this.bank, wantBank, 7, dt);
    // standing still for a while: the head looks around now and then (an idle fidget)
    this.idle = s.speed < 0.1 && s.grounded ? this.idle + dt : 0;
    const fidget = this.idle > 3 ? 0.55 * Math.sin((this.idle - 3) * 0.9) * Math.max(0, Math.sin((this.idle - 3) * 0.31)) : 0;
    this.look = smooth(this.look, clamp(s.steer || 0, -0.7, 0.7) * 0.6 + fidget, 6, dt);
    // airborne and landing
    if (!s.grounded) this.fallSpeed = Math.max(this.fallSpeed, -s.vy);
    const wantAir = s.grounded ? 0 : 1;
    this.air = smooth(this.air, wantAir, s.grounded ? 14 : 8, dt);
    if (s.grounded && !this.wasGrounded) this.dip = clamp(this.fallSpeed / 7, 0.15, 1); // harder fall, deeper dip
    if (s.grounded) this.fallSpeed = 0;
    this.dip = smooth(this.dip, 0, 6, dt);
    this.wasGrounded = s.grounded;
    return {
      mode: MODE.WALK, phase: this.phase, speed: Math.max(this.speed, 0.6), t: this.t,
      blend: smoothstep(0.05, 0.9, this.speed), lean: this.lean, bank: this.bank, look: this.look,
      air: this.air, dip: this.dip,
    };
  }
}
