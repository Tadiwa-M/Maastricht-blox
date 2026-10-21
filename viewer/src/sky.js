// Gradient sky: soft blue overhead, warm haze at the horizon, a glow around the sun and soft
// procedural cumulus clouds (value-noise fbm projected onto a cloud plane; no textures).
//
// The same shader is used twice: as the visible background (a huge sphere drawn behind
// everything) and rendered into a PMREM environment map, so glass, water and plastic
// reflect this sky instead of a grey studio room.
import * as THREE from 'three';

const vertexShader = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.99999; // always at the far end
  }`;

const fragmentShader = /* glsl */`
  uniform vec3 top, horizon, below, sunDir, sunColor;
  uniform float sunGlow, clouds;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 c = mix(horizon, top, pow(smoothstep(-0.02, 0.22, y), 0.7)); // blue starts low, so it shows in street-level shots
    c = mix(c, below, smoothstep(0.0, -0.25, y));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    c += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35 + pow(s, 900.0) * 3.0) * sunGlow;
    if (y > 0.0 && clouds > 0.0) {
      vec2 uv = d.xz / (y + 0.08) * 1.6;               // flat cloud layer seen in perspective
      float n = fbm(uv + vec2(7.3, 2.1));
      float cover = smoothstep(0.58 - 0.22 * clouds, 0.78, n) * smoothstep(0.0, 0.04, y);
      vec3 lit = mix(horizon, vec3(1.0), 0.75) + sunColor * 0.12 * sunGlow;
      c = mix(c, lit * mix(0.82, 1.0, n), cover * 0.85);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      below: { value: new THREE.Color('#7d776c') }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#fff2d8') }, sunGlow: { value: 1 }, clouds: { value: 0.5 },
    },
    vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
  });
}

/** Sky sphere for the background plus an environment map baked from the same colours. */
export class Sky {
  constructor(renderer, radius = 3000) {
    this.material = skyMaterial();
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), this.material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envMaterial = skyMaterial();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.envMaterial));
    this.env = null;
  }

  /** Update colours (THREE.Color) and sun; re-bakes the environment map. */
  set({ top, horizon, sunDir, sunColor, sunGlow }) {
    for (const m of [this.material, this.envMaterial]) {
      m.uniforms.top.value.copy(top);
      m.uniforms.horizon.value.copy(horizon);
      m.uniforms.below.value.copy(horizon).multiplyScalar(0.55);
      m.uniforms.sunDir.value.copy(sunDir);
      m.uniforms.sunColor.value.copy(sunColor);
      m.uniforms.sunGlow.value = sunGlow;
      m.uniforms.clouds.value = 0.5 * sunGlow; // no clouds at night (they'd glow)
    }
    this.envMaterial.uniforms.sunGlow.value = sunGlow * 0.25; // no blinding sun dot in reflections
    const old = this.env;
    this.env = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    old?.dispose();
    return this.env.texture;
  }

  /** Keep the sphere centred on the camera so the horizon never moves. */
  follow(camera) { this.mesh.position.copy(camera.position); }
}
