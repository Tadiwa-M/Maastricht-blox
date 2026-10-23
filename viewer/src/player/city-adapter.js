// City query API built from the in-memory World + islands (until src/city.js from the
// viewer core is available, and as the test double for the controller).
//
// Interface (shared with src/city.js), three.js world metres (x east, y up, z = -north):
//   isSolid(x, y, z)   -> true | false | 'unknown'   (unknown = chunk not loaded)
//   groundHeight(x, z) -> top surface y of the column (chunks and islands) | 'unknown'
// Islands (CONTRACT 5.1) are tested in their own frame: the point goes through the inverse
// pose (island.js: worldToLocalThree) and then into the island's local cells.
import { worldToLocalThree, islandWorldBox } from '../island.js';
import { cellKey } from '../world.js';

/** world: chunk World; islands: [World with .island]. */
export function cityFromWorld(world, islands = []) {
  const S = world.studM, P = world.plateM, C = world.chunkStuds || 64;
  const loaded = new Set();
  for (let n = 0; n < world.count; n++) loaded.add(`${Math.floor(world.I[n] / C)},${Math.floor(world.J[n] / C)}`);
  const isl = islands.map((w) => ({ w, box: islandWorldBox(w) }));
  const isLoaded = (I, J) => loaded.has(`${Math.floor(I / C)},${Math.floor(J / C)}`);

  function islandSolid(x, y, z) {
    for (const { w, box } of isl) {
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z || y < box.min.y || y > box.max.y) continue;
      const p = worldToLocalThree(w.island, { x, y, z });
      if (w.occupied(Math.floor(p.x / S), Math.floor(-p.z / S), Math.floor(y / P))) return true;
    }
    return false;
  }

  return {
    isSolid(x, y, z) {
      const I = Math.floor(x / S), J = Math.floor(-z / S), K = Math.floor(y / P);
      if (!isLoaded(I, J)) return 'unknown';
      if (K < world.bounds.K0) return true; // below the world: bedrock
      return world.occupied(I, J, K) || islandSolid(x, y, z);
    },
    groundHeight(x, z) {
      const I = Math.floor(x / S), J = Math.floor(-z / S);
      if (!isLoaded(I, J)) return 'unknown';
      let top = world.topK(I, J) * P;
      for (const { w, box } of isl) {
        if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
        const p = worldToLocalThree(w.island, { x, y: 0, z });
        const i = Math.floor(p.x / S), j = Math.floor(-p.z / S);
        if (w.tops.has(cellKey(i, j, 0))) top = Math.max(top, w.topK(i, j) * P);
      }
      return top;
    },
  };
}
