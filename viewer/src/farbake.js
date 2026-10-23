// Whole-city silhouette: pre-baked, very low-detail far meshes per region of chunks (run at site
// build time by tools/bake-far.mjs, drawn by src/farregion.js). Pure: no three.js, no DOM.
//
// Method (per region of R x R chunks, R = 8 -> 256 m):
//   1. Coarse voxels: every brick cell (chunks, and islands turned into world cells through
//      their pose) votes for its coarse cell of cellStuds x cellStuds x cellPlates (default
//      2 x 2 x 3 = 1 m x 1 m x 0.6 m). Any vote makes the cell solid (thin walls and roof
//      shells survive); its colour is the majority vote (Boyer-Moore), windows and doors vote
//      glass. Each solid cell remembers its owner chunk (islands: the island's owning chunk),
//      so a region's faces can be hidden chunk by chunk when the real chunk is streamed in.
//   2. Outside air: flood fill from the sky down and sideways (never into the "bottomless"
//      air under the terrain shell, as src/exterior.js). The grid covers the region plus its
//      owned islands plus one cell, and neighbouring chunks/islands are rasterised too (not
//      emitted), so faces against them are culled.
//   3. Faces: a solid cell's face is kept when it looks into outside air, or into water from
//      a non-water cell (the river bed shows through the water). Greedy meshing merges equal
//      (colour, owner) faces into rectangles; glass faces stay single cells so each window
//      gets its own night glow.
//
// File far/r_{rx}_{ry}.bin ("BXF1", little-endian):
//   Header (40 bytes)
//     char[4] magic = "BXF1"   uint16 version = 1   uint16 flags (bit0 = body raw-DEFLATE)
//     int32 rx, ry             region index
//     int32 gi0, gj0, gk0      coarse cell of quad coordinate (0, 0, 0)
//     uint8 cellStuds, cellPlates   uint16 ownerCount
//     uint32 quadCount         uint32 bodyBytes
//   Body: ownerCount x { int16 cx, int16 cy, uint32 quads } (quads are sorted by owner, in this
//         order), then quadCount x { uint16 x, y, z, w, h; uint8 dir, color } (12 bytes).
//   A quad lies in the plane of axis a = dir >> 1 (0 = i east, 1 = j north, 2 = k up) at
//   coordinate (x, y, z)[a] (already the face plane), spanning w cells along axis (a+1)%3 and
//   h along (a+2)%3 from (x, y, z). dir & 1 = 0: normal +a, 1: normal -a. color = palette idx.
import { classOf } from './matkey.js';

export const BXF_MAGIC = 'BXF1';
export const BXF_HEADER = 40;
export const QUAD_BYTES = 12;
export const OWNER_BYTES = 8;

/** Coarse voxel grid with majority-vote colours and owners. */
export class CoarseGrid {
  constructor(gi0, gj0, gk0, ni, nj, nk) {
    Object.assign(this, { gi0, gj0, gk0, ni, nj, nk });
    const n = ni * nj * nk;
    if (n > 400e6) throw new Error(`coarse grid too big (${ni}x${nj}x${nk})`);
    this.color = new Uint8Array(n);
    this.votes = new Uint8Array(n);
    this.owner = new Uint16Array(n); // 0 = context only (not emitted), else owner index + 1
  }

  index(gi, gj, gk) {
    const x = gi - this.gi0, y = gj - this.gj0, z = gk - this.gk0;
    if (x < 0 || y < 0 || z < 0 || x >= this.ni || y >= this.nj || z >= this.nk) return -1;
    return x + this.ni * (y + this.nj * z);
  }

  vote(gi, gj, gk, color, owner) {
    const c = this.index(gi, gj, gk);
    if (c < 0) return;
    if (this.color[c] === color) { if (this.votes[c] < 255) this.votes[c]++; if (owner && !this.owner[c]) this.owner[c] = owner; } else if (this.votes[c] === 0) { this.color[c] = color; this.owner[c] = owner; this.votes[c] = 1; } else this.votes[c]--;
  }
}

