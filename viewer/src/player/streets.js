// Nearest street name for the HUD, from features.json (CONTRACT 6: kind 'street', bboxIJ in
// global cells). Street features carry only a bounding box, so "nearest" is a cheap score:
// distance to the box (0 inside) plus a tenth of the box's short side, which prefers narrow
// streets and small squares over a long diagonal road whose box covers half the map.

/** features: iterable of feature objects. Returns a finder (I, J) -> name | ''. */
export function streetFinder(features, { maxCells = 60 } = {}) {
  const streets = [...features].filter((f) => f.kind === 'street' && f.name && f.bboxIJ);
  return (I, J) => {
    let best = '', bestScore = Infinity;
    for (const f of streets) {
      const [I0, J0, I1, J1] = f.bboxIJ;
      const dx = Math.max(I0 - I, 0, I - I1), dy = Math.max(J0 - J, 0, J - J1);
      const d = Math.hypot(dx, dy);
      if (d > maxCells) continue;
      const score = d + 0.1 * Math.min(I1 - I0, J1 - J0);
      if (score < bestScore) { bestScore = score; best = f.name; }
    }
    return best;
  };
}
