// Synthetic city for the player tests: a 0.5 x 0.2 x 0.5 m cell grid (three.js metres,
// x east, y up, z = -north) with a flat floor, plus optional rotated solid boxes (island-like)
// and an 'unknown' region.
export function synthCity({ size = 40, floorK = 5, rotBoxes = [], unknownX = Infinity } = {}) {
  const S = 0.5, P = 0.2, cells = new Set();
  const key = (I, J, K) => `${I},${J},${K}`;
  const city = {
    S, P, floorY: floorK * P,
    fill(I0, J0, K0, I1, J1, K1) { // inclusive cell box
      for (let I = I0; I <= I1; I++) for (let J = J0; J <= J1; J++) for (let K = K0; K <= K1; K++) cells.add(key(I, J, K));
    },
    isSolid(x, y, z) {
      if (x >= unknownX) return 'unknown';
      const I = Math.floor(x / S), J = Math.floor(-z / S), K = Math.floor(y / P);
      if (I < 0 || J < 0 || I >= size || J >= size) return 'unknown';
      if (K < floorK) return true;
      if (cells.has(key(I, J, K))) return true;
      for (const b of rotBoxes) { // { cx, cz, hx, hz, y0, y1, yawDeg }: box turned clockwise from north
        const a = (b.yawDeg * Math.PI) / 180, dx = x - b.cx, dn = -(z - b.cz);
        const u = dx * Math.cos(a) - dn * Math.sin(a), v = dx * Math.sin(a) + dn * Math.cos(a);
        if (Math.abs(u) <= b.hx && Math.abs(v) <= b.hz && y >= b.y0 && y < b.y1) return true;
      }
      return false;
    },
    groundHeight(x, z) {
      if (city.isSolid(x, 0, z) === 'unknown') return 'unknown';
      let y = floorK * P;
      while (city.isSolid(x, y + 0.01, z) === true) y += P;
      return y;
    },
  };
  return city;
}
