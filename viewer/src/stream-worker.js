// Web Worker: prepares streamed chunks and islands off the main thread (src/prepare.js).
// Messages in: { meta } once, then { id, kind, bytes }; out: { id, result } or { id, error }.
import { prepareItem, transferables } from './prepare.js';

let meta = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.meta) { meta = m.meta; return; }
  try {
    const result = await prepareItem(m.kind, m.bytes, meta);
    self.postMessage({ id: m.id, result }, transferables(result));
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.message || err) });
  }
};
