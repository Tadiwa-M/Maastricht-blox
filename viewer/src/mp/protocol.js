// Multiplayer wire format (the room side is relay/src/room.js): JSON messages, positions in
// RD metres (EPSG:28992): [east, height, north] on the wire, [east, north] for flags and bases,
// so a room works whatever a world's origin. A world's Unity metres are RD minus its originRD
// (CONTRACT 1); three.js z = -north. Pure, tested in test/mp.test.mjs.

export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O (they read as 1 and 0)
export const NICK_KEY = 'blox.mp.nick';
export const PID_KEY = 'blox.mp.pid';

/** A typed room code -> 'ABCD', or null. */
export function parseCode(s) {
  const c = String(s ?? '').trim().toUpperCase();
  return c.length === 4 && [...c].every((ch) => CODE_LETTERS.includes(ch)) ? c : null;
}

/** A nickname as the room will show it (the room cleans it the same way). */
export const cleanNick = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12);

/** A random player id: lets a dropped connection come back as the same player. */
export function newPid(rand = Math.random) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let q = 0; q < 20; q++) s += a[Math.floor(rand() * a.length)];
  return s;
}

/** The room's WebSocket URL on the relay (https -> wss). */
export function wsUrl(relay, code, { pid, name, look }) {
  const q = new URLSearchParams({ pid, name, look: look || '' });
  return `${relay.replace(/\/$/, '').replace(/^http/, 'ws')}/room/${code}?${q}`;
}

const r2 = (v) => Math.round(v * 100) / 100;

/** My position message: feet [x, y, z] three.js, yaw compass radians, speed m/s; origin: the world's originRD. */
export function posMessage(feet, yaw, speed, origin) {
  return JSON.stringify({ t: 'p', p: [r2(origin[0] + feet[0]), r2(feet[1]), r2(origin[1] - feet[2])],
    r: Math.round(yaw * 1000) / 1000, s: Math.round(speed * 10) / 10 });
}

/** A room message, or null if it isn't one. */
export function parseMessage(data) {
  if (typeof data !== 'string' || data === 'pong') return null;
  try {
    const m = JSON.parse(data);
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch { return null; }
}

/** Wire [east, height, north] -> three.js [x, y, z]. */
export const toThree = (p, origin) => [p[0] - origin[0], p[1], origin[1] - p[2]];
/** RD [east, north] -> Unity [x, z] (x east, z north). */
export const rdToUnity = (p, origin) => [p[0] - origin[0], p[1] - origin[1]];
/** three.js feet -> RD [east, north]. */
export const threeToRd = (pos, origin) => [origin[0] + pos[0], origin[1] - pos[2]];

/** Reconnect delays: 0.5, 1, 2, 4, 4, ... s; give up after `max` tries. */
export function backoff(attempt, max = 10) {
  return attempt >= max ? null : Math.min(4000, 500 * 2 ** attempt);
}
