// Where a person can stand near a point: the closest column whose top is street level (within
// 0.5 m of the lowest walkable top around), so a bus stop or trip start that falls inside a
// building's footprint puts you on the pavement beside it, not on its roof. Pure over the city
// query API (city.groundHeight(x, zThree) -> metres | 'unknown'); tested in test/player-spot.test.mjs.

const DEG = Math.PI / 180;

/**
 * -> { x, z } (three.js metres) or null while the area isn't streamed in. A spot must be street
 * level (within 0.5 m of the lowest open top around), open to the sky (no roof or arcade up to 6 m),
 * and roomy enough for the follow camera (at least 3 of 8 directions clear for 2.5 m at chest
 * height); the nearest such spot wins.
 */
export function standSpot(city, x, z, { search = 30, step = 1 } = {}) {
  const top = (px, pz) => {
    const g = city.groundHeight(px, pz);
    return typeof g === 'number' ? g : null;
  };
  const free = (px, py, pz) => city.isSolid(px, py, pz) !== true;
  const open = (px, pz, g) => {
    if (![1, 1.7, 3, 6].every((h) => free(px, g + h, pz))) return false;
    let dirs = 0;
    for (let a = 0; a < 8; a++) if (free(px + Math.cos(a * 0.785) * 2.5, g + 1.2, pz + Math.sin(a * 0.785) * 2.5)) dirs++;
    return dirs >= 3;
  };
  // street level: the lowest open top around (a sunken spot inside a building doesn't count)
  let lowest = Infinity, lowestAny = Infinity;
  for (let dx = -search; dx <= search; dx += 2) for (let dz = -search; dz <= search; dz += 2) {
    const g = top(x + dx, z + dz);
    if (g === null) continue;
    lowestAny = Math.min(lowestAny, g);
    if (g < lowest && open(x + dx, z + dz, g)) lowest = g;
  }
  if (lowestAny === Infinity) return null;
  if (lowest === Infinity) lowest = lowestAny;
  for (let r = 0; r <= search; r += step) {
    for (let a = 0; a < 360; a += r ? Math.max(6, (step / r) * 57) : 360) {
      const px = x + r * Math.cos(a * DEG), pz = z + r * Math.sin(a * DEG);
      const g = top(px, pz);
      if (g !== null && g - lowest < 0.5 && open(px, pz, g)) return { x: px, z: pz };
    }
  }
  // nowhere open at street level (a covered market, deep inside a block): any street-level spot
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
