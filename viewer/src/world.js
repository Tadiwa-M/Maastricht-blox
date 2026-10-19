// World loader: decodes all chunks into one flat brick list in global grid cells and
// answers footprint / occupancy questions (CONTRACT sections 1-2).
import { parseBxc } from './bxc.js';

export const ROT_MASK = 3;
export const NO_VARIATION = 4;

function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let n = 0; n < s.length; n++) out[n] = s.charCodeAt(n);
  return out;
}

/** Rotated extent (along i, along j) of a catalogue type. */
export function extent(t, rot) {
  return rot & 1 ? [t.d, t.w] : [t.w, t.d];
}

/**
 * Map an unrotated footprint cell (a along w, b along d) to its offset (di, dj) from the
 * record position (min corner of the rotated bbox). Rotation is clockwise from above:
 * rot1 sends +j -> +i and +i -> -j.
 */
export function footprintCell(t, rot, a, b) {
  switch (rot & 3) {
    case 0: return [a, b];
    case 1: return [b, t.w - 1 - a];
    case 2: return [t.w - 1 - a, t.d - 1 - b];
    default: return [t.d - 1 - b, a];
  }
}

/** Unrotated footprint cells that carry a stud (before exposure tests). */
export function studCells(t) {
  const cells = [];
  if (t.studs === 'all') {
    for (let b = 0; b < t.d; b++) for (let a = 0; a < t.w; a++) cells.push([a, b]);
  } else if (t.studs === 'backRows') {
    // back rows lie at the -j side at rot 0 (small b)
    for (let b = 0; b < (t.studRows || 1); b++) for (let a = 0; a < t.w; a++) cells.push([a, b]);
  }
  return cells;
}

const cellKey = (I, J, K) => I + J * 4096 + K * 16777216;

export class World {
  constructor(data) {
    this.manifest = data.manifest;
    this.palette = new Map(data.palette.entries.map((e) => [e.idx, e]));
    this.types = new Map(data.catalogue.types.map((t) => [t.id, t]));
    this.features = new Map((data.features?.features || []).map((f) => [f.id, f]));
    this.chunkStuds = data.manifest.chunkStuds || 64;
    this.studM = data.manifest.studM || 0.5;
    this.plateM = data.manifest.plateM || 0.2;
    this.count = 0;
  }

  async decodeChunks(chunks) {
    const parsed = [];
    for (const [name, b64] of Object.entries(chunks)) {
      parsed.push(await parseBxc(b64ToBytes(b64)));
      parsed[parsed.length - 1].name = name;
    }
    const n = parsed.reduce((s, p) => s + p.header.brickCount, 0);
    this.I = new Int32Array(n); this.J = new Int32Array(n); this.K = new Int32Array(n);
    this.type = new Uint8Array(n); this.color = new Uint8Array(n);
    this.rotFlags = new Uint8Array(n); this.feature = new Uint32Array(n);
    let o = 0;
    for (const { header: h, records: r } of parsed) {
      const I0 = h.cx * this.chunkStuds, J0 = h.cy * this.chunkStuds;
      for (let q = 0; q < h.brickCount; q++, o++) {
        this.I[o] = I0 + r.i[q]; this.J[o] = J0 + r.j[q]; this.K[o] = r.k[q];
        this.type[o] = r.type[q]; this.color[o] = r.color[q];
        this.rotFlags[o] = r.rotFlags[q]; this.feature[o] = r.feature[q];
      }
    }
    this.count = n;
    this.chunkCount = parsed.length;
    this.buildOccupancy();
    this.computeBounds();
  }

  buildOccupancy() {
    const occ = new Set();
    for (let n = 0; n < this.count; n++) {
      const t = this.types.get(this.type[n]);
      if (!t) continue;
      const [ei, ej] = extent(t, this.rotFlags[n]);
      for (let k = 0; k < t.h; k++)
        for (let dj = 0; dj < ej; dj++)
          for (let di = 0; di < ei; di++) occ.add(cellKey(this.I[n] + di, this.J[n] + dj, this.K[n] + k));
    }
    this.occ = occ;
  }

  occupied(I, J, K) { return this.occ.has(cellKey(I, J, K)); }

  computeBounds() {
    const b = { I0: Infinity, J0: Infinity, K0: Infinity, I1: -Infinity, J1: -Infinity, K1: -Infinity };
    const topArea = new Map();
    for (let n = 0; n < this.count; n++) {
      const t = this.types.get(this.type[n]);
      if (!t) continue;
      const [ei, ej] = extent(t, this.rotFlags[n]);
      b.I0 = Math.min(b.I0, this.I[n]); b.I1 = Math.max(b.I1, this.I[n] + ei);
      b.J0 = Math.min(b.J0, this.J[n]); b.J1 = Math.max(b.J1, this.J[n] + ej);
      b.K0 = Math.min(b.K0, this.K[n]); b.K1 = Math.max(b.K1, this.K[n] + t.h);
      const top = this.K[n] + t.h;
      topArea.set(top, (topArea.get(top) || 0) + ei * ej);
    }
    // ground level = the top height covering the largest area (streets, squares)
    let best = b.K0, bestA = -1;
    for (const [k, a] of topArea) if (a > bestA) { best = k; bestA = a; }
    this.bounds = b;
    this.groundK = best;
  }
}

export async function loadWorld(data) {
  const w = new World(data);
  await w.decodeChunks(data.chunks || {});
  return w;
}
