// CityLoader: streams chunk and island files around the camera (src/stream.js decides what and
// when), prepares them in workers (src/workers.js -> src/prepare.js) and keeps the query API
// (src/city.js) in sync. What appears on screen is src/cityview.js's job (onReady / onUnload).
//
// index = world/index.json written by build.mjs --site:
//   { studM, plateM, chunkStuds, chunksX, chunksY,
//     chunks:  [{ cx, cy, file, minK, maxK, bytes }],
//     islands: [{ id, file, cx, cy, rect: [x0, z0, x1, z1] (Unity metres), minK, maxK, bytes }] }
import { StreamScheduler, READY } from './stream.js';
import { CityQuery } from './city.js';
import { SolidMap } from './solidmap.js';

/** three.js box of an index entry. */
export function itemBox(index, e, kind) {
  const P = index.plateM, CM = index.chunkStuds * index.studM;
  if (kind === 'island') return { min: { x: e.rect[0], y: e.minK * P, z: -e.rect[3] }, max: { x: e.rect[2], y: e.maxK * P, z: -e.rect[1] } };
  return { min: { x: e.cx * CM, y: e.minK * P, z: -(e.cy + 1) * CM }, max: { x: (e.cx + 1) * CM, y: e.maxK * P, z: -e.cy * CM } };
}

/** Island ids whose footprint overlaps each chunk: Map "cx,cy" -> [ids]. */
export function islandsByChunk(index) {
  const CM = index.chunkStuds * index.studM, out = new Map();
  for (const i of index.islands) {
    for (let cx = Math.floor(i.rect[0] / CM); cx <= Math.floor((i.rect[2] - 1e-6) / CM); cx++)
      for (let cy = Math.floor(i.rect[1] / CM); cy <= Math.floor((i.rect[3] - 1e-6) / CM); cy++) {
        const k = `${cx},${cy}`;
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(i.id);
      }
  }
  return out;
}

export class CityLoader {
  /**
   * opts: { source (src/source.js), pool (PreparePool), loadRadius, concurrency, maxLoaded,
   *         onReady(item), onUnload(item, payload) }
   */
  constructor(index, opts) {
    this.index = index;
    Object.assign(this, { onReady: () => {}, onUnload: () => {} }, opts);
    const chunkSet = new Set(index.chunks.map((c) => `${c.cx},${c.cy}`));
    const over = islandsByChunk(index);
    this.query = new CityQuery({
      studM: index.studM, plateM: index.plateM, chunkStuds: index.chunkStuds,
      chunksX: index.chunksX ?? 64, chunksY: index.chunksY ?? 64,
      hasChunk: (cx, cy) => chunkSet.has(`${cx},${cy}`),
      islandsOver: (cx, cy) => over.get(`${cx},${cy}`) || [],
    });
    const items = [
      ...index.chunks.map((e) => ({ key: `c${e.cx},${e.cy}`, kind: 'chunk', entry: e, box: itemBox(index, e, 'chunk') })),
      ...index.islands.map((e) => ({ key: `i${e.id}`, kind: 'island', entry: e, box: itemBox(index, e, 'island') })),
    ];
    this.sched = new StreamScheduler(items, {
      loadRadius: opts.loadRadius ?? 220, concurrency: opts.concurrency ?? 6, maxLoaded: opts.maxLoaded ?? 900,
      load: (it, signal) => this.load(it, signal),
      unload: (it, payload) => this.unload(it, payload),
    });
    this.sched.onReady = (it) => this.ready(it);
    this.sched.onError = (it, err) => { if (err?.name !== 'AbortError') console.warn(`stream ${it.entry.file}: ${err.message}`); };
    this.bytesLoaded = 0;
    this.focusPoint = null;
  }

  get items() { return this.sched.items; }

  async load(it, signal) {
    const bytes = await this.source.bytes(it.entry.file, signal);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    this.bytesLoaded += bytes.byteLength;
    return this.pool.prepare(it.kind, bytes);
  }

  ready(it) {
    const p = it.payload;
    if (p.solid) {
      const map = SolidMap.from(p.solid);
      if (it.kind === 'chunk') this.query.setChunk(it.entry.cx, it.entry.cy, map);
      else this.query.setIsland({ id: it.entry.id, origin: [p.header.originX, p.header.originZ], yawDeg: p.header.yawDeg }, map);
    } else if (it.kind === 'chunk') this.query.setChunk(it.entry.cx, it.entry.cy, new SolidMap(0, 0, 0, 0, 0, 0));
    this.onReady(it);
  }

  unload(it, payload) {
    if (it.kind === 'chunk') this.query.setChunk(it.entry.cx, it.entry.cy, null);
    else this.query.removeIsland(it.entry.id);
    this.onUnload(it, payload);
  }

  isReady(it) { return it?.state === READY; }

  setRadius(r) { this.sched.setRadius(r); }

  /** Also stream around this three.js point (e.g. the player while the camera looks elsewhere). */
  focus(x, z, y = null) { this.focusPoint = x === null ? null : { x, z, y }; }

  /** eye: camera position (three.js); a focus point streams as a second eye at ground level. */
  update(eye, inView) {
    const eyes = this.focusPoint ? [eye, { x: this.focusPoint.x, y: this.focusPoint.y ?? 0, z: this.focusPoint.z }] : eye;
    return this.sched.update(eyes, inView);
  }

  settled() { return this.sched.settled(); }
  stats() { return { ...this.sched.counts(), mib: this.bytesLoaded / 1048576 }; }
}
