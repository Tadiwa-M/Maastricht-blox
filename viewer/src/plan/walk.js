// Walking routes on the walk graph (life/walkways.json: pavements, footways, squares, crossings,
// with nothing over water since accuracy A2): A* from the node nearest the start to the node
// nearest the end. Pure; tested in test/plan-walk.test.mjs. The route is the green line of the
// trip planner (the "racing line" for walking).

export class WalkRouter {
  /** doc: walkways.json { nodes: [x, z, ...], edges: [a, b, ...] } (Unity metres). */
  constructor(doc, cell = 50) {
    const n = doc.nodes.length / 2;
    this.n = n;
    this.x = new Float64Array(n); this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = doc.nodes[2 * i]; this.z[i] = doc.nodes[2 * i + 1]; }
    const deg = new Uint32Array(n + 1);
    for (let e = 0; e < doc.edges.length; e += 2) { deg[doc.edges[e] + 1]++; deg[doc.edges[e + 1] + 1]++; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    this.start = deg;
    this.adj = new Uint32Array(doc.edges.length);
    const fill = deg.slice(0, n);
    for (let e = 0; e < doc.edges.length; e += 2) {
      const a = doc.edges[e], b = doc.edges[e + 1];
      this.adj[fill[a]++] = b; this.adj[fill[b]++] = a;
    }
    this.cell = cell;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(this.x[i] / cell)},${Math.floor(this.z[i] / cell)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    }
  }

  /** Nearest node to (x, z) within maxM, or -1. */
  nearest(x, z, maxM = 150) {
    const c = this.cell, r = Math.ceil(maxM / c), ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = -1, bd = maxM;
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (const q of this.grid.get(`${i},${j}`) || []) {
          const d = Math.hypot(this.x[q] - x, this.z[q] - z);
          if (d < bd) { bd = d; best = q; }
        }
      }
    }
    return best;
  }

  /**
   * Shortest walk from a to b ([x, z]): { pts: [[x, z], ...] (from a to b), dist m }, or null when
   * either end is off the network (callers fall back to a straight line).
   */
  route(a, b) {
    const s = this.nearest(a[0], a[1]), t = this.nearest(b[0], b[1]);
    if (s < 0 || t < 0) return null;
    const g = new Float64Array(this.n).fill(Infinity), prev = new Int32Array(this.n).fill(-1);
    const h = (i) => Math.hypot(this.x[i] - this.x[t], this.z[i] - this.z[t]);
    const heap = new MinHeap();
    g[s] = 0; heap.push(h(s), s);
    while (heap.size) {
      const [f, u] = heap.pop();
      if (u === t) break;
      if (f - h(u) > g[u] + 1e-9) continue; // stale entry
      for (let k = this.start[u]; k < this.start[u + 1]; k++) {
        const v = this.adj[k];
        const w = g[u] + Math.hypot(this.x[v] - this.x[u], this.z[v] - this.z[u]);
        if (w < g[v]) { g[v] = w; prev[v] = u; heap.push(w + h(v), v); }
      }
    }
    if (g[t] === Infinity) return null;
    const pts = [];
    for (let i = t; i >= 0; i = prev[i]) pts.push([this.x[i], this.z[i]]);
    pts.reverse();
    pts.unshift([a[0], a[1]]); pts.push([b[0], b[1]]);
    let dist = 0;
    for (let i = 1; i < pts.length; i++) dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { pts, dist };
  }
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < k.length && k[l] < mk) { m = l; mk = k[l]; }
        if (r < k.length && k[r] < mk) m = r;
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
