// Locomotion: how the body wants to move, before collision (pure JS, tested in
// test/player-locomotion.test.mjs).
//
// Third-person action games (Assassin's Creed, God of War) don't move a body by easing its
// velocity vector toward the stick: that strafes and slides, and the body turns separately. They
// keep a heading and a speed. The heading turns toward the wanted direction at a rate that drops
// with speed (a tight turn at a walk, a wide arc at a sprint); sharp turns cost speed; a hard
// reversal at speed plants the feet, brakes and pivots. Speed eases up and down with separate
// acceleration and braking. The facing is the heading, so feet always point where the body goes.
//
// Outputs for the animation: angVel (rad/s, + = clockwise) for banking into turns, accel (m/s²,
// smoothed) for leaning, steer (rad to the wanted direction) for the head look, pivoting.

import { angleDelta } from './look.js';

export const LOCO = {
  accel: 7.0, // m/s² speeding up
  brake: 10.0, // m/s² slowing down
  pivotBrake: 16.0, // m/s² while planting for a pivot
  turnStill: 14.0, // rad/s turning on the spot
  turnWalk: 9.0, // rad/s at walking pace
  turnSprint: 3.2, // rad/s at sprint pace
  sprint: 5.2, // m/s: the pace turnSprint applies to
  pivotAngle: 2.3, // rad (~130 deg): a reversal this sharp at speed plants and pivots
  pivotMinSpeed: 2.4, // m/s: slower than this just turns
  pivotDone: 0.7, // m/s: the pivot turns once braked below this
  sharpTurnCost: 0.55, // share of the speed kept in a 90 deg turn
};

const smooth = (cur, want, rate, dt) => cur + (want - cur) * Math.min(1, rate * dt);

export class Locomotion {
  constructor(o = {}) {
    this.o = { ...LOCO, ...o };
    this.speed = 0; this.heading = 0;
    this.angVel = 0; this.accel = 0; this.steer = 0;
    this.pivoting = false;
  }

  /** Turn rate (rad/s) at a speed. */
  turnRate(speed) {
    const o = this.o;
    if (speed < 0.3) return o.turnStill;
    const u = Math.min(1, Math.max(0, (speed - 1.4) / (o.sprint - 1.4)));
    return speed < 1.4 ? o.turnWalk + (o.turnStill - o.turnWalk) * (1 - speed / 1.4) : o.turnWalk + (o.turnSprint - o.turnWalk) * u;
  }

  /**
   * One step. want: compass radians to move toward, or null (no input); wantSpeed m/s;
   * grip 0..1 (1 on the ground, small in the air: less turning and acceleration).
   * Returns this (speed, heading, angVel, accel, steer, pivoting, vx, vz in three.js axes).
   */
  update(dt, want, wantSpeed, grip = 1) {
    const o = this.o;
    const h0 = this.heading, s0 = this.speed;
    let target = 0;
    if (want !== null && want !== undefined && wantSpeed > 0) {
      const d = angleDelta(this.heading, want);
      this.steer = d;
      if (!this.pivoting && Math.abs(d) > o.pivotAngle && this.speed > o.pivotMinSpeed && grip > 0.5) this.pivoting = true;
      if (this.pivoting) {
        target = 0;
        if (this.speed <= o.pivotDone) { // planted: swing round, then go
          this.heading = want;
          this.pivoting = false;
        }
      } else {
        const step = this.turnRate(this.speed) * grip * dt;
        this.heading += Math.max(-step, Math.min(step, d));
        const left = Math.abs(angleDelta(this.heading, want));
        // slow into sharp turns: full speed when aligned, sharpTurnCost at 90 deg
        const keep = 1 - (1 - o.sharpTurnCost) * Math.min(1, left / (Math.PI / 2));
        target = wantSpeed * keep;
      }
    } else {
      this.steer = smooth(this.steer, 0, 6, dt);
      this.pivoting = false;
    }
    const rate = this.pivoting ? o.pivotBrake : target > this.speed ? o.accel : o.brake;
    const ds = Math.max(-rate * grip * dt, Math.min(rate * grip * dt, target - this.speed));
    this.speed = Math.max(0, this.speed + ds);
    this.heading = ((this.heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (dt > 0) {
      this.angVel = smooth(this.angVel, angleDelta(h0, this.heading) / dt, 12, dt);
      this.accel = smooth(this.accel, (this.speed - s0) / dt, 8, dt);
    }
    return this;
  }

  get vx() { return Math.sin(this.heading) * this.speed; }
  get vz() { return -Math.cos(this.heading) * this.speed; }

  /** Collision cut the move short: speed drops to what was achieved (walls slow you). */
  blocked(achieved) { if (achieved < this.speed) this.speed = Math.max(0, achieved); }
}
