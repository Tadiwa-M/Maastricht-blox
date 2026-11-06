// The opening fly-in: after the title screen the camera swoops from the whole-city view down to
// street level, then the player takes over (citymode.js runs it; pure path math here, tested in
// test/intro.test.mjs). Like a game's intro shot that ends behind the character.
//
// A pose is { cam: [x, y, z], target: [x, y, z] } in three.js metres. The path moves the target
// in a straight line and the camera around it: distance shrinks geometrically (a long way down
// feels steady, not rushed at the end), the compass turns the short way, the tilt flattens out.

export const INTRO = { seconds: 5.5, waitMax: 20 };

/** Smootherstep ease (0..1). */
export function ease(k) {
  const t = Math.min(1, Math.max(0, k));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function polar([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1e-6;
  return { r, yaw: Math.atan2(x, z), pitch: Math.asin(Math.max(-1, Math.min(1, y / r))) };
}

/** Pose at progress k (0..1, eased inside) between two poses. */
export function flyPose(from, to, k) {
  const e = ease(k);
  const target = from.target.map((v, i) => v + (to.target[i] - v) * e);
  const a = polar(from.cam.map((v, i) => v - from.target[i]));
  const b = polar(to.cam.map((v, i) => v - to.target[i]));
  let dy = b.yaw - a.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // the short way round
  const r = a.r * Math.pow(b.r / a.r, e);
  const yaw = a.yaw + dy * e, pitch = a.pitch + (b.pitch - a.pitch) * e;
  const c = Math.cos(pitch);
  const cam = [target[0] + Math.sin(yaw) * c * r, target[1] + Math.sin(pitch) * r, target[2] + Math.cos(yaw) * c * r];
  return { cam, target };
}

/** Compass yaw (radians, 0 north, clockwise) of looking from cam to target (three.js). */
export function lookYaw(cam, target) {
  return Math.atan2(target[0] - cam[0], -(target[2] - cam[2]));
}

/**
 * Whether a page load gets the fly-in: not for screenshots/films, links to a view or spot, or
 * automated browsers (tools/) unless the link says #intro=1.
 */
export function wantsIntro(hash, search, automated = false) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  if (p.get('intro') === '1') return true;
  if (automated || /[?&](shot|film)=1/.test(search)) return false;
  return !['view', 'at', 'mode', 'intro'].some((k) => p.has(k));
}
