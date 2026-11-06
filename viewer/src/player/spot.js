// Where a person can stand near a point: the closest column whose top is street level (within
// 0.5 m of the lowest walkable top around), so a bus stop or trip start that falls inside a
// building's footprint puts you on the pavement beside it, not on its roof. Pure over the city
// query API (city.groundHeight(x, zThree) -> metres | 'unknown'); tested in test/player-spot.test.mjs.

const DEG = Math.PI / 180;

/** -> { x, z } (three.js metres) or null while the area isn't streamed in. */
export function standSpot(city, x, z, { search = 14, step = 1 } = {}) {
  const top = (px, pz) => {
    const g = city.groundHeight(px, pz);
    return typeof g === 'number' ? g : null;
  };
  let lowest = Infinity;
  for (let dx = -search; dx <= search; dx += 2) for (let dz = -search; dz <= search; dz += 2) {
    const g = top(x + dx, z + dz);
    if (g !== null) lowest = Math.min(lowest, g);
  }
  if (lowest === Infinity) return null;
  for (let r = 0; r <= search; r += step) {
    for (let a = 0; a < 360; a += r ? Math.max(6, (step / r) * 57) : 360) {
      const px = x + r * Math.cos(a * DEG), pz = z + r * Math.sin(a * DEG);
      const g = top(px, pz);
      if (g !== null && g - lowest < 0.5) return { x: px, z: pz };
    }
  }
  return null;
}

/** Is (x, zUnity) in the built part of the city? Streamed cities know their chunks; others: yes. */
export function builtAt(city, x, zUnity) {
  if (!city?.bounded) return true;
  const CM = (city.chunkStuds || 64) * (city.studM || 0.5);
  return city.hasChunk(Math.floor(x / CM), Math.floor(zUnity / CM));
}

/**
 * The most open place to stand within `search` m of (x, z) (three.js): street-level ground
 * (within 1 m of the lowest around) with the most clear space at eye height, facing the longest
 * clear view that also leaves room behind for the follow camera. -> { x, z, yaw } (yaw compass
 * radians) or null while too much of the area is still unknown (not streamed in).
 */
export function openSpot(city, x, z, { search = 30, step = 3, reach = 16, behind = 6, eye = 1.7 } = {}) {
  const pts = [];
  let unknown = 0, lowest = Infinity;
  for (let dx = -search; dx <= search; dx += step) for (let dz = -search; dz <= search; dz += step) {
    if (Math.hypot(dx, dz) > search) continue;
    const g = city.groundHeight(x + dx, z + dz);
    if (typeof g !== 'number') { unknown++; continue; }
    pts.push([x + dx, z + dz, g]);
    lowest = Math.min(lowest, g);
  }
  if (!pts.length || unknown > (pts.length + unknown) * 0.1) return null;
  const DIRS = 16;
  let best = null;
  for (const [px, pz, g] of pts) {
    if (g - lowest > 1) continue; // a roof or a raised terrace
    const clear = [];
    for (let i = 0; i < DIRS; i++) {
      const a = (i / DIRS) * 2 * Math.PI, ux = Math.sin(a), uz = -Math.cos(a); // compass a: north = -z
      let d = 0;
      for (let s = 1; s <= reach; s++) {
        if (city.isSolid(px + ux * s, g + eye, pz + uz * s) !== false) break;
        d = s;
      }
      clear.push(d);
    }
    const open = clear.reduce((a, b) => a + b, 0);
    if (best && open <= best.open) continue;
    let face = -1;
    for (let i = 0; i < DIRS; i++) if (clear[(i + DIRS / 2) % DIRS] >= behind && (face < 0 || clear[i] > clear[face])) face = i;
    if (face >= 0) best = { x: px, z: pz, yaw: (face / DIRS) * 2 * Math.PI, open };
  }
  return best ? { x: best.x, z: best.z, yaw: best.yaw } : null;
}
