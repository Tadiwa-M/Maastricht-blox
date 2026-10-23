// Third-person follow camera (pure math; the three.js camera is set by index.js).
//
// State: yaw (compass radians the camera looks toward), pitch (radians, + = camera above the
// focus looking down), distance (metres). The focus is the player's shoulder. The wanted
// camera point is focus - lookDir * distance; pullIn() marches a few parallel rays from the
// focus toward it through city.isSolid (centre + 4 offsets, i.e. a small box around the near
// plane) and stops short of the first solid sample, so walls between player and camera pull
// the camera in instead of being clipped. Unknown (unloaded) space does not block the camera.
// Pulling in is instant, easing back out is smooth (no popping when a wall passes).

export const CAM = { minDist: 1.2, maxDist: 14, dist: 5, pitch: 0.22, minPitch: -0.45, maxPitch: 1.25, margin: 0.3, focusY: 1.6 };

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
    this.yaw = 0; this.pitch = this.o.pitch; this.want = this.o.dist; this.dist = this.o.dist;
  }

  /** look: [dx, dy] radians (right / down positive as from a mouse), zoom: metres (+ = out). */
  input(look, zoom) {
    this.yaw += look[0];
    this.pitch = Math.min(this.o.maxPitch, Math.max(this.o.minPitch, this.pitch + look[1]));
    this.want = Math.min(this.o.maxDist, Math.max(this.o.minDist, this.want + zoom));
  }

  /** feet: player feet [x, y, z]. Returns { focus, position } (three.js arrays). */
  update(city, feet, dt) {
    const focus = [feet[0], feet[1] + this.o.focusY, feet[2]];
    const dir = backDir(this.yaw, this.pitch);
    const free = pullIn(city, focus, dir, this.want);
    this.dist = free < this.dist ? free : this.dist + (free - this.dist) * Math.min(1, dt * 4);
    const position = [0, 1, 2].map((k) => focus[k] + dir[k] * this.dist);
    return { focus, position };
  }
}
