// Where world files come from: a static site over HTTP (build.mjs --site) or the base64 embed
// (build.mjs default, window.BLOX_WORLD). Both give bytes(path, signal) and json(path).
import { b64ToBytes } from './world.js';

/** Files under a base URL (e.g. 'world/'). Aborting rejects with an AbortError. */
export function httpSource(base) {
  const url = (p) => new URL(p, new URL(base, location.href)).href;
  return {
    kind: 'http',
    async bytes(path, signal) {
      const r = await fetch(url(path), { signal });
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async json(path) {
      const r = await fetch(url(path));
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    },
  };
}

/** Files embedded as { 'chunks/c_1_2.bxc': base64 } plus parsed JSON. */
export function embeddedSource(files, jsons = {}) {
  return {
    kind: 'embedded',
    async bytes(path) {
      if (!(path in files)) throw new Error(`${path}: not embedded`);
      return b64ToBytes(files[path]);
    },
    async json(path) {
      if (!(path in jsons)) throw new Error(`${path}: not embedded`);
      return jsons[path];
    },
  };
}
