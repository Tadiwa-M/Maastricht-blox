// Pop apart and snap back (the brick-game knock-down): when the player is hit by a vehicle or
// lands from a big fall, the figure's parts fly apart with the impulse, tumble, bounce on the
// street and settle; then they fly back and snap together at the body's landing spot.
// Pure maths on three.js matrices (no scene), tested in test/player-scatter.test.mjs.

import * as THREE from 'three';

export const SCATTER = { fly: 1.5, gather: 0.45, gravity: 18, bounce: 0.35, friction: 0.7, spread: 2.2, spin: 9 };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _p0 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _p1 = new THREE.Vector3();

export class Scatter {
  /**
   * parts: [{ key, mat, colourKey }] (rig.captureParts, three.js metres); impulse: [vx, vy, vz]
   * three.js m/s; ground(x, z) -> y | null; rand: () => [0, 1).
   */
  constructor(parts, impulse, ground, rand = Math.random, o = {}) {
    this.o = { ...SCATTER, ...o };
    this.ground = ground;
    this.t = 0;
    let cx = 0, cy = 0, cz = 0;
    for (const p of parts) { cx += p.mat[12]; cy += p.mat[13]; cz += p.mat[14]; }
    const n = Math.max(1, parts.length);
    cx /= n; cy /= n; cz /= n;
    this.bits = parts.map((p) => {
      _m.fromArray(p.mat).decompose(_p, _q, _s);
      const out = new THREE.Vector3(_p.x - cx, 0, _p.z - cz);
      if (out.lengthSq() < 1e-6) out.set(rand() - 0.5, 0, rand() - 0.5);
      out.normalize().multiplyScalar(this.o.spread * (0.5 + rand()));
      const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      return {
        key: p.key, colourKey: p.colourKey, scale: _s.clone(),
        pos: _p.clone(), rot: _q.clone(),
        vel: new THREE.Vector3(impulse[0] * (0.7 + 0.5 * rand()) + out.x, impulse[1] * (0.6 + 0.6 * rand()) + 1.5, impulse[2] * (0.7 + 0.5 * rand()) + out.z),
        axis, spin: this.o.spin * (0.5 + rand()), mat: new Float32Array(16),
        from: null, // gather start
      };
    });
  }

  get done() { return this.t >= this.o.fly + this.o.gather; }
  get gathering() { return this.t >= this.o.fly; }

  /** Centre of the pieces (three.js): the camera follows it. */
  centre() {
    const c = [0, 0, 0];
    for (const b of this.bits) { c[0] += b.pos.x; c[1] += b.pos.y; c[2] += b.pos.z; }
    return c.map((v) => v / Math.max(1, this.bits.length));
  }

  /**
   * Advance. targets: the posed parts where the figure reassembles (same order as the parts),
   * used while gathering. Returns the parts to draw: [{ key, mat, colourKey }].
   */
  update(dt, targets = null) {
    const o = this.o;
    this.t += dt;
    for (const b of this.bits) {
      if (this.t < o.fly) {
        b.vel.y -= o.gravity * dt;
        b.pos.addScaledVector(b.vel, dt);
        _q.setFromAxisAngle(b.axis, b.spin * dt);
        b.rot.premultiply(_q);
        const g = this.ground(b.pos.x, b.pos.z);
        if (typeof g === 'number' && b.pos.y < g + 0.04) { // bounce, lose energy, spin down
          b.pos.y = g + 0.04;
          if (b.vel.y < 0) b.vel.y *= -o.bounce;
          b.vel.x *= o.friction; b.vel.z *= o.friction;
          b.spin *= o.friction;
        }
      }
    }
    const gather = this.t >= o.fly && targets;
    const u = gather ? Math.min(1, (this.t - o.fly) / o.gather) : 0;
    const e = u * u * (3 - 2 * u); // ease in-out: a quick fly-in that settles
    return this.bits.map((b, i) => {
      if (gather) {
        if (!b.from) b.from = { pos: b.pos.clone(), rot: b.rot.clone() };
        _m.fromArray(targets[i].mat).decompose(_p1, _q1, _s);
        _p0.copy(b.from.pos).lerp(_p1, e);
        _p0.y += Math.sin(Math.PI * e) * 0.4; // a little arc on the way back
        _q0.copy(b.from.rot).slerp(_q1, e);
        _m.compose(_p0, _q0, b.scale);
      } else {
        _m.compose(b.pos, b.rot, b.scale);
      }
      _m.toArray(b.mat);
      return { key: b.key, mat: b.mat, colourKey: b.colourKey };
    });
  }
}