/**
 * Rasterise bricks into the grid. bricks: { I, J, K, type, color, rotFlags, count } columns
 * (cells in the source frame), types: Map id -> catalogue type, extent(t, rot) -> [ei, ej],
 * toWorld(I + 0.5, J + 0.5) -> [I, J] world cell (identity for chunks), voteColor(n) -> idx.
 */
export function rasterise(grid, src, { cellStuds, cellPlates, owner }) {
  const { count, I, J, K, type, rotFlags } = src.bricks;
  for (let n = 0; n < count; n++) {
    const t = src.types.get(type[n]);
    if (!t) continue;
    const [ei, ej] = src.extent(t, rotFlags[n] & 3);
    const col = src.voteColor(n);
    for (let dj = 0; dj < ej; dj++)
      for (let di = 0; di < ei; di++) {
        let wi = I[n] + di, wj = J[n] + dj;
        if (src.toWorld) [wi, wj] = src.toWorld(wi + 0.5, wj + 0.5);
        const gi = Math.floor(wi / cellStuds), gj = Math.floor(wj / cellStuds);
        let last = -1;
        for (let k = 0; k < t.h; k++) {
          const gk = Math.floor((K[n] + k) / cellPlates);
          if (gk === last) continue; // one vote per coarse cell per column of the brick
          last = gk;
          grid.vote(gi, gj, gk, col, owner);
        }
      }
  }
}

/** Outside air (1) of a grid: flood from the sky, never into bottomless air under a shell. */
export function outsideAir(grid) {
  const { ni, nj, nk, color } = grid;
  const sxy = ni * nj;
  const out = new Uint8Array(ni * nj * nk);
  const top = new Int32Array(sxy), bottom = new Int32Array(sxy).fill(nk);
  for (let z = 0; z < nk; z++)
    for (let col = 0; col < sxy; col++)
      if (color[col + sxy * z]) { top[col] = z + 1; if (bottom[col] === nk) bottom[col] = z; }
  let queue = new Int32Array(1 << 16), head = 0, tail = 0;
  const push = (q) => {
    if (tail === queue.length) {
      if (head > 0) { queue.copyWithin(0, head, tail); tail -= head; head = 0; }
      if (tail === queue.length) { const next = new Int32Array(queue.length * 2); next.set(queue); queue = next; }
    }
    queue[tail++] = q;
  };
  const topAt = (x, y) => (x < 0 || y < 0 || x >= ni || y >= nj ? 0 : top[x + ni * y]);
  for (let y = 0; y < nj; y++)
    for (let x = 0; x < ni; x++) {
      const col = x + ni * y;
      for (let z = top[col]; z < nk; z++) out[col + sxy * z] = 1;
      const hi = Math.max(topAt(x - 1, y), topAt(x + 1, y), topAt(x, y - 1), topAt(x, y + 1));
      for (let z = top[col]; z < Math.min(hi, nk); z++) push(col + sxy * z);
    }
  const visit = (q, x, y, z) => {
    if (out[q] || color[q]) return;
    const col = x + ni * y;
    if (bottom[col] < nk && z < bottom[col]
      && z < topAt(x - 1, y) && z < topAt(x + 1, y) && z < topAt(x, y - 1) && z < topAt(x, y + 1)) return;
    out[q] = 1;
    push(q);
  };
  while (head < tail) {
    const q = queue[head++];
    const x = q % ni, y = Math.floor(q / ni) % nj, z = Math.floor(q / sxy);
    if (x + 1 < ni) visit(q + 1, x + 1, y, z);
    if (x > 0) visit(q - 1, x - 1, y, z);
    if (y + 1 < nj) visit(q + ni, x, y + 1, z);
    if (y > 0) visit(q - ni, x, y - 1, z);
    if (z + 1 < nk) visit(q + sxy, x, y, z + 1);
    if (z > 0) visit(q - sxy, x, y, z - 1);
  }
  return out;
}

/**
 * Visible faces of the grid's owned cells, merged greedily. isWater(color), isGlass(color).
 * Returns quads sorted by owner: { owner, x, y, z, w, h, dir, color } columns + counts per owner.
 */
