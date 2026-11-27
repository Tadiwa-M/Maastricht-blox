// Passenger camera math for riding a bus or train (pure, tested in test/ride.seat.test.mjs).
//
// A vehicle pose is Unity metres { x, y (ground), z (north) } plus yaw in degrees clockwise from
// north (life/buses.js). In three.js space north is -z, so forward = (sin yaw, 0, -cos yaw) and
// right = (cos yaw, 0, sin yaw). The seat sits a little ahead of the middle on the left side,
// at a seated eye height: both models have their cabin floor at 1.2 m and windows from 1.2 to
// 2.4 m, so a seated passenger's eyes (~0.9 m above the floor) are at window height.

export const SEATS = {
  bus: { forward: 2.2, right: -0.55, eye: 2.1 },
  rail: { forward: 4.0, right: -0.7, eye: 2.15 },
};
export const OUTSIDE = { back: 20, up: 10 }; // the "outside view": behind and above the vehicle

const D2R = Math.PI / 180;

/** Seat position (three.js) for a pose and vehicle mode. */
export function seatPosition(pose, mode = 'bus') {
  const s = SEATS[mode === 'rail' || mode === 'metro' ? 'rail' : 'bus'];
  const y = pose.yaw * D2R, fx = Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = Math.sin(y);
  return [pose.x + fx * s.forward + rx * s.right, pose.y + s.eye, -pose.z + fz * s.forward + rz * s.right];
}

/** Where a passenger steps off when the timetable has no stop position (transit.json v1): beside
 * the doors, on the right (kerb) side of the vehicle. Unity { x, z, yaw (deg) }. */
export const DOOR_SIDE_M = { bus: 3.0, rail: 3.5 };
export function doorSide(pose, mode = 'bus') {
  const d = DOOR_SIDE_M[mode === 'rail' || mode === 'metro' ? 'rail' : 'bus'], y = pose.yaw * D2R;
  return { x: pose.x + Math.cos(y) * d, z: pose.z - Math.sin(y) * d, yaw: pose.yaw };
}

/** Point to look at from `from` for a compass heading (deg) and pitch (rad, + = up). */
export function lookTarget(from, headingDeg, pitch, dist = 10) {
  const h = headingDeg * D2R, c = Math.cos(pitch);
  return [from[0] + Math.sin(h) * c * dist, from[1] + Math.sin(pitch) * dist, from[2] - Math.cos(h) * c * dist];
}

/** Camera behind and above a vehicle, looking at it. -> { cam, target } */
export function outsideView(pose, look = 0) {
  const h = (pose.yaw + look) * D2R;
  const t = [pose.x, pose.y + 2, -pose.z];
  return { cam: [t[0] - Math.sin(h) * OUTSIDE.back, t[1] + OUTSIDE.up, t[2] + Math.cos(h) * OUTSIDE.back], target: t };
}

/** Smallest signed difference b - a between two angles in degrees (-180..180]. */
export function angleDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Follow a heading smoothly (shapes are polylines: a raw yaw jumps at every vertex). rate: 1/s.
 * Snaps when the gap is huge (a new vehicle, a U-turn at a terminus).
 */
export function smoothYaw(current, target, dt, rate = 4) {
  if (current === null || Math.abs(angleDelta(current, target)) > 120) return target;
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}
