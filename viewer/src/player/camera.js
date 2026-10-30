// Third-person follow camera (pure math; the three.js camera is set by index.js).
//
// State: yaw (compass radians the camera looks toward), pitch (radians, + = camera above the
// focus looking down), distance (metres). Input moves an *aim* (aimYaw/aimPitch/aimDist);
// the shown yaw/pitch/want follow it through a critically damped spring (look.js smoothDamp),
// so pointer-lock deltas, sticks and touch drags all turn smoothly, also at 10 fps. Setting
// cam.yaw / cam.pitch / cam.want directly (URL hash, scripts) snaps both.
//
// The focus is the player's shoulder. The wanted camera point is focus - lookDir * distance;
// pullIn() marches a few parallel rays from the focus toward it through city.isSolid (centre +
// 4 offsets, i.e. a small box around the near plane) and stops short of the first solid
// sample, so walls between player and camera pull the camera in instead of being clipped.
// Unknown (unloaded) space does not block the camera. Pulling in is instant, easing back out
// is smooth (no popping when a wall passes).
import { PITCH, clamp, wrapAngle, applyLook, smoothDamp, smoothDampAngle, recenterYaw } from './look.js';

export const CAM = {
  minDist: 1.2, maxDist: 14, dist: 5, pitch: 0.22, minPitch: PITCH.min, maxPitch: PITCH.max, margin: 0.3, focusY: 1.6,
  turnTime: 0.05, zoomTime: 0.14, // smoothDamp times (s): rotation, distance
};

/** Unit vector from the focus to the camera (three.js axes) for a look yaw/pitch. */
export function backDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/**
 * Largest free distance <= want along dir from focus. city.isSolid: three.js metres.
 * Returns the distance the camera may sit at (>= 0.2).
 */
export function pullIn(city, focus, dir, want, { margin = CAM.margin, step = 0.1, spread = 0.18 } = {}) {
  // perpendicular offsets: horizontal right and the "up" of the view
  const right = [dir[2], 0, -dir[0]];
  const rl = Math.hypot(right[0], right[2]) || 1;
  right[0] /= rl; right[2] /= rl;
  const up = [dir[1] * right[2], dir[2] * right[0] - dir[0] * right[2], -dir[1] * right[0]]; // dir x right
  const offs = [[0, 0, 0], ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) =>
    [0, 1, 2].map((k) => (right[k] * a + up[k] * b) * spread))];
  let free = want;
  for (const o of offs) {
    for (let t = step; t <= free + margin; t += step) {
      const x = focus[0] + o[0] + dir[0] * t, y = focus[1] + o[1] + dir[1] * t, z = focus[2] + o[2] + dir[2] * t;
      if (city.isSolid(x, y, z) === true) { free = Math.min(free, t - margin); break; }
    }
  }
  return Math.max(0.2, free);
}

export class FollowCamera {
  constructor(opts = {}) {
    this.o = { ...CAM, ...opts };
    this.lim = { min: this.o.minPitch, max: this.o.maxPitch };
    this.vel = { yaw: 0, pitch: 0, dist: 0 };
    this.yaw = 0; this.pitch = this.o.pitch; this.want = this.o.dist;
    this.dist = this.o.dist; // after collision pull-in
  }

  // shown values; assigning snaps the aim too (no damping)
  get yaw() { return this._yaw; }
  set yaw(v) { this._yaw = this.aimYaw = wrapAngle(v); this.vel.yaw = 0; }
  get pitch() { return this._pitch; }
  set pitch(v) { this._pitch = this.aimPitch = clamp(v, this.lim.min, this.lim.max); this.vel.pitch = 0; }
  get want() { return this._want; }
  set want(v) { this._want = this.aimDist = clamp(v, this.o.minDist, this.o.maxDist); this.vel.dist = 0; }

  /** look: [dx, dy] radians (right / down positive as from a mouse), zoom: metres (+ = out). */
  input(look, zoom) {
    ({ yaw: this.aimYaw, pitch: this.aimPitch } = applyLook({ yaw: this.aimYaw, pitch: this.aimPitch }, look, this.lim));
    this.aimDist = clamp(this.aimDist + zoom, this.o.minDist, this.o.maxDist);
  }

  /** Ease the aim behind a player facing playerYaw (see look.js recenterYaw for opts). */
  recenter(playerYaw, opts) { this.aimYaw = recenterYaw(this.aimYaw, playerYaw, opts); }

  /** Jump the shown values to the aim (no easing). */
  snap() { this.yaw = this.aimYaw; this.pitch = this.aimPitch; this.want = this.aimDist; }

  /** feet: player feet [x, y, z]. Returns { focus, position } (three.js arrays). */
  update(city, feet, dt) {
    const o = this.o, v = this.vel;
    [this._yaw, v.yaw] = smoothDampAngle(this._yaw, this.aimYaw, v.yaw, o.turnTime, dt);
    [this._pitch, v.pitch] = smoothDamp(this._pitch, this.aimPitch, v.pitch, o.turnTime, dt);
    [this._want, v.dist] = smoothDamp(this._want, this.aimDist, v.dist, o.zoomTime, dt);
    const focus = [feet[0], feet[1] + o.focusY, feet[2]];
    const dir = backDir(this._yaw, this._pitch);
    const free = pullIn(city, focus, dir, this._want);
    this.dist = free < this.dist ? free : this.dist + (free - this.dist) * Math.min(1, dt * 4);
    const position = [0, 1, 2].map((k) => focus[k] + dir[k] * this.dist);
    return { focus, position };
  }
}

/**
 * "Zoom out to leave": people who walk in try to get back to the map the Google Maps way, by
 * scrolling or pinching out. Zoom-out input that arrives while the follow camera is already at
 * its farthest builds up; past `threshold` metres of it, update() says leave. Zooming in resets,
 * idle time drains it. progress() (0..1) drives a hint.
 */
export class ZoomOutExit {
  constructor({ threshold = 1.6, drain = 1.2 } = {}) { Object.assign(this, { threshold, drain, v: 0 }); }

  /** zoom: metres this frame (+ = out); atMax: camera already at its max distance. -> leave? */
  update(zoom, atMax, dt) {
    if (zoom < 0) this.v = 0;
    else if (zoom > 0 && atMax) this.v += zoom;
    else this.v = Math.max(0, this.v - this.drain * dt);
    return this.v >= this.threshold;
  }

  progress() { return Math.min(1, this.v / this.threshold); }
  reset() { this.v = 0; }
}