export function meshGrid(grid, outside, { isWater, isGlass }) {
  const { ni, nj, nk, color, owner } = grid;
  const dims = [ni, nj, nk], strides = [1, ni, ni * nj];
  const water = new Uint8Array(256), glass = new Uint8Array(256);
  for (let c = 1; c < 256; c++) { water[c] = isWater(c) ? 1 : 0; glass[c] = isGlass(c) ? 1 : 0; }
  const quads = [];
  const p = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3, v = (a + 2) % 3, nu = dims[u], nv = dims[v];
    const mask = new Int32Array(nu * nv);
    for (const sgn of [1, -1]) {
      const dir = a * 2 + (sgn > 0 ? 0 : 1);
      for (let s = 0; s < dims[a]; s++) {
        let any = false;
        for (let jv = 0; jv < nv; jv++)
          for (let iu = 0; iu < nu; iu++) {
            p[a] = s; p[u] = iu; p[v] = jv;
            const c = p[0] + strides[1] * p[1] + strides[2] * p[2];
            let key = 0;
            const col = color[c];
            if (col && owner[c]) {
              const ns = s + sgn;
              let show;
              if (ns < 0 || ns >= dims[a]) show = true;
              else {
                const nb = c + sgn * strides[a];
                show = outside[nb] === 1 || (color[nb] && water[color[nb]] && !water[col]);
              }
              if (show) key = glass[col] ? -(col | (owner[c] << 8)) : (col | (owner[c] << 8));
            }
            mask[iu + nu * jv] = key;
            if (key) any = true;
          }
        if (!any) continue;
        const plane = sgn > 0 ? s + 1 : s;
        for (let jv = 0; jv < nv; jv++)
          for (let iu = 0; iu < nu; ) {
            const key = mask[iu + nu * jv];
            if (!key) { iu++; continue; }
            let w = 1, h = 1;
            if (key > 0) {
              while (iu + w < nu && mask[iu + w + nu * jv] === key) w++;
              grow: while (jv + h < nv) {
                for (let q = 0; q < w; q++) if (mask[iu + q + nu * (jv + h)] !== key) break grow;
                h++;
              }
            }
            for (let y = 0; y < h; y++) for (let q = 0; q < w; q++) mask[iu + q + nu * (jv + y)] = 0;
            const k = Math.abs(key);
            const xyz = [0, 0, 0];
            xyz[a] = plane; xyz[u] = iu; xyz[v] = jv;
            quads.push({ owner: k >> 8, x: xyz[0], y: xyz[1], z: xyz[2], w, h, dir, color: k & 255 });
            iu += w;
          }
      }
    }
  }
  quads.sort((q1, q2) => q1.owner - q2.owner);
  return quads;
}

/**
 * Bake one region. sources: [{ bricks, types, extent, voteColor, toWorld?, owner (0 = context) }]
 * as for rasterise; box = { gi0, gj0, gk0, gi1, gj1, gk1 } (coarse, exclusive) incl. margin;
 * owners: [{ cx, cy }] (owner index + 1 is what sources carry). palette: Map idx -> entry.
 */
export function bakeRegion({ rx, ry, box, sources, owners, palette, cellStuds = 2, cellPlates = 3 }) {
  const grid = new CoarseGrid(box.gi0, box.gj0, box.gk0, box.gi1 - box.gi0, box.gj1 - box.gj0, box.gk1 - box.gk0);
  for (const src of sources) rasterise(grid, src, { cellStuds, cellPlates, owner: src.owner });
  const outside = outsideAir(grid);
  const isWater = (c) => classOf(palette.get(c)) === 'water';
  const isGlass = (c) => classOf(palette.get(c)) === 'glass';
  const quads = meshGrid(grid, outside, { isWater, isGlass });
  const counts = owners.map(() => 0);
  for (const q of quads) counts[q.owner - 1]++;
  return { rx, ry, gi0: box.gi0, gj0: box.gj0, gk0: box.gk0, cellStuds, cellPlates,
    owners: owners.map((o, q) => ({ cx: o.cx, cy: o.cy, quads: counts[q] })), quads };
}

