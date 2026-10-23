// Level of detail for moving things: the nearest get full brick models (up to a cap), the
// next ones a cheap box (up to a cap), the rest are hidden. Pure, tested in
// test/life.pool.test.mjs.

/**
 * dist: Array of camera distances. Returns { full: [indices], box: [indices], hidden: n },
 * nearest first.
 */
export function assignLod(dist, { fullDist = 160, farDist = 700, fullCap = 24, boxCap = 200 } = {}) {
  const order = dist.map((d, q) => q).filter((q) => Number.isFinite(dist[q])).sort((a, b) => dist[a] - dist[b]);
  const full = [], box = [];
  for (const q of order) {
    if (dist[q] <= fullDist && full.length < fullCap) full.push(q);
    else if (dist[q] <= farDist && box.length < boxCap) box.push(q);
  }
  return { full, box, hidden: dist.length - full.length - box.length };
}

/**
 * Stable slots: keeps each id in the slot it had last frame so pooled models don't swap
 * between vehicles. ids: wanted ids this frame; returns Map id -> slot (0..cap-1).
 */
export class SlotPool {
  constructor(cap) { this.cap = cap; this.slots = new Map(); }

  assign(ids) {
    const want = new Set(ids);
    for (const id of [...this.slots.keys()]) if (!want.has(id)) this.slots.delete(id);
    const used = new Set(this.slots.values());
    let free = 0;
    for (const id of ids) {
      if (this.slots.has(id)) continue;
      while (used.has(free)) free++;
      if (free >= this.cap) break;
      this.slots.set(id, free); used.add(free);
    }
    return this.slots;
  }
}
