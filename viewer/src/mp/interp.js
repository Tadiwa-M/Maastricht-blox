// Smooth other players: each one's positions arrive ~10 times a second with network jitter, so
// they are drawn a little in the past (DELAY ms), between the two samples around that moment;
// past the newest sample the motion carries on for up to EXTRAPOLATE ms, then holds. A jump of
// more than SNAP metres (a respawn, the boundary) is not smoothed. Pure, tested in test/mp.test.mjs.
// Times are the receiver's own clock (ms); positions three.js metres; yaw compass radians.

export const DELAY = 120, EXTRAPOLATE = 200, SNAP = 15, KEEP = 12;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Track {
  constructor() { this.s = []; }

  push(t, x, y, z, yaw, speed = 0) {
    const last = this.s.at(-1);
    if (last && t <= last.t) t = last.t + 1;
    if (last && Math.hypot(x - last.x, z - last.z) > SNAP) this.s.length = 0; // teleported
    this.s.push({ t, x, y, z, yaw, speed });
    if (this.s.length > KEEP) this.s.shift();
  }

  get empty() { return this.s.length === 0; }
  get lastT() { return this.s.at(-1)?.t ?? -Infinity; }

  /** The pose at the receiver's time `now` -> { x, y, z, yaw, speed } or null. */
  sample(now, delay = DELAY) {
    const s = this.s;
    if (!s.length) return null;
    const t = now - delay;
    if (s.length === 1 || t <= s[0].t) return { ...s[0] };
    for (let q = s.length - 1; q > 0; q--) {
      const a = s[q - 1], b = s[q];
      if (t >= a.t && t <= b.t) return mix(a, b, (t - a.t) / (b.t - a.t));
    }
    const a = s.at(-2), b = s.at(-1);
    const k = 1 + Math.min(t - b.t, EXTRAPOLATE) / Math.max(1, b.t - a.t);
    return mix(a, b, k);
  }
}

function mix(a, b, k) {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
    yaw: a.yaw + wrap(b.yaw - a.yaw) * Math.min(1, k), speed: a.speed + (b.speed - a.speed) * Math.min(1, k) };
}