/** Region bake -> file bytes (Uint8Array). deflate(Uint8Array) -> Uint8Array (optional). */
export function encodeBxf(r, deflate = null) {
  const body = new Uint8Array(r.owners.length * OWNER_BYTES + r.quads.length * QUAD_BYTES);
  const dv = new DataView(body.buffer);
  let o = 0;
  for (const ow of r.owners) { dv.setInt16(o, ow.cx, true); dv.setInt16(o + 2, ow.cy, true); dv.setUint32(o + 4, ow.quads, true); o += OWNER_BYTES; }
  for (const q of r.quads) {
    dv.setUint16(o, q.x, true); dv.setUint16(o + 2, q.y, true); dv.setUint16(o + 4, q.z, true);
    dv.setUint16(o + 6, q.w, true); dv.setUint16(o + 8, q.h, true);
    body[o + 10] = q.dir; body[o + 11] = q.color;
    o += QUAD_BYTES;
  }
  const packed = deflate ? deflate(body) : body;
  const out = new Uint8Array(BXF_HEADER + packed.byteLength);
  const h = new DataView(out.buffer);
  for (let q = 0; q < 4; q++) out[q] = BXF_MAGIC.charCodeAt(q);
  h.setUint16(4, 1, true); h.setUint16(6, deflate ? 1 : 0, true);
  h.setInt32(8, r.rx, true); h.setInt32(12, r.ry, true);
  h.setInt32(16, r.gi0, true); h.setInt32(20, r.gj0, true); h.setInt32(24, r.gk0, true);
  out[28] = r.cellStuds; out[29] = r.cellPlates; h.setUint16(30, r.owners.length, true);
  h.setUint32(32, r.quads.length, true); h.setUint32(36, packed.byteLength, true);
  out.set(packed, BXF_HEADER);
  return out;
}

export function parseBxfHeader(bytes) {
  if (bytes.byteLength < BXF_HEADER) throw new Error(`far region needs ${BXF_HEADER} header bytes`);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== BXF_MAGIC) throw new Error(`bad far region magic ${JSON.stringify(magic)}`);
  const h = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {
    version: h.getUint16(4, true), flags: h.getUint16(6, true), rx: h.getInt32(8, true), ry: h.getInt32(12, true),
    gi0: h.getInt32(16, true), gj0: h.getInt32(20, true), gk0: h.getInt32(24, true),
    cellStuds: bytes[28], cellPlates: bytes[29], ownerCount: h.getUint16(30, true),
    quadCount: h.getUint32(32, true), bodyBytes: h.getUint32(36, true),
  };
  if (out.version !== 1) throw new Error(`unsupported far region version ${out.version}`);
  if (bytes.byteLength !== BXF_HEADER + out.bodyBytes) throw new Error(`far region ${out.rx},${out.ry}: truncated`);
  return out;
}

/** File bytes -> { header, owners: [{ cx, cy, quads, start }], quads: columns }. inflate async. */
export async function decodeBxf(bytes, inflate) {
  const header = parseBxfHeader(bytes);
  let body = bytes.subarray(BXF_HEADER);
  if (header.flags & 1) body = await inflate(body);
  const want = header.ownerCount * OWNER_BYTES + header.quadCount * QUAD_BYTES;
  if (body.byteLength !== want) throw new Error(`far region ${header.rx},${header.ry}: body ${body.byteLength} B, expected ${want}`);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const owners = [];
  let o = 0, start = 0;
  for (let q = 0; q < header.ownerCount; q++, o += OWNER_BYTES) {
    const quads = dv.getUint32(o + 4, true);
    owners.push({ cx: dv.getInt16(o, true), cy: dv.getInt16(o + 2, true), quads, start });
    start += quads;
  }
  const n = header.quadCount;
  const quads = { x: new Uint16Array(n), y: new Uint16Array(n), z: new Uint16Array(n), w: new Uint16Array(n),
    h: new Uint16Array(n), dir: new Uint8Array(n), color: new Uint8Array(n), count: n };
  for (let q = 0; q < n; q++, o += QUAD_BYTES) {
    quads.x[q] = dv.getUint16(o, true); quads.y[q] = dv.getUint16(o + 2, true); quads.z[q] = dv.getUint16(o + 4, true);
    quads.w[q] = dv.getUint16(o + 6, true); quads.h[q] = dv.getUint16(o + 8, true);
    quads.dir[q] = body[o + 10]; quads.color[q] = body[o + 11];
  }
  return { header, owners, quads };
}
