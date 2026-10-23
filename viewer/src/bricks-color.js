// Brick colour with its small deterministic variation (shared by the near look, the far looks,
// the stream worker and the far bake; no geometry imports, so a worker bundle stays small).
import * as THREE from 'three';
import { hash3 } from './hash.js';

export const VARIATION = 0.03; // +-3 % value

/** Linear colour of a palette entry, varied by a hash of the cell unless exact. */
export function brickColor(entry, I, J, K, exact, out = new THREE.Color()) {
  out.set(entry?.srgb || '#ff00ff');
  if (!exact) {
    const f = 1 + (hash3(I, J, K) * 2 - 1) * VARIATION;
    out.convertLinearToSRGB().multiplyScalar(f).convertSRGBToLinear();
  }
  return out;
}

