// Streaming scheduler: which world files (chunks, islands) to have loaded for a camera, in what
// order, and which to drop. Pure logic (no three.js, no fetch), tested in test/stream.test.mjs.
//
// Every item has an axis-aligned box in three.js metres. Each update(eye):
//   - wanted   = items whose box lies within loadRadius of the eye (3D distance, so a camera
//                high above the city wants nothing and the baked far meshes carry the view)
//   - priority = distance to the box, halved for boxes in front of the camera (optional
//                `inView` test), so what you look at arrives first
//   - start    = up to `concurrency` loads in flight, best priority first
//   - abort    = in-flight loads whose item moved beyond loadRadius * abortFactor
//   - unload   = loaded items beyond unloadRadius, then the farthest while over maxLoaded
// load(item, signal) returns a Promise of the item's payload; unload(item, payload) frees it.
// A failed load is retried after `retryMs`, so a flaky connection heals by itself.

export const IDLE = 0, LOADING = 1, READY = 2, FAILED = 3;

/** Distance from point p {x, y, z} to box { min: {x,y,z}, max: {x,y,z} } (0 inside). */
export function boxDistance(box, p) {
  const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
  const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
  const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
  return Math.hypot(dx, dy, dz);
}

export class StreamScheduler {
  /**
   * items: [{ key, box }]. opts: { load, unload, loadRadius, unloadRadius, abortFactor,
   * concurrency, maxLoaded, retryMs, now }.
   */
  constructor(items, opts) {
    this.items = items.map((it) => ({ ...it, state: IDLE, dist: Infinity, payload: null, ctrl: null, failedAt: 0 }));
    this.byKey = new Map(this.items.map((it) => [it.key, it]));
    Object.assign(this, {
      loadRadius: 250, unloadRadius: null, abortFactor: 1.25, concurrency: 6, maxLoaded: 600, retryMs: 5000,
      now: () => Date.now(), unload: () => {},
    }, opts);
    this.inflight = 0;
    this.loadedCount = 0;
    this.stats = { started: 0, done: 0, aborted: 0, failed: 0, unloaded: 0 };
  }

  get(key) { return this.byKey.get(key); }

  setRadius(loadRadius, unloadRadius = null) { this.loadRadius = loadRadius; this.unloadRadius = unloadRadius; }

  /** Is everything within loadRadius loaded (screenshots wait for this)? */
  settled() { return this.pending === 0 && this.inflight === 0; }

  /** eye {x,y,z}; inView(box) -> bool (optional). Returns the number of loads started. */
  update(eye, inView = null) {
    const unloadR = this.unloadRadius ?? this.loadRadius * 1.5;
    const wanted = [];
    for (const it of this.items) {
      it.dist = boxDistance(it.box, eye);
      it.priority = it.dist * (inView && !inView(it.box) ? 2 : 1);
      if (it.state === LOADING && it.dist > this.loadRadius * this.abortFactor) this.abort(it);
      else if (it.state === READY && it.dist > unloadR) this.drop(it);
      else if (it.dist <= this.loadRadius && (it.state === IDLE || (it.state === FAILED && this.now() - it.failedAt > this.retryMs))) wanted.push(it);
    }
    wanted.sort((a, b) => a.priority - b.priority);
    this.pending = wanted.length;
    let started = 0;
    for (const it of wanted) {
      if (this.inflight >= this.concurrency) break;
      this.start(it);
      started++;
    }
    this.pending -= started;
    if (this.loadedCount > this.maxLoaded) {
      const ready = this.items.filter((it) => it.state === READY).sort((a, b) => b.dist - a.dist);
      for (const it of ready.slice(0, this.loadedCount - this.maxLoaded)) this.drop(it);
    }
    return started;
  }

  start(it) {
    it.state = LOADING;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : { signal: null, abort() {} };
    it.ctrl = ctrl;
    this.inflight++;
    this.stats.started++;
    let p;
    try { p = Promise.resolve(this.load(it, ctrl.signal)); } catch (e) { p = Promise.reject(e); }
    p.then((payload) => {
      if (it.ctrl !== ctrl) { this.unload(it, payload); return; } // aborted meanwhile
      it.ctrl = null;
      this.inflight--;
      it.state = READY;
      it.payload = payload;
      this.loadedCount++;
      this.stats.done++;
      this.onReady?.(it);
    }, (err) => {
      if (it.ctrl !== ctrl) return;
      it.ctrl = null;
      this.inflight--;
      it.state = FAILED;
      it.failedAt = this.now();
      this.stats.failed++;
      this.onError?.(it, err);
    });
  }

  abort(it) {
    const ctrl = it.ctrl;
    it.ctrl = null;
    it.state = IDLE;
    this.inflight--;
    this.stats.aborted++;
    ctrl?.abort();
  }

  drop(it) {
    const payload = it.payload;
    it.payload = null;
    it.state = IDLE;
    this.loadedCount--;
    this.stats.unloaded++;
    this.unload(it, payload);
  }

  counts() {
    return { items: this.items.length, loaded: this.loadedCount, inflight: this.inflight, pending: this.pending ?? 0, ...this.stats };
  }
}
