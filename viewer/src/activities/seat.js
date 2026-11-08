// Sitting on a cafe terrace (pure, tested in test/activities.test.mjs): where the player sits,
// which way the relaxed camera looks, and when sitting ends (the player walks or jumps off).
// Chairs and terraces come from life/terraces.js (Unity metres, yaw in compass degrees).

const DEG = Math.PI / 180;

/** Game clock speed while seated (time passes faster over a coffee). */
export const SEATED_SPEED = 10;

/**
 * seat: { poi, chair } from Terraces.freeSeat. -> { feet: [x, z] (three.js), face (compass rad the
 * sitter faces), cam: { yaw (compass rad the camera looks toward: out over the street or
 * square), pitch, dist } }.
 */
export function seatView({ poi, chair }) {
  const [fx, fz] = poi.f || [0, 1];
  return {
    feet: [chair.x, -chair.z],
    face: chair.yaw * DEG,
    cam: { yaw: Math.atan2(fx, fz), pitch: 0.12, dist: 4.4 },
  };
}

/** Has the seated player got up? feet / seat: [x, z] three.js; vy: vertical speed (a jump). */
export function leftSeat(feet, seat, vy = 0, { slack = 0.12 } = {}) {
  return Math.hypot(feet[0] - seat[0], feet[1] - seat[1]) > slack || vy > 0.5;
}
