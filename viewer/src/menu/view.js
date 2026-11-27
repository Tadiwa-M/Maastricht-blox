// The pause-menu map's camera: a 2D view of Unity metres (x east, z north) on a canvas of
// w x h CSS pixels. scale = pixels per metre; (cx, cz) is the world point at the canvas centre.
// Pure (no DOM): pan, wheel zoom about the cursor, two-finger pinch, fit to a box.

export class MapView {
  constructor({ w = 1, h = 1, cx = 0, cz = 0, scale = 1, min = 0.02, max = 12 } = {}) {
    Object.assign(this, { w, h, cx, cz, scale, min, max });
  }

  resize(w, h) { this.w = Math.max(1, w); this.h = Math.max(1, h); }

  /** World (x, z) -> screen [sx, sy] (y grows down, north is up). */
  toScreen(x, z) { return [(x - this.cx) * this.scale + this.w / 2, this.h / 2 - (z - this.cz) * this.scale]; }

  /** Screen (sx, sy) -> world [x, z]. */
  toWorld(sx, sy) { return [(sx - this.w / 2) / this.scale + this.cx, (this.h / 2 - sy) / this.scale + this.cz]; }

  clampScale(s) { return Math.min(this.max, Math.max(this.min, s)); }

  /** Drag by (dx, dy) screen pixels: the map follows the finger. */
  pan(dx, dy) { this.cx -= dx / this.scale; this.cz += dy / this.scale; }

  /** Zoom by `factor` keeping the world point under (sx, sy) where it is. */
  zoomAt(sx, sy, factor) {
    const [x, z] = this.toWorld(sx, sy);
    this.scale = this.clampScale(this.scale * factor);
    const [x2, z2] = this.toWorld(sx, sy);
    this.cx += x - x2; this.cz += z - z2;
  }

  /** Two fingers moved from (a0, b0) to (a1, b1) (screen [x, y] pairs): zoom by the spread, pan by the midpoint. */
  pinch(a0, b0, a1, b1) {
    const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
    const m0 = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2], m1 = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
    if (d0 > 1 && d1 > 1) this.zoomAt(m0[0], m0[1], d1 / d0);
    this.pan(m1[0] - m0[0], m1[1] - m0[1]);
  }

  /** Show the box [minX, minZ, maxX, maxZ] whole, with `pad` pixels around it. */
  fit(minX, minZ, maxX, maxZ, pad = 16) {
    const sw = Math.max(1, this.w - 2 * pad), sh = Math.max(1, this.h - 2 * pad);
    this.scale = this.clampScale(Math.min(sw / Math.max(1, maxX - minX), sh / Math.max(1, maxZ - minZ)));
    this.cx = (minX + maxX) / 2; this.cz = (minZ + maxZ) / 2;
  }

  centre(x, z) { this.cx = x; this.cz = z; }

  /** Visible world box [minX, minZ, maxX, maxZ] (with `margin` pixels extra). */
  bounds(margin = 0) {
    const [x0, z1] = this.toWorld(-margin, -margin), [x1, z0] = this.toWorld(this.w + margin, this.h + margin);
    return [x0, z0, x1, z1];
  }
}

/** A pointer that went down and up: a tap (not a drag) when it moved little and was quick. */
export function isTap(down, up, { px = 10, ms = 600 } = {}) {
  return Math.hypot(up.x - down.x, up.y - down.y) <= px && up.t - down.t <= ms;
}
