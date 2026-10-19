// Gradient sky: soft blue overhead, warm haze at the horizon, a glow around the sun.
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
  uniform float sunGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 c = mix(horizon, top, pow(smoothstep(0.0, 0.85, y), 0.55));
    c = mix(c, below, smoothstep(0.0, -0.25, y));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    c += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35 + pow(s, 900.0) * 3.0) * sunGlow;
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      below: { value: new THREE.Color('#7d776c') }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color('#fff2d8') }, sunGlow: { value: 1 },
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
