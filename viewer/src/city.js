// The city query API: what the player (src/player/), life (src/life/) and the camera ask the
// world, independent of how it is loaded (streamed site build or one embedded World).
//
// Coordinates are three.js world metres: x = east, y = up, z = -north (CONTRACT 1 Unity
// metres with z negated). y = 0 is grid level k = 0 (30.0 m NAP).
//
// Areas that are not loaded answer UNKNOWN ('unknown'): a chunk counts as known when its file
// is loaded AND every island whose footprint overlaps it is loaded (islands stand over
// neighbouring chunks). Chunks with no file are empty air (known). Outside the 64 x 64 chunk
// map everything is air.
//
// Water bricks are solid (you stand on the river surface the same as on a road); use isWater
// to tell them apart.
//
/**
 * @typedef {Object} City
 * @property {(x: number, y: number, z: number) => boolean | 'unknown'} isSolid
 *   Is the cell containing this point filled by a brick (bounding box), in chunks or islands?
 * @property {(x: number, y: number, z: number) => boolean | 'unknown'} isWater
 *   Is it a water brick?
 * @property {(x: number, z: number, fromY?: number) => number | null | 'unknown'} groundHeight
 *   Top (metres) of the highest solid cell in the column at or below fromY (default: the top of
 *   the world). null = no brick in that column below fromY. With fromY = feet height + a step
 *   you get the floor under an arcade instead of its roof.
 * @property {(x: number, z: number) => number} approxGround
 *   Ground height from the baked far index (per chunk, always known; for cameras and spawns).
 * @property {{min: {x,y,z}, max: {x,y,z}}} box  City extent in three.js metres.
 * @property {(x: number, z: number) => void} [focus]
 *   Ask the streamer to load around this point too (e.g. the player, when the camera is away).
 */
export const UNKNOWN = 'unknown';
const DEG = Math.PI / 180;

/** three.js point -> island-local metres (u along +i, v along +j). Inverse of CONTRACT 5.1. */
export function threeToIslandLocal(island, x, z) {
  const s = Math.sin(island.yawDeg * DEG), c = Math.cos(island.yawDeg * DEG);
  const dx = x - island.origin[0], dz = -z - island.origin[1];
  return [dx * c - dz * s, dx * s + dz * c];
}

/**
 * Query over solid maps (src/solidmap.js): chunks in global cells, islands in local cells with
 * a pose. Pure; used by both the streaming loader and the embedded single-World viewer.
 */
export class CityQuery {
  /**
   * opts: { studM, plateM, chunkStuds, chunksX, chunksY, hasChunk(cx, cy) -> bool,
   *         islandsOver(cx, cy) -> [island ids whose footprint overlaps the chunk] }
   */
  constructor(opts) {
    Object.assign(this, { studM: 0.5, plateM: 0.2, chunkStuds: 64, chunksX: 64, chunksY: 64,
      hasChunk: () => true, islandsOver: () => [] }, opts);
    this.chunks = new Map();   // "cx,cy" -> SolidMap
    this.islands = new Map();  // id -> { map, island: { origin, yawDeg }, rect: [x0, z0, x1, z1] three.js }
    this.byChunk = new Map();  // "cx,cy" -> Set of loaded island ids overlapping it
  }

  setChunk(cx, cy, map) { if (map) this.chunks.set(`${cx},${cy}`, map); else this.chunks.delete(`${cx},${cy}`); }

