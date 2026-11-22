// Ink outlines for characters (the manga look): the "inverted hull" of anime games. Each figure
// part is drawn a second time, back faces only, pushed out along its normals by a fixed number of
// screen pixels, in ink: a clean, thick, even line round every silhouette at any distance and any
// resolution (a line found from depth breaks up; this one doesn't). Shares the part's instance
// matrices, so it costs one more draw call per part mesh.
import * as THREE from 'three';
import { LOOK } from './verse.js';

/** Outline width in CSS pixels by look (0: none). */
export const OUTLINE_PX = { manga: 2.0 }; // the characters' line: firm, not heavy
export const OUTLINE_ON = !!OUTLINE_PX[LOOK];
export const outlineUniforms = { uOutlinePx: { value: OUTLINE_PX[LOOK] || 0 }, uScreenH: { value: 800 } };

let shared = null;
export function outlineMaterial() {
  if (shared) return shared;
  shared = new THREE.ShaderMaterial({
    uniforms: outlineUniforms, side: THREE.BackSide, fog: false,
    vertexShader: `uniform float uOutlinePx; uniform float uScreenH;
      void main() {
        vec4 p = vec4(position, 1.0); vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p;
        vec3 nv = normalize(mat3(modelViewMatrix) * n);
        // a fixed width on screen: world offset = pixels x depth x 2 / (focal x screen height)
        float w = uOutlinePx * max(-mv.z, 0.1) * 2.0 / (projectionMatrix[1][1] * uScreenH);
        mv.xyz += nv * w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(0.035, 0.02, 0.055, 1.0); }',
  });
  return shared;
}

/** An outline twin for an InstancedMesh (shares its geometry and instance matrices). */
export function outlineFor(mesh) {
  const o = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(), mesh.instanceMatrix.count);
  o.instanceMatrix = mesh.instanceMatrix;
  o.count = 0; o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
  o.name = `${mesh.name}:outline`;
  return o;
}
