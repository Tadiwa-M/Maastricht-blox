// World model: all bricks of a world in global grid cells, plus the occupancy questions
// the renderer and picking need (CONTRACT sections 1, 2 and 4).
//
// Bricks are stored column-wise in typed arrays (I, J, K, type, color, rotFlags, feature)
// indexed by a brick number n. `cells` maps every occupied cell to the brick that fills it,
// so "what is at (I, J, K)?" is one hash lookup (used by stud exposure and ray picking).
// A World can come from chunk files (loadWorld) or from records made in code
// (World.fromRecords, used by the piece gallery).
import { parseBxc } from './bxc.js';
import { rotatedExtent, footprintCell } from './rotation.js';

export const ROT_MASK = 3;      // rotFlags bits 0-1
export const NO_VARIATION = 4;  // bit 2: exact colour
export const HIDE_STUDS = 8;    // bit 3: studs are covered by culled interior

/** Rotated extent [along i, along j] of a catalogue type. */
export const typeExtent = (t, rot) => rotatedExtent(t.w, t.d, rot);

/** Offset of unrotated footprint cell (a, b) of a catalogue type. */
export const typeCell = (t, rot, a, b) => footprintCell(t.w, t.d, rot, a, b);

/**
 * Unrotated footprint cells that carry a stud before exposure tests. 'center' (jumper
 * plates) returns no cells: its single centred stud is handled by the mesh builder.
 */
export function studCells(t) {
  const cells = [];
  if (t.studs === 'all') {
    for (let b = 0; b < t.d; b++) for (let a = 0; a < t.w; a++) cells.push([a, b]);
  } else if (t.studs === 'backRows') {
    // back rows lie at the -j side at rot 0 (small b); slope30 has studRows 0
    for (let b = 0; b < (t.studRows ?? 1); b++) for (let a = 0; a < t.w; a++) cells.push([a, b]);
  }
  return cells;
}

export const cellKey = (I, J, K) => I + J * 4096 + K * 16777216;

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let n = 0; n < s.length; n++) out[n] = s.charCodeAt(n);
  return out;
}

const FIELDS = [['I', Int32Array], ['J', Int32Array], ['K', Int32Array], ['type', Uint8Array],
  ['color', Uint8Array], ['rotFlags', Uint8Array], ['feature', Uint32Array]];

export class World {
  /** meta: { manifest?, palette, catalogue, features? } as in a world dir. */
  constructor(meta) {
    this.manifest = meta.manifest || {};
    this.palette = new Map(meta.palette.entries.map((e) => [e.idx, e]));
    this.types = new Map(meta.catalogue.types.map((t) => [t.id, t]));
    this.features = new Map((meta.features?.features || []).map((f) => [f.id, f]));
    this.chunkStuds = this.manifest.chunkStuds || 64;
    this.studM = this.manifest.studM || 0.5;
    this.plateM = this.manifest.plateM || 0.2;
    this.count = 0;
  }

  /** Records in code: [{ I, J, K, type, color, rot?, flags?, feature? }]. */
  static fromRecords(meta, list) {
    const w = new World(meta);
    w.allocate(list.length);
    list.forEach((r, n) => {
      w.I[n] = r.I; w.J[n] = r.J; w.K[n] = r.K; w.type[n] = r.type; w.color[n] = r.color;
      w.rotFlags[n] = ((r.rot || 0) & ROT_MASK) | (r.flags || 0); w.feature[n] = r.feature || 0;
    });
    w.finish();
    return w;
  }

  allocate(n) {
    for (const [name, Arr] of FIELDS) this[name] = new Arr(n);
    this.count = n;
  }

  async decodeChunks(chunks) {
    const parsed = [];
    for (const b64 of Object.values(chunks)) parsed.push(await parseBxc(b64ToBytes(b64)));
    this.allocate(parsed.reduce((s, p) => s + p.header.brickCount, 0));
    let o = 0;
    for (const { header: h, records: r } of parsed) {
      const I0 = h.cx * this.chunkStuds, J0 = h.cy * this.chunkStuds;
      for (let q = 0; q < h.brickCount; q++, o++) {
        this.I[o] = I0 + r.i[q]; this.J[o] = J0 + r.j[q]; this.K[o] = r.k[q];
        this.type[o] = r.type[q]; this.color[o] = r.color[q];
        this.rotFlags[o] = r.rotFlags[q]; this.feature[o] = r.feature[q];
      }
    }
    this.chunkCount = parsed.length;
    this.finish();
  }

  finish() {
    this.buildCells();
    this.computeBounds();
  }

  typeOf(n) { return this.types.get(this.type[n]); }
  rot(n) { return this.rotFlags[n] & ROT_MASK; }
  extentOf(n) { return typeExtent(this.typeOf(n), this.rot(n)); }

  /** Every cell of every brick's bounding box -> brick number. */
  buildCells() {
    const cells = new Map();
    for (let n = 0; n < this.count; n++) {
      const t = this.typeOf(n);
      if (!t) continue;
      const [ei, ej] = this.extentOf(n);
      for (let k = 0; k < t.h; k++)
        for (let dj = 0; dj < ej; dj++)
          for (let di = 0; di < ei; di++) cells.set(cellKey(this.I[n] + di, this.J[n] + dj, this.K[n] + k), n);
    }
    this.cells = cells;
  }

  /** Brick number filling cell (I, J, K), or -1 for air. */
  brickAt(I, J, K) {
    const n = this.cells.get(cellKey(I, J, K));
    return n === undefined ? -1 : n;
  }

  occupied(I, J, K) { return this.cells.has(cellKey(I, J, K)); }

  /** First air level above the highest brick in column (I, J); bounds.K0 if empty. */
  topK(I, J) {
    for (let K = this.bounds.K1 - 1; K >= this.bounds.K0; K--) if (this.occupied(I, J, K)) return K + 1;
    return this.bounds.K0;
  }

  computeBounds() {
    const b = { I0: Infinity, J0: Infinity, K0: Infinity, I1: -Infinity, J1: -Infinity, K1: -Infinity };
    const topArea = new Map();
    for (let n = 0; n < this.count; n++) {
      const t = this.typeOf(n);
      if (!t) continue;
      const [ei, ej] = this.extentOf(n);
      b.I0 = Math.min(b.I0, this.I[n]); b.I1 = Math.max(b.I1, this.I[n] + ei);
      b.J0 = Math.min(b.J0, this.J[n]); b.J1 = Math.max(b.J1, this.J[n] + ej);
      b.K0 = Math.min(b.K0, this.K[n]); b.K1 = Math.max(b.K1, this.K[n] + t.h);
      const top = this.K[n] + t.h;
      topArea.set(top, (topArea.get(top) || 0) + ei * ej);
    }
    // ground level = the top height covering the largest area (streets, squares)
    let best = b.K0, bestA = -1;
    for (const [k, a] of topArea) if (a > bestA) { best = k; bestA = a; }
    this.bounds = b; // I1/J1/K1 are exclusive
    this.groundK = best;
  }
}

export async function loadWorld(data) {
  const w = new World(data);
  await w.decodeChunks(data.chunks || {});
  return w;
}