  /** island: { id, origin: [x, z] Unity, yawDeg }; map in local cells. */
  setIsland(island, map) {
    this.removeIsland(island.id);
    const S = this.studM, rect = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [u, v] of [[map.I0, map.J0], [map.I1, map.J0], [map.I0, map.J1], [map.I1, map.J1]]) {
      const s = Math.sin(island.yawDeg * DEG), c = Math.cos(island.yawDeg * DEG);
      const x = island.origin[0] + u * S * c + v * S * s, z = -(island.origin[1] - u * S * s + v * S * c);
      rect[0] = Math.min(rect[0], x); rect[1] = Math.min(rect[1], z); rect[2] = Math.max(rect[2], x); rect[3] = Math.max(rect[3], z);
    }
    const e = { map, island, rect, chunks: [] };
    this.islands.set(island.id, e);
    const CM = this.chunkStuds * S;
    for (let cx = Math.floor(rect[0] / CM); cx <= Math.floor(rect[2] / CM); cx++)
      for (let cy = Math.floor(-rect[3] / CM); cy <= Math.floor(-rect[1] / CM); cy++) {
        const k = `${cx},${cy}`;
        if (!this.byChunk.has(k)) this.byChunk.set(k, new Set());
        this.byChunk.get(k).add(island.id);
        e.chunks.push(k);
      }
  }

  removeIsland(id) {
    const e = this.islands.get(id);
    if (!e) return;
    for (const k of e.chunks) this.byChunk.get(k)?.delete(id);
    this.islands.delete(id);
  }

  /** Chunk (cx, cy) state: null = unknown, else { map (or null when empty), islands: [entries] }. */
  column(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) return { map: null, islands: [] };
    const k = `${cx},${cy}`;
    const map = this.chunks.get(k) || null;
    if (!map && this.hasChunk(cx, cy)) return null;
    const loaded = this.byChunk.get(k);
    for (const id of this.islandsOver(cx, cy)) if (!loaded?.has(id)) return null;
    return { map, islands: loaded ? [...loaded].map((id) => this.islands.get(id)) : [] };
  }

  /** (x, z) -> { col, I, J } or null when unknown. */
  locate(x, z) {
    const S = this.studM, I = Math.floor(x / S), J = Math.floor(-z / S);
    const col = this.column(Math.floor(I / this.chunkStuds), Math.floor(J / this.chunkStuds));
    return col && { col, I, J };
  }

  islandCell(e, x, z) {
    const [u, v] = threeToIslandLocal(e.island, x, z);
    return [Math.floor(u / this.studM), Math.floor(v / this.studM)];
  }

  test(x, y, z, what) {
    const at = this.locate(x, z);
    if (!at) return UNKNOWN;
    const K = Math.floor(y / this.plateM);
    if (at.col.map?.[what](at.I, at.J, K)) return true;
    for (const e of at.col.islands) {
      const [i, j] = this.islandCell(e, x, z);
      if (e.map[what](i, j, K)) return true;
    }
    return false;
  }

  isSolid(x, y, z) { return this.test(x, y, z, 'isSolid'); }
  isWater(x, y, z) { return this.test(x, y, z, 'isWater'); }

  groundHeight(x, z, fromY = Infinity) {
    const at = this.locate(x, z);
    if (!at) return UNKNOWN;
    const fromK = Number.isFinite(fromY) ? Math.floor(fromY / this.plateM) : Infinity;
    let top = at.col.map ? at.col.map.topBelow(at.I, at.J, fromK) : -Infinity;
    for (const e of at.col.islands) {
      const [i, j] = this.islandCell(e, x, z);
      top = Math.max(top, e.map.topBelow(i, j, fromK));
    }
    return top === -Infinity ? null : (top + 1) * this.plateM;
  }
}

/**
 * City over in-memory Worlds (embedded diorama build): one SolidMap for the chunk World in
 * global cells, one per island. Everything outside the loaded data is air, never unknown.
 * isWater(world, n) -> bool says which bricks are water.
 */
export function cityFromWorlds(world, islands, isWater = () => false, SolidMap) {
  const q = new CityQuery({ studM: world.studM, plateM: world.plateM, chunkStuds: world.chunkStuds, hasChunk: () => false });
  if (world.count) {
    const map = SolidMap.fromWorld(world, (n) => isWater(world, n));
    const { I0, J0, I1, J1 } = world.bounds, C = world.chunkStuds;
    for (let cx = Math.floor(I0 / C); cx <= Math.floor((I1 - 1) / C); cx++)
      for (let cy = Math.floor(J0 / C); cy <= Math.floor((J1 - 1) / C); cy++) q.setChunk(cx, cy, map);
  }
  for (const w of islands) q.setIsland(w.island, SolidMap.fromWorld(w, (n) => isWater(w, n)));
  const S = world.studM, P = world.plateM, b = world.bounds;
  q.box = { min: { x: b.I0 * S, y: b.K0 * P, z: -b.J1 * S }, max: { x: b.I1 * S, y: b.K1 * P, z: -b.J0 * S } };
  q.approxGround = () => world.groundK * P;
  q.focus = () => {};
  return q;
}
