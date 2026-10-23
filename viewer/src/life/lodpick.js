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
