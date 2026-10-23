// Rotation and facing helpers (CONTRACT section 2, "Facing (v2)").
//
// The one rule: every directional piece has a FRONT, and at rot 0 the front faces +j
// (north). Callers should say which way the front faces (N/E/S/W) and let these helpers
// work out the rot, the rotated extent and where each footprint cell lands. Nothing else
// in the viewer should do rotation arithmetic by hand.
//
// Grid axes: i = east, j = north. rot turns the footprint clockwise seen from above, in
// steps of 90 degrees. A record's (i, j) is the MIN corner of its rotated bounding box.
// These functions are pure (no three.js) and are checked against
// contract/test_vectors/rotation.json by test/rotation.test.mjs.

/** Facing letter -> rot. The front of the piece looks toward that compass direction. */
export const FACING = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });

/** rot -> facing letter (inverse of FACING). */
export const FACING_NAMES = Object.freeze(['N', 'E', 'S', 'W']);

/** 'N' | 'E' | 'S' | 'W' -> rot. Throws on anything else so typos fail loudly. */
export function facingToRot(facing) {
  const rot = FACING[String(facing).toUpperCase()];
  if (rot === undefined) throw new Error(`unknown facing "${facing}" (use N, E, S or W)`);
  return rot;
}

/** Size of the rotated bounding box along (i, j): quarter turns swap w and d. */
export function rotatedExtent(w, d, rot) {
  return rot & 1 ? [d, w] : [w, d];
}

/**
 * Where the unrotated footprint cell (a along w, b along d) lands, as an offset (di, dj)
 * from the record position. Derivation: turning clockwise sends +j to +i and +i to -j;
 * the min-corner convention then shifts everything back to non-negative offsets.
 */
export function footprintCell(w, d, rot, a, b) {
  switch (rot & 3) {
    case 0: return [a, b];
    case 1: return [b, w - 1 - a];
    case 2: return [w - 1 - a, d - 1 - b];
    default: return [d - 1 - b, a];
  }
}

/** Unit grid step (di, dj) the front looks toward: rot 0 -> +j, 1 -> +i, 2 -> -j, 3 -> -i. */
export function frontDir(rot) {
  return [[0, 1], [1, 0], [0, -1], [-1, 0]][rot & 3];
}

/**
 * Yaw in radians for three.js (rotation about +y). Clockwise from above is a NEGATIVE
 * angle about +y because three.js is right-handed with y up.
 */
export function rotToYaw(rot) {
  return -(rot & 3) * Math.PI / 2;
}
