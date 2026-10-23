// A small pool of Web Workers running src/prepare.js (src/stream-worker.js), with a main-thread
// fallback when workers can't start (file:// pages, #worker=0). Measured on samples/markt_v3:
// preparing a chunk takes ~26 ms and an island ~54 ms (max ~490 ms) on the main thread; in
// workers the main thread only builds GPU buffers from the result.
import { prepareItem } from './prepare.js';

export class PreparePool {
  /** meta: { palette, catalogue, manifest }; size: worker count (0 = main thread). */
  constructor(meta, { size = 3, url = 'stream-worker.js' } = {}) {
    this.meta = meta;
    this.workers = [];
    this.jobs = new Map();
    this.nextId = 1;
    this.rr = 0;
    for (let q = 0; q < size; q++) {
      let w;
      try { w = new Worker(url); } catch { break; }
      w.onmessage = (e) => this.done(e.data);
      w.onerror = (e) => { e.preventDefault?.(); this.fail(w, e.message || 'worker failed to start'); };
      w.postMessage({ meta });
      this.workers.push(w);
    }
  }

  get threaded() { return this.workers.length > 0; }

  fail(w, msg) {
    // a worker that cannot load (missing file) turns the pool into main-thread mode
    this.workers = this.workers.filter((x) => x !== w);
    w.terminate();
    for (const [id, job] of this.jobs) if (job.worker === w) { this.jobs.delete(id); this.runLocal(job); }
    console.warn(`stream worker: ${msg}; preparing on the main thread`);
  }

  done({ id, result, error }) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    if (error) job.reject(new Error(error)); else job.resolve(result);
  }

  runLocal(job) { prepareItem(job.kind, job.bytes, this.meta).then(job.resolve, job.reject); }

  /** kind 'chunk' | 'island', bytes (transferred to the worker). */
  prepare(kind, bytes) {
    return new Promise((resolve, reject) => {
      const job = { kind, bytes, resolve, reject };
      if (!this.workers.length) { this.runLocal(job); return; }
      const w = this.workers[this.rr++ % this.workers.length];
      const id = this.nextId++;
      job.worker = w;
      this.jobs.set(id, job);
      w.postMessage({ id, kind, bytes }, [bytes.buffer]);
    });
  }
}
