// Procedural water ripples: a tiling normal map made at startup (no image files) and the
// shader patch that scrolls two copies of it across water tops in world space.
//
// The height field is a sum of sine waves whose wave vectors are whole numbers of cycles
// per tile, so the texture repeats without a seam. Normals come from its gradient.
import * as THREE from 'three';

function rand(seed) { // small deterministic PRNG (mulberry32)
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** size x size RGBA normal map (xy = surface slope, packed to 0..255), RepeatWrapping. */
export function rippleNormalTexture(size = 128, waves = 24) {
  const r = rand(7);
  const list = [];
  for (let w = 0; w < waves; w++) {
    const kx = Math.round((r() * 2 - 1) * 9), ky = Math.round((r() * 2 - 1) * 9);
    if (!kx && !ky) continue;
    const amp = 1 / Math.hypot(kx, ky); // longer waves are taller
    list.push({ kx, ky, amp, ph: r() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const { kx, ky, amp, ph } of list) {
        const c = Math.cos(((kx * x + ky * y) / size) * Math.PI * 2 + ph) * amp;
        dx += c * kx; dy += c * ky; // d/dx and d/dy of amp * sin(...), up to a constant
      }
      const o = (y * size + x) * 4;
      data[o] = Math.max(0, Math.min(255, 128 + dx * 9));
      data[o + 1] = Math.max(0, Math.min(255, 128 + dy * 9));
      data[o + 2] = 255; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Patch a MeshPhysicalMaterial so faces pointing up get rippled normals.
 * Returns the uniforms ({ uTime }) to animate.
 */
export function addRipples(material, texture, strength = 0.35) {
  const uniforms = { uTime: { value: 0 }, uRipple: { value: texture }, uRippleStrength: { value: strength } };
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 waterP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          waterP = instanceMatrix * waterP;
        #endif
        vWaterXZ = (modelMatrix * waterP).xz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWaterXZ;
        uniform float uTime;
        uniform float uRippleStrength;
        uniform sampler2D uRipple;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 a = texture2D(uRipple, vWaterXZ * 0.11 + vec2(uTime * 0.012, uTime * 0.007)).xy * 2.0 - 1.0;
          vec2 b = texture2D(uRipple, vWaterXZ * 0.29 + vec2(-uTime * 0.021, uTime * 0.016)).xy * 2.0 - 1.0;
          vec2 s = (a + b * 0.6) * uRippleStrength;
          vec3 nView = normalize((viewMatrix * vec4(-s.x, 1.0, -s.y, 0.0)).xyz);
          vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          float upness = smoothstep(0.7, 0.95, dot(normal, upView));
          normal = normalize(mix(normal, nView, upness));
        }`);
  };
  material.customProgramCacheKey = () => 'water-ripples';
  return uniforms;
}
