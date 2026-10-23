// Grid <-> three.js placement (CONTRACT section 1).
//
// three.js: x = I * stud (east), y = K * plate (up), z = -J * stud (north is -z, so the
// scene is not mirrored). Brick geometry is modelled centred on its UNROTATED footprint
// with its front toward -z (= +j); brickMatrix turns and moves it onto the record.
import * as THREE from 'three';
import { rotatedExtent, rotToYaw } from './rotation.js';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Grid coordinates (may be fractional) -> three.js position. */
export function gridToThree(I, J, K, studM, plateM, out = new THREE.Vector3()) {
  return out.set(I * studM, K * plateM, -J * studM);
}

/** Unity world metres (x east, y up, z north) -> three.js position. */
export function unityToThree(x, y, z, out = new THREE.Vector3()) {
  return out.set(x, y, -z);
}

/** Matrix for a w x d brick record at min corner (I, J, K) with rotation rot. */
export function brickMatrix(I, J, K, w, d, rot, studM, plateM, out = new THREE.Matrix4()) {
  const [ei, ej] = rotatedExtent(w, d, rot);
  const pos = gridToThree(I + ei / 2, J + ej / 2, K, studM, plateM);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, rotToYaw(rot));
  return out.compose(pos, q, ONE);
}
