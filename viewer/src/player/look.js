// Camera rotation math for walk and map mode (pure JS, no DOM, no three.js; tested in
// test/player-look.test.mjs).
//
// Conventions: yaw = compass radians the camera looks toward (0 north, + clockwise);
// pitch = radians, + = camera above the focus looking down. Look deltas are [dx, dy] radians,
// right / down positive like a mouse moving right / down (dy > 0 tilts the view down).

export const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Shortest signed angle from a to b (radians, -PI..PI). */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Wrap an angle to [-PI, PI) (yaw is unlimited, but never grows without bound). */
export function wrapAngle(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Pitch limits of the walk camera (radians): a little below the shoulder .. steeply down. */
export const PITCH = { min: -35 * DEG, max: 70 * DEG };

/**
 * Raw pointer movement (px) -> look radians. sens: multiplier of base rad/px;
 * invertY flips the vertical axis (mouse up = look down).
 */
export function mouseLook(dx, dy, { base = 0.003, sens = 1, invertY = false } = {}) {
  const k = base * sens;
  return [dx * k, dy * k * (invertY ? -1 : 1)];
}

/** Apply look radians to { yaw, pitch }: yaw wraps, pitch clamps. Returns a new object. */
export function applyLook({ yaw, pitch }, [dx, dy], lim = PITCH) {
  return { yaw: wrapAngle(yaw + dx), pitch: clamp(pitch + dy, lim.min, lim.max) };
}

/**
 * Compass heading of a move input relative to the camera: [x right, y forward] -> radians.
 * W (0, 1) walks where the camera looks, D (1, 0) to the camera's right.
 */
export function moveHeading(camYaw, [x, y]) {
  return wrapAngle(camYaw + Math.atan2(x, y));
}

/** Exponential approach factor for a rate (1/s) over dt: frame-rate independent. */
export const approach = (rate, dt) => 1 - Math.exp(-rate * dt);

/**
 * Critically damped spring toward target (Unity-style SmoothDamp). Returns [value, velocity].
 * Stable for any dt (no oscillation at 10 fps) and never overshoots the target.
 */
export function smoothDamp(cur, target, vel, smoothTime, dt) {
  if (dt <= 0) return [cur, vel];
  const st = Math.max(1e-4, smoothTime), w = 2 / st, x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cur - target, tmp = (vel + w * ch) * dt;
  let v = (vel - w * tmp) * e, out = target + (ch + tmp) * e;
  if ((target - cur > 0) === (out > target)) { out = target; v = 0; } // overshoot guard
  return [out, v];
}

/** smoothDamp for an angle: takes the short way round and returns a wrapped angle. */
export function smoothDampAngle(cur, target, vel, smoothTime, dt) {
  const [v, nv] = smoothDamp(cur, cur + angleDelta(cur, target), vel, smoothTime, dt);
  return [wrapAngle(v), nv];
}

/**
 * Gamepad right stick -> look radians this frame, with a response curve and a turn boost:
 * small deflections aim finely (|v|^expo), and holding the stick at full tilt for a moment
 * speeds the turn up (so a 180 does not take forever). Stateful: one per input source.
 */
export class StickLook {
  constructor(o = {}) {
    this.o = { yawRate: 3.2, pitchRate: 2.1, expo: 1.8, boost: 0.7, boostDelay: 0.25, boostRamp: 0.5, full: 0.92, ...o };
    this.held = 0;
  }

  /** x, y: deadzoned stick (-1..1, y down-positive). opts: { sens, invertY }. */
  step(x, y, dt, { sens = 1, invertY = false } = {}) {
    const o = this.o, m = Math.min(1, Math.hypot(x, y));
    if (m < 1e-6) { this.held = 0; return [0, 0]; }
    this.held = m >= o.full ? this.held + dt : 0;
    const boost = o.boost * clamp((this.held - o.boostDelay) / o.boostRamp, 0, 1);
    const k = (m ** o.expo / m) * sens * dt;
    return [x * k * o.yawRate * (1 + boost), y * k * o.pitchRate * (invertY ? -1 : 1)];
  }
}

/**
 * Gentle auto-recenter: after `delay` s without look input while walking forward-ish, ease the
 * camera yaw toward the player's facing (behind the player). Returns the new camera yaw.
 * moveAngle: angle of the move input from straight ahead (atan2(x, y)); walking toward the
 * camera or sideways does not recenter (that would chase the player in circles).
 */
export function recenterYaw(camYaw, playerYaw, { idle, moving, moveAngle = 0, dt, delay = 2, rate = 0.9, maxSpeed = 1.2 }) {
  if (!moving || idle < delay || Math.abs(moveAngle) > 50 * DEG) return camYaw;
  const ramp = clamp((idle - delay) / 1, 0, 1); // fade in over a second, no sudden pull
  const d = angleDelta(camYaw, playerYaw);
  const step = clamp(d * approach(rate, dt), -maxSpeed * dt, maxSpeed * dt) * ramp;
  return wrapAngle(camYaw + step);
}

/** Map orbit: take the damped share of a pending rotation this frame. Returns [taken, rest]. */
export function takeSpin(pending, dt, rate = 14) {
  const t = Math.abs(pending) < 1e-5 ? pending : pending * approach(rate, dt);
  return [t, pending - t];
}

/** Compass yaw of the view direction from a camera position to a target (three.js arrays). */
export function viewYaw(cam, target) {
  return Math.atan2(target[0] - cam[0], -(target[2] - cam[2]));
}
