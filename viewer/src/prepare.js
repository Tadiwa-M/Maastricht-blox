// Turn one streamed file (chunk .bxc or island .bxi) into everything the city view needs, as
// plain transferable arrays: runs in a Web Worker (src/stream-worker.js) or, when workers are
// unavailable (file://), on the main thread. No DOM, no materials: material keys come from
// src/matkey.js.
//
// Output:
//   kind, header        file header (island pose included)
//   records             decoded brick columns (local i/j for chunks too; the near look rebuilds
//                       a World from them when the camera comes close)
//   far                 { family: arrays } city far look (src/cityfar.js) of the whole item,
//                       hidden faces culled within the item, one geometry per family
//   solid               SolidMap fields (src/solidmap.js) for the query API
//   bounds              World bounds (global cells for chunks, local for islands)
//   triangles, bricks
import * as THREE from 'three';
import { parseBxc } from './bxc.js';
import { parseBxi } from './bxi.js';
import { World, NO_VARIATION } from './world.js';
import { occupancyGrid } from './exterior.js';
import { buildFarGeometry, cellCodeOf } from './farmesh.js';
import { windowGlow } from './glow.js';
import { brickColor } from './bricks-color.js';
import { classOf, keyOf, farFamily, shineOf } from './matkey.js';
import { SolidMap } from './solidmap.js';

/** World from decoded records; chunk records move to global cells. */
export function worldFromRecords(meta, kind, header, r) {
  const w = new World(meta);
  const n = header.brickCount;
  w.allocate(n);
  const I0 = kind === 'chunk' ? header.cx * w.chunkStuds : 0, J0 = kind === 'chunk' ? header.cy * w.chunkStuds : 0;
  for (let q = 0; q < n; q++) {
    w.I[q] = I0 + r.i[q]; w.J[q] = J0 + r.j[q]; w.K[q] = r.k[q];
    w.type[q] = r.type[q]; w.color[q] = r.color[q]; w.rotFlags[q] = r.rotFlags[q]; w.feature[q] = r.feature[q];
  }
  w.finish();
  if (kind === 'island') {
    w.island = { id: header.islandId, cx: header.cx, cy: header.cy, origin: [header.originX, header.originZ], yawDeg: header.yawDeg };
  }
  return w;
}

function glassEntryOf(world) {
  for (const e of world.palette.values()) if (e.material === 'glass') return e;
  return null;
}

/** Far look of a whole World in the city style: { family -> arrays }, triangles. */
export function cityFarArrays(world) {
  const codeOf = cellCodeOf(world, classOf);
  const grid = occupancyGrid(world, codeOf);
  const code = grid ? grid.code : () => 1;
  const isGlass = (n) => classOf(world.palette.get(world.color[n])) === 'glass';
  const glows = windowGlow(world, isGlass);
  const glass = glassEntryOf(world);
  const col = new THREE.Color();
  const lamp = new THREE.Color();
  const style = (n, part) => {
    const entry = part === 'glass' ? (glass || world.palette.get(world.color[n])) : world.palette.get(world.color[n]);
    const key = keyOf(entry);
    const exact = part === 'glass' || !!(world.rotFlags[n] & NO_VARIATION);
    const color = brickColor(entry, world.I[n], world.J[n], world.K[n], exact, col).clone();
    let glow = null;
    if (key === 'glass') glow = glows.get(n) || null;
    else if (key.startsWith('emissive:')) glow = lamp.set(entry.srgb).multiplyScalar(0.6).clone();
    return { key: farFamily(key), color, glow, shine: shineOf(key) };
  };
  const all = new Int32Array(world.count);
  for (let n = 0; n < world.count; n++) all[n] = n;
  const r = buildFarGeometry(world, all, { code, codeOf, style, extra: true, raw: true });
  return { far: Object.fromEntries(r.arrays), triangles: r.triangles, faces: r.faces, culled: r.culled };
}

/** kind 'chunk' | 'island', bytes of the file, meta { palette, catalogue, manifest? }. */
export async function prepareItem(kind, bytes, meta) {
  const parsed = kind === 'island' ? await parseBxi(bytes) : await parseBxc(bytes);
  const world = worldFromRecords(meta, kind, parsed.header, parsed.records);
  const out = { kind, header: parsed.header, records: parsed.records, bricks: world.count };
  if (!world.count) return { ...out, far: {}, triangles: 0, solid: null, bounds: null };
  const far = cityFarArrays(world);
  const solid = SolidMap.fromWorld(world, (n) => classOf(world.palette.get(world.color[n])) === 'water');
  return { ...out, ...far, solid: solid.toJSON(), bounds: world.bounds, groundK: world.groundK };
}

/** Every ArrayBuffer in a prepareItem result (for postMessage transfer). */
export function transferables(res) {
  const out = new Set();
  const add = (a) => { if (a?.buffer instanceof ArrayBuffer) out.add(a.buffer); };
  for (const a of Object.values(res.records || {})) add(a);
  for (const fam of Object.values(res.far || {})) for (const a of Object.values(fam)) add(a);
  if (res.solid) { add(res.solid.solid); add(res.solid.water); }
  return [...out];
}
