// Movement along paths (CONTRACT section 7.1): a path + a distance -> a pose.
//
// PathMover walks a polyline given in Unity metres ([x, z] or [x, y, z]; x east, z north).
// A pose is { position: [x, y, z] Unity metres, yaw: degrees clockwise from north }.
// Corners are smoothed with a simple, predictable rule: imagine a vehicle whose front and
// rear axles are both on the path, turnRadius metres ahead of and behind the point s.
// The heading is the direction rear -> front, the position is their midpoint. On straight
// stretches this is exactly the path; at corners it cuts a smooth curve.
// WalkCycle swings leg/arm parts and WheelSpin rolls wheel parts, both about the part's
// local i axis (CONTRACT 7.1).
// Nothing here touches three.js except poseToObject, so it is easy to test.

export class PathMover {
  /**
   * path: [[x, z] | [x, y, z], ...] Unity metres. speed: m/s. loop: closed path (wraps)
   * or open (stops at the end). turnRadius: metres of corner smoothing. start: metres.
   */
  constructor({ path, speed = 2, loop = true, turnRadius = 2, start = 0 }) {
    const pts = path.map((p) => (p.length === 2 ? [p[0], 0, p[1]] : [...p]));
    if (loop) pts.push(pts[0]);
    this.pts = pts;
    this.cum = [0];
    for (let q = 1; q < pts.length; q++) {
      const [a, b] = [pts[q - 1], pts[q]];
      this.cum.push(this.cum[q - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
    }
    this.length = this.cum[this.cum.length - 1];
    Object.assign(this, { speed, loop, turnRadius, s: start, moving: true });
  }

  /** Point on the polyline at distance s (wrapped for loops, clamped for open paths). */
  pointAt(s) {
    const L = this.length;
    s = this.loop ? ((s % L) + L) % L : Math.min(Math.max(s, 0), L);
    let q = 1;
    while (q < this.cum.length - 1 && this.cum[q] < s) q++;
    const a = this.pts[q - 1], b = this.pts[q];
    const f = (s - this.cum[q - 1]) / (this.cum[q] - this.cum[q - 1] || 1);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  /** Pose at distance s along the path. */
  poseAt(s) {
    const h = Math.max(this.turnRadius, 1e-3);
    const back = this.pointAt(s - h), front = this.pointAt(s + h);
    let dx = front[0] - back[0], dz = front[2] - back[2];
    if (Math.hypot(dx, dz) < 1e-6) { // degenerate (end of an open path): use the last segment
      const p = this.pointAt(s - 2 * h); dx = back[0] - p[0]; dz = back[2] - p[2];
    }
    const yaw = ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
    const position = [0, 1, 2].map((a) => (back[a] + front[a]) / 2);
    return { position, yaw };
  }

  /** Advance by dt seconds; returns { pose, travelled metres }. */
  update(dt) {
    const before = this.s;
    if (this.moving) this.s += this.speed * dt;
    if (!this.loop) this.s = Math.min(this.s, this.length);
    return { pose: this.poseAt(this.s), travelled: this.s - before };
  }
}

/** Apply a Unity pose to a three.js Object3D (x, y, -z; clockwise yaw = negative about y). */
export function poseToObject(pose, obj) {
  obj.position.set(pose.position[0], pose.position[1], -pose.position[2]);
  obj.rotation.set(0, (-pose.yaw * Math.PI) / 180, 0);
}

/** Leg/arm swing for walking figures. parts: { leg_l, leg_r, arm_l, arm_r } Object3Ds. */
export class WalkCycle {
  constructor(parts, { stride = 0.7, swingDeg = 32 } = {}) {
    Object.assign(this, { parts, stride, swing: (swingDeg * Math.PI) / 180, phase: 0 });
  }

  /** travelled: metres moved this frame; speed: m/s (swing fades out when standing). */
  update(travelled, speed) {
    this.phase += (travelled / this.stride) * Math.PI;
    const a = Math.sin(this.phase) * this.swing * Math.min(1, speed / 1.0);
    const set = (name, angle) => { if (this.parts[name]) this.parts[name].rotation.x = angle; };
    set('leg_l', a); set('leg_r', -a); set('arm_l', -a * 0.8); set('arm_r', a * 0.8);
    return a;
  }
}

/** Spins wheel parts (names starting with "wheel") so they roll without slipping. */
export class WheelSpin {
  /** parts: { name: Object3D }; radiusOf(name) -> wheel radius in metres. */
  constructor(parts, radiusOf) {
    this.wheels = Object.entries(parts).filter(([n]) => n.startsWith('wheel')).map(([n, o]) => [o, radiusOf(n)]);
  }

  /** travelled metres -> each wheel turns travelled / radius radians (forward = -x turn). */
  update(travelled) {
    for (const [o, r] of this.wheels) o.rotation.x -= travelled / Math.max(r, 0.05);
  }
}
