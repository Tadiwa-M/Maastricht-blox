// Geometry of a planned journey, for drawing (Unity metres): bus legs follow their line's shape
// between the boarding and alighting stops, walk legs follow the walk graph (walk.js) or a
// straight line when an end is off the network. Pure; tested in test/plan-walk.test.mjs.

/** Points of the shape between distances d0 and d1 (interpolated ends). shape: Timetable shape { pts, cum }. */
export function shapeBetween(shape, d0, d1) {
  const { pts, cum } = shape, out = [];
  const at = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = cum[i - 1], b = cum[i], u = b > a ? Math.min(1, Math.max(0, (d - a) / (b - a))) : 0;
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u];
  };
  out.push(at(d0));
  for (let i = 0; i < cum.length; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
  out.push(at(d1));
  return out;
}

/**
 * Every leg with its points: [{ ...leg, pts: [[x, z], ...] }]. tt: Timetable; walk: WalkRouter
 * or null. Walk legs get their real distance and keep it for display (leg.walkDist).
 */
export function journeyGeometry(tt, journey, walk = null) {
  return journey.legs.map((l) => {
    if (l.mode === 'bus') {
      const p = tt.patterns[l.pattern], sh = tt.shapes[p.shape];
      const d0 = p.st[3 * l.fromI + 2], d1 = p.st[3 * l.toI + 2];
      return { ...l, pts: sh ? shapeBetween(sh, d0, d1) : [[l.from.x, l.from.z], [l.to.x, l.to.z]] };
    }
    const a = [l.from.x, l.from.z], b = [l.to.x, l.to.z];
    const r = walk?.route(a, b);
    return { ...l, pts: r ? r.pts : [a, b], walkDist: r ? Math.round(r.dist) : l.dist };
  });
}
