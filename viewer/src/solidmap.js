// Compact occupancy of one chunk or island for gameplay queries: one bit per cell for "solid"
// (any brick's bounding box, CONTRACT 2.1: the whole box counts) and one for "water".
// 64 x 64 x 125 levels = 64 KB per real chunk, against ~1-2 MB for a World's cell map, so every
// streamed item keeps one. Pure (no three.js); the World passed in only needs its typed arrays.

export class SolidMap {
  /** Box in the World's own cells (islands: local), I1/J1/K1 exclusive. */
  constructor(I0, J0, K0, I1, J1, K1) {
    Object.assign(this, { I0, J0, K0, I1, J1, K1 });
    this.nx = Math.max(0, I1 - I0); this.ny = Math.max(0, J1 - J0); this.nz = Math.max(0, K1 - K0);
    const bits = this.nx * this.ny * this.nz;
    this.solid = new Uint8Array((bits + 7) >> 3);
    this.water = new Uint8Array((bits + 7) >> 3);
  }

  index(I, J, K) {
    const x = I - this.I0, y = J - this.J0, z = K - this.K0;
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return -1;
    return x + this.nx * (y + this.ny * z);
  }

  set(I, J, K, isWater) {
    const q = this.index(I, J, K);
    if (q < 0) return;
    this.solid[q >> 3] |= 1 << (q & 7);
    if (isWater) this.water[q >> 3] |= 1 << (q & 7);
  }

  isSolid(I, J, K) { const q = this.index(I, J, K); return q >= 0 && (this.solid[q >> 3] >> (q & 7)) & 1 ? true : false; }
  isWater(I, J, K) { const q = this.index(I, J, K); return q >= 0 && (this.water[q >> 3] >> (q & 7)) & 1 ? true : false; }

  /** Highest solid level K <= fromK in column (I, J), or -Infinity. */
  topBelow(I, J, fromK = Infinity) {
    if (I < this.I0 || J < this.J0 || I >= this.I1 || J >= this.J1) return -Infinity;
    for (let K = Math.min(fromK, this.K1 - 1); K >= this.K0; K--) if (this.isSolid(I, J, K)) return K;
    return -Infinity;
  }

  /** Plain fields for postMessage (the two bit arrays are transferable). */
  toJSON() { return { box: [this.I0, this.J0, this.K0, this.I1, this.J1, this.K1], solid: this.solid, water: this.water }; }

  static from({ box, solid, water }) {
    const m = new SolidMap(...box);
    m.solid = solid; m.water = water;
    return m;
  }

  /** Every brick of a World (bounds must be computed). isWater(n) -> bool. */
  static fromWorld(world, isWater = () => false) {
    const b = world.bounds;
    const m = new SolidMap(b.I0, b.J0, b.K0, b.I1, b.J1, b.K1);
    for (let n = 0; n < world.count; n++) {
      const t = world.typeOf(n);
      if (!t) continue;
      const [ei, ej] = world.extentOf(n);
      const w = isWater(n);
      for (let k = 0; k < t.h; k++)
        for (let dj = 0; dj < ej; dj++)
          for (let di = 0; di < ei; di++) m.set(world.I[n] + di, world.J[n] + dj, world.K[n] + k, w);
    }
    return m;
  }
}
