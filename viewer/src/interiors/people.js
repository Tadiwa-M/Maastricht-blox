// Who is in the room (pure): a share of the seats taken (the same people every visit), the
// staff and standing guests. Poses are for the figure crowd (src/figure/crowd.js): three.js
// feet position, rotY = -yaw, the rig's SIT / IDLE modes (src/figure/rig.js).
import { MODE } from '../figure/rig.js';
import { roomFrame, seatsOf } from './layout.js';
import { RIG_SEAT_H } from './kit.js';
import { MAX_PEOPLE } from './format.js';

/** Stable 32-bit hash of a string (place ids -> seeds). */
export function strHash(s) {
  let h = 2166136261;
  for (let q = 0; q < s.length; q++) h = Math.imul(h ^ s.charCodeAt(q), 16777619);
  return h >>> 0;
}

/** Deterministic 0..1 for (seed, index). */
const unit = (seed, q) => { let h = Math.imul(seed ^ Math.imul(q + 1, 0x9e3779b1), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * The room's people: [{ seed (figure variant), x, z (room metres), facing, mode, lift (m the feet
 * sit above the floor: stools are higher than the rig's chair, tiers lift a whole row) }].
 * share: place.people.share. At most MAX_PEOPLE: staff and standing first, then the seated in
 * seat order (a big lecture room simply has a few more empty seats).
 */
export function roomPeople(place, max = MAX_PEOPLE) {
  const base = strHash(place.id);
  const out = [];
  for (const [q, s] of place.people.staff.entries()) out.push({ seed: (base % 100000) + 5000 + q * 13, x: s.x, z: s.z, facing: s.facing, mode: MODE.IDLE, lift: 0, staff: true });
  for (const [q, s] of place.people.standing.entries()) out.push({ seed: (base % 100000) + 7000 + q * 17, x: s.x, z: s.z, facing: s.facing, mode: MODE.IDLE, lift: 0 });
  seatsOf(place).forEach((s, q) => {
    if (out.length >= max || unit(base, q) >= place.people.share) return;
    out.push({ seed: (base % 100000) + q * 7 + 11, x: s.x, z: s.z, facing: s.facing, mode: MODE.SIT, lift: s.height - RIG_SEAT_H });
  });
  return out.slice(0, max);
}

/** Crowd poses (three.js) for people in a room whose floor is at floorY; t = seconds (idle motion). */
export function peoplePoses(place, people, floorY, t) {
  const fr = roomFrame(place);
  return people.map((p, q) => {
    const [ux, uz] = fr.toUnity(p.x, p.z);
    const yaw = (fr.rotToWorld(p.facing) * Math.PI) / 2;
    return { x: ux, y: floorY + p.lift, z: -uz, rotY: -yaw, mode: p.mode, t: t + q * 2.3, phase: 0, speed: 0 };
  });
}
