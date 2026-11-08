// Collision for the interior the player is in, answered through the city query API (src/city.js)
// so the shared player controller, follow camera and spot finder need no changes. Pure.
//
// roomVolume(place, floorY) is the room as a solid region: inside the room box only the
// furniture is solid, the doorway niche is open, and everything else in the region (walls,
// floor, ceiling, a margin around them) is solid. installVolumes(city) wraps the city's
// isSolid / isWater / groundHeight ONCE: while a volume is active, points inside its region are
// answered by it, every other point (and every point while none is active) by the city as before.
import { roomFrame, solidBoxes, RECESS, DOOR_H } from './layout.js';
import { DOOR_W } from './format.js';

const MARGIN = 1.0; // solid region beyond the inner wall faces (m)

/**
 * place: parsed place; floorY: three.js y of the room floor. -> { box (three.js AABB of the
 * region), floorY, contains(x, y, z), isSolid(x, y, z) -> bool | undefined (outside the region),
 * groundHeight(x, z, fromY) -> number | undefined, toRoom(x, z) (three.js -> room metres) }.
 */
export function roomVolume(place, floorY) {
  const { width: W, depth: D, height: H, floor: step } = place.room;
  const fr = roomFrame(place);
  const furniture = solidBoxes(place);
  const dl = place.door.fromLeft - DOOR_W / 2, dr = place.door.fromLeft + DOOR_W / 2;
  const nicheFloor = -step;
  // the region in three.js metres: the room rectangle plus the margin, turned by quarter turns
  const xs = [], zs = [];
  for (const [x, z] of [[-MARGIN, -RECESS - MARGIN], [W + MARGIN, -RECESS - MARGIN], [-MARGIN, D + MARGIN], [W + MARGIN, D + MARGIN]]) {
    const [ux, uz] = fr.toUnity(x, z);
    xs.push(ux); zs.push(-uz);
  }
  const box = { min: { x: Math.min(...xs), y: floorY - MARGIN, z: Math.min(...zs) }, max: { x: Math.max(...xs), y: floorY + H + MARGIN, z: Math.max(...zs) } };
  const inBox = (x, y, z) => x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z && y >= box.min.y && y <= box.max.y;
  const toRoom = (x, z) => fr.toRoom(x, -z);
  const inRoom = (rx, rz) => rx > 0 && rx < W && rz > 0 && rz < D;
  const inNiche = (rx, rz) => rx > dl && rx < dr && rz > -RECESS && rz <= 0;

  function solidAt(rx, ry, rz) {
    if (inRoom(rx, rz)) {
      if (ry < 0 || ry >= H) return true;
      for (const b of furniture) if (rx >= b[0] && rx < b[3] && rz >= b[2] && rz < b[5] && ry >= b[1] && ry < b[4]) return true;
      return false;
    }
    if (inNiche(rx, rz)) return ry < nicheFloor || ry >= DOOR_H;
    return true;
  }

  return {
    box, floorY, toRoom,
    contains: inBox,
    isSolid(x, y, z) {
      if (!inBox(x, y, z)) return undefined;
      const [rx, rz] = toRoom(x, z);
      return solidAt(rx, y - floorY, rz);
    },
    groundHeight(x, z, fromY = Infinity) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) return undefined;
      const [rx, rz] = toRoom(x, z);
      // no height given (Infinity: "the top of the column"): the floor or furniture you would
      // stand on, not the roof of the room, so a spawn in the room lands on its floor
      const from = Number.isFinite(fromY) ? fromY - floorY : H - 0.01;
      if (from < -MARGIN) return undefined; // asked below the region: not ours
      if (!inRoom(rx, rz) && !inNiche(rx, rz)) return floorY + Math.min(from, H + MARGIN);
      if (inNiche(rx, rz)) return floorY + (from >= DOOR_H ? DOOR_H : nicheFloor);
      let top = from >= H ? H : 0;
      if (top === 0) for (const b of furniture) if (rx >= b[0] && rx < b[3] && rz >= b[2] && rz < b[5] && b[4] <= from + 1e-6) top = Math.max(top, b[4]);
      return floorY + top;
    },
  };
}

/**
 * Wrap the city's queries once (idempotent). Returns { set(volume | null), get active() }.
 * Every caller of city.isSolid / isWater / groundHeight (player controller, follow camera,
 * spot finder, city camera) sees the active room; nothing else changes.
 */
export function installVolumes(city) {
  if (city.interiorVolumes) return city.interiorVolumes;
  const base = { isSolid: city.isSolid.bind(city), groundHeight: city.groundHeight.bind(city), isWater: city.isWater?.bind(city) };
  let active = null;
  city.isSolid = (x, y, z) => { const r = active?.isSolid(x, y, z); return r === undefined ? base.isSolid(x, y, z) : r; };
  city.groundHeight = (x, z, fromY) => {
    const r = active?.groundHeight(x, z, fromY ?? Infinity);
    return r === undefined ? base.groundHeight(x, z, fromY) : r;
  };
  if (base.isWater) city.isWater = (x, y, z) => (active?.contains(x, y, z) ? false : base.isWater(x, y, z));
  const api = { set(v) { active = v || null; }, get active() { return active; }, base };
  Object.defineProperty(city, 'interiorVolumes', { value: api, enumerable: false });
  return api;
}
