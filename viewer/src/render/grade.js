// The final pass: tone mapping, colour grade, vignette and (High) edge anti-aliasing in ONE
// full-screen pass, replacing three.js's OutputPass, so the grade costs no extra pass on any tier.
//
// Grade (the vivid miniature look): a little extra saturation and contrast after tone mapping,
// warm highlights and slightly cool shadows, and a soft vignette that draws the eye to the
// middle of the table. Values come from the time of day (gradeAt in render/look.js).
// AA (#define FXAA, High only): a compact FXAA on the tone-mapped image (5 taps plus 2 along the
// edge); the scene is drawn into render targets without MSAA, so this is High's only smoothing.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const TONE = {
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING', [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
};

const vertexShader = /* glsl */`
  precision highp float;
  uniform mat4 modelViewMatrix, projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const fragmentShader = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  uniform float saturation, contrast, vignette;
  uniform vec3 lift, gain;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  vec3 tone(vec3 c) {
    #if defined(ACES_FILMIC_TONE_MAPPING)
      return ACESFilmicToneMapping(c);
    #elif defined(AGX_TONE_MAPPING)
      return AgXToneMapping(c);
    #elif defined(NEUTRAL_TONE_MAPPING)
      return NeutralToneMapping(c);
    #elif defined(REINHARD_TONE_MAPPING)
      return ReinhardToneMapping(c);
    #elif defined(LINEAR_TONE_MAPPING)
      return LinearToneMapping(c);
    #elif defined(CINEON_TONE_MAPPING)
      return CineonToneMapping(c);
    #else
      return c;
    #endif
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  vec3 fetch(vec2 uv) { return tone(texture2D(tDiffuse, uv).rgb); }
  void main() {
    vec3 c = fetch(vUv);
    #ifdef FXAA
    {
      float lM = luma(c);
      float lN = luma(fetch(vUv + vec2(0.0, texel.y))), lS = luma(fetch(vUv - vec2(0.0, texel.y)));
      float lE = luma(fetch(vUv + vec2(texel.x, 0.0))), lW = luma(fetch(vUv - vec2(texel.x, 0.0)));
      float lo = min(lM, min(min(lN, lS), min(lE, lW))), hi = max(lM, max(max(lN, lS), max(lE, lW)));
      float range = hi - lo;
      if (range > max(0.04, hi * 0.12)) {
        // blend across the edge (perpendicular to the steeper gradient), by how much the
        // centre stands out from its neighbours: a cheap stand-in for FXAA's edge search
        bool horiz = abs(lN + lS - 2.0 * lM) >= abs(lE + lW - 2.0 * lM);
        vec2 step = horiz ? vec2(0.0, texel.y) : vec2(texel.x, 0.0);
        float g1 = abs((horiz ? lS : lW) - lM), g2 = abs((horiz ? lN : lE) - lM);
        vec2 dir = g1 >= g2 ? -step : step;
        float sub = clamp(abs((lN + lS + lE + lW) * 0.25 - lM) / range, 0.0, 1.0);
        float amt = sub * sub * (3.0 - 2.0 * sub) * 0.75;
        vec3 across = fetch(vUv + dir * 0.5);
        vec2 along = horiz ? vec2(texel.x, 0.0) : vec2(0.0, texel.y);
        vec3 edge = (fetch(vUv + dir * 0.5 + along) + fetch(vUv + dir * 0.5 - along) + across * 2.0) * 0.25;
        c = mix(c, edge, amt);
      }
    }
    #endif
    // grade (display-referred, 0..1)
    float l = luma(c);
    c = mix(vec3(l), c, saturation);
    // contrast as an S-curve that keeps black and white where they are (a straight line through
    // mid grey crushed night scenes and deep shadows to black)
    c = clamp(c, 0.0, 1.0);
    c = mix(c, c * c * (3.0 - 2.0 * c), (contrast - 1.0) * 2.0);
    c = c * mix(lift, gain, smoothstep(0.0, 1.0, l)) ;
    vec2 v = vUv - 0.5;
    c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(v, v) * 2.2);
    gl_FragColor = vec4(c, 1.0);
    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif
  }`;

export class GradePass extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, texel: { value: new THREE.Vector2(1, 1) },
      saturation: { value: 1.1 }, contrast: { value: 1.06 }, vignette: { value: 0.18 },
      lift: { value: new THREE.Vector3(0.97, 0.99, 1.03) }, gain: { value: new THREE.Vector3(1.03, 1.0, 0.96) },
    };
    this.material = new THREE.RawShaderMaterial({ name: 'GradePass', uniforms: this.uniforms, vertexShader, fragmentShader });
    this.fsQuad = new FullScreenQuad(this.material);
    this.aa = false;
    this._key = null;
  }

  /** grade: { saturation, contrast, vignette, lift: [r,g,b], gain: [r,g,b] } (render/look.js). */
  setGrade(g) {
    const u = this.uniforms;
    u.saturation.value = g.saturation; u.contrast.value = g.contrast; u.vignette.value = g.vignette;
    u.lift.value.fromArray(g.lift); u.gain.value.fromArray(g.gain);
  }

  setSize(w, h) { this.uniforms.texel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h)); }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const srgb = THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer;
    const key = `${renderer.toneMapping}|${srgb}|${this.aa}`;
    if (key !== this._key) {
      this._key = key;
      const d = {};
      if (srgb) d.SRGB_TRANSFER = '';
      if (TONE[renderer.toneMapping]) d[TONE[renderer.toneMapping]] = '';
      if (this.aa) d.FXAA = '';
      this.material.defines = d;
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}
