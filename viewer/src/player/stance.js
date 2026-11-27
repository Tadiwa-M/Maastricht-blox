// How a body carrying a gun stands on its legs: the chest (and the gun) keep facing the aim, the
// legs face where the body is going, up to what a waist can twist; going backwards the legs face
// the aim and step backwards (the walk cycle runs in reverse). Pure; test/stance.test.mjs.

export const STANCE = { twistMax: 1.05, backFrom: 1.95, turnRate: 9 }; // rad, rad (~112 deg), 1/s (leg turn easing)

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * aimYaw: where the chest faces; moveYaw: where the body travels (compass radians); speed m/s.
 * -> { legYaw (compass), twist (chest yaw relative to the legs, rig convention), back (stepping
 * backwards) }. Standing still the legs face the aim.
 */
export function stance(aimYaw, moveYaw, speed, o = STANCE) {
  if (speed < 0.3) return { legYaw: aimYaw, twist: 0, back: false };
  const d = wrap(moveYaw - aimYaw);
  const back = Math.abs(d) > o.backFrom;
  const want = back ? wrap(d - Math.PI) : d; // backwards: legs point opposite the travel
  const legYaw = wrap(aimYaw + Math.max(-o.twistMax, Math.min(o.twistMax, want)));
  // rig: pose.rotY = -legYaw, and the chest turns by -(aim - legs) about its local y
  return { legYaw, twist: -wrap(aimYaw - legYaw), back };
}

/** Ease an angle toward a target at rate (1/s) without going the long way round. */
export function easeAngle(a, b, rate, dt) { return wrap(a + wrap(b - a) * Math.min(1, rate * dt)); }
