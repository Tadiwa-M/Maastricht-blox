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
