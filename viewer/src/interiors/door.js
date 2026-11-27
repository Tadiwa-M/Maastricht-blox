// Doors and the fade between street and room (pure, no three.js, no DOM).
import { FACING_NAMES } from '../rotation.js';
import { roomFrame, RECESS } from './layout.js';

/** The facing letter nearest a compass yaw (radians): its quarter-turn rot, named by rotation.js. */
export function facingFromYaw(yaw) {
  return FACING_NAMES[((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4];
}

/** Door snippet for a place file from where the player stands, facing the door (the door looks back at them). */
export function doorHere(feetUnity, yaw) {
  const back = FACING_NAMES[(FACING_NAMES.indexOf(facingFromYaw(yaw)) + 2) % 4];
  return { x: +feetUnity.x.toFixed(2), z: +feetUnity.z.toFixed(2), facing: back };
}

const TAU = Math.PI * 2;
/** Smallest absolute difference of two compass angles (radians). */
export const angleGap = (a, b) => Math.abs(((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI);

export const DOOR = { near: 2.2, walkIn: 0.9, cone: (50 * Math.PI) / 180, height: 1.2, leaveZ: 0.35, leaveCone: (65 * Math.PI) / 180 };

/**
 * Outside: the player (Unity x, z; feet y three.js; yaw compass radians) and a place's door
 * (groundY: pavement height there, or null while unknown). -> { dist, near, walkIn }: near shows
 * the "Enter" hint; walkIn = right at the door and facing into the building (walking into it).
 */
export function doorCheck(place, feet, yaw, groundY = null, o = DOOR) {
  const dist = Math.hypot(feet.x - place.door.x, feet.z - place.door.z);
  const level = groundY === null || Math.abs(feet.y - groundY) < o.height;
  const near = level && dist < o.near;
  const walkIn = near && dist < o.walkIn && angleGap(yaw, roomFrame(place).yawIn) < o.cone;
  return { dist, near, walkIn };
}

/** The nearest place whose door is within `near` metres, with its check, or null. */
export function nearestDoor(places, feet, yaw, groundOf = () => null, o = DOOR) {
  let best = null;
  for (const p of places) {
    if (Math.abs(feet.x - p.door.x) > o.near || Math.abs(feet.z - p.door.z) > o.near) continue;
    const c = doorCheck(p, feet, yaw, groundOf(p), o);
    if (c.near && (!best || c.dist < best.check.dist)) best = { place: p, check: c };
  }
  return best;
}

/**
 * Inside: the player in room metres (x, z) and yaw. -> { near, walkOut }: near shows "Leave";
 * walkOut = in the doorway niche (or at its mouth) facing the door.
 */
export function exitCheck(place, room, yaw, o = DOOR) {
  const dx = room.x - place.door.fromLeft;
  const near = Math.hypot(dx, Math.max(0, room.z)) < 1.7 && room.z < 2.2;
  const facingDoor = angleGap(yaw, roomFrame(place).yawOut) < o.leaveCone;
  const walkOut = Math.abs(dx) < 0.6 && room.z < o.leaveZ && room.z > -RECESS - 0.2 && facingDoor;
  return { near, walkOut };
}

/**
 * Fade to black, do something at black, fade back. update(dt) -> opacity 0..1; the callback
 * runs once when fully black (after which a short hold lets the new view settle).
 */
export class Fader {
  constructor({ out = 0.32, hold = 0.18, back = 0.4 } = {}) { Object.assign(this, { out, hold, back }); this.phase = 'idle'; this.t = 0; this.cb = null; }

  get busy() { return this.phase !== 'idle'; }

  /** Start a fade; ignored while one runs. Returns true when started. */
  start(atBlack) {
    if (this.busy) return false;
    this.phase = 'out'; this.t = 0; this.cb = atBlack;
    return true;
  }

  update(dt) {
    if (this.phase === 'idle') return 0;
    this.t += dt;
    if (this.phase === 'out') {
      if (this.t < this.out) return this.t / this.out;
      this.phase = 'hold'; this.t = 0;
      const cb = this.cb; this.cb = null;
      cb?.();
      return 1;
    }
    if (this.phase === 'hold') {
      if (this.t < this.hold) return 1;
      this.phase = 'in'; this.t = 0;
      return 1;
    }
    if (this.t < this.back) return 1 - this.t / this.back;
    this.phase = 'idle';
    return 0;
  }
}
