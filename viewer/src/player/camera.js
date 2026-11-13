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
// Unknown (unloaded) space does not block the camera. Thin things (lamp posts, trunks, signs:
// a solid run under `thin` metres with free space on both sides) are looked past, so walking by a pole does not punch the
// camera in and out. Pulling in is quick but eased (pullRate), and the camera waits a moment
// (outHold) before easing back out, so a wall passing by never pops the view.
import { PITCH, clamp, wrapAngle, applyLook, smoothDamp, smoothDampAngle, recenterYaw, approach } from './look.js';

export const CAM = {
  minDist: 1.2, maxDist: 14, dist: 5, pitch: 0.22, minPitch: PITCH.min, maxPitch: PITCH.max, margin: 0.3, focusY: 1.6,
  turnTime: 0.05, zoomTime: 0.14, // smoothDamp times (s): rotation, distance
  // God of War style: the player sits left of centre (camera over the right shoulder), the
  // camera trails the body a little, and pulls back and widens when sprinting
  shoulder: 0.5, followTime: 0.09, sprintFrom: 3.0, sprintBack: 1.1, fov: 55, sprintFov: 9,
  pullRate: 30, outHold: 0.3, outTime: 0.35, thin: 0.55, // collision pull-in (1/s), wait and ease back out (s), posts ignored (m)
};

/**
 * Vertical FOV (degrees) for a screen aspect (width / height). Landscape keeps `vfov`; on narrow
 * (portrait phone) screens it widens so the view is at least `minHfov` across, up to `maxVfov`,
 * instead of the tunnel view a fixed vertical FOV gives there.
 */
export function fitFov(vfov, aspect, { minHfov = 62, maxVfov = 78 } = {}) {
  const r = Math.PI / 180;
  const need = 2 * Math.atan(Math.tan((minHfov * r) / 2) / Math.max(0.1, aspect)) / r;
  return Math.max(vfov, Math.min(maxVfov, need));
}

/** Share of the shoulder offset kept on a screen of this aspect: full on landscape, less on portrait. */
export function shoulderScale(aspect) { return Math.min(1, Math.max(0.35, aspect / 1.3)); }

/** Unit vector from the focus to the camera (three.js axes) for a look yaw/pitch. */
export function backDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), Math.cos(yaw) * c];
}

/**
 * Largest free distance <= want along dir from focus. city.isSolid: three.js metres.
 * Returns the distance the camera may sit at (>= 0.2).
 */
export function pullIn(city, focus, dir, want, { margin = CAM.margin, step = 0.1, spread = 0.18, thin = 0 } = {}) {
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
      if (city.isSolid(x, y, z) !== true) continue;
      if (thin > 0 && t + thin + margin < free) { // a post? look past it unless the camera would sit in it
        let end = t + step;
        while (end <= t + thin + 1e-9 && city.isSolid(focus[0] + o[0] + dir[0] * end, focus[1] + o[1] + dir[1] * end, focus[2] + o[2] + dir[2] * end) === true) end += step;
        const mid = (t + end - step) / 2, px = focus[0] + o[0] + dir[0] * mid, py = focus[1] + o[1] + dir[1] * mid, pz = focus[2] + o[2] + dir[2] * mid;
        // thin along the view and free on both sides: a post, not a thin wall
        if (end <= t + thin + 1e-9 && city.isSolid(px + right[0] * 0.6, py, pz + right[2] * 0.6) !== true
          && city.isSolid(px - right[0] * 0.6, py, pz - right[2] * 0.6) !== true) { t = end; continue; }
      }
      free = Math.min(free, t - margin); break;
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
    this.side = this.o.shoulder; // shoulder offset after wall checks
    this.trail = null; this.vtrail = [0, 0, 0]; // lagging follow point
    this.sprint = 0; this.fov = this.o.fov;
    this.held = 0; this.vdist = 0; // s since the view was last blocked; ease-out velocity
    this.aspect = 16 / 9; // screen width / height (index.js keeps it current)
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
  snap() { this.yaw = this.aimYaw; this.pitch = this.aimPitch; this.want = this.aimDist; this.trail = null; }

  /**
   * feet: player feet [x, y, z]; speed: the player's m/s (sprint pull-back and FOV).
   * Returns { focus, position, fov } (three.js arrays, degrees).
   */
  update(city, feet, dt, speed = 0) {
    const o = this.o, v = this.vel;
    [this._yaw, v.yaw] = smoothDampAngle(this._yaw, this.aimYaw, v.yaw, o.turnTime, dt);
    [this._pitch, v.pitch] = smoothDamp(this._pitch, this.aimPitch, v.pitch, o.turnTime, dt);
    [this._want, v.dist] = smoothDamp(this._want, this.aimDist, v.dist, o.zoomTime, dt);
    // trail the body a little (the camera follows, it isn't welded on)
    if (!this.trail || dt >= 0.5) { this.trail = [...feet]; this.vtrail = [0, 0, 0]; }
    else for (const k of [0, 2]) [this.trail[k], this.vtrail[k]] = smoothDamp(this.trail[k], feet[k], this.vtrail[k], o.followTime, dt);
    this.trail[1] = feet[1];
    this.sprint += (Math.min(1, Math.max(0, (speed - o.sprintFrom) / 2)) - this.sprint) * Math.min(1, dt * 3);
    this.fov = fitFov(o.fov + o.sprintFov * this.sprint, this.aspect);
    const head = [this.trail[0], this.trail[1] + o.focusY, this.trail[2]];
    // over the right shoulder, unless a wall is there
    const right = [Math.cos(this._yaw), 0, Math.sin(this._yaw)];
    const sh = o.shoulder * shoulderScale(this.aspect);
    const side = sh > 0 ? Math.min(sh, pullIn(city, head, right, sh, { margin: 0.25, spread: 0.1 })) : 0;
    this.side += (side - this.side) * (side < this.side ? 1 : Math.min(1, dt * 4));
    const focus = [head[0] + right[0] * this.side, head[1], head[2] + right[2] * this.side];
    const dir = backDir(this._yaw, this._pitch);
    const free = pullIn(city, focus, dir, this._want + o.sprintBack * this.sprint, { thin: o.thin });
    if (free < this.dist - 1e-3) { // blocked: in quickly (eased over a few frames, not a jump cut)
      this.dist += (free - this.dist) * (dt >= 0.5 ? 1 : approach(o.pullRate, dt));
      this.held = 0; this.vdist = 0;
    } else if ((this.held += dt) >= o.outHold || dt >= 0.5) { // clear for a moment: ease back out
      [this.dist, this.vdist] = dt >= 0.5 ? [free, 0] : smoothDamp(this.dist, free, this.vdist, o.outTime, dt);
    }
    const position = [0, 1, 2].map((k) => focus[k] + dir[k] * this.dist);
    return { focus, position, fov: this.fov };
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
