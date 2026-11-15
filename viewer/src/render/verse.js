// The comic-print focus (work in progress toward the owner's Spider-Verse reference; behind the
// test flag #look=verse, not a menu setting yet): what is in focus stays a clean render; what is
// out of focus is not blurred but printed badly: the colour plates slip apart, a halftone dot
// screen and fine diagonal hatching come in, more the further from focus. Depth from the AO pass
// (GTAOPass renders it anyway). Also animation on twos: figures pose 12 times a second
// (figure/crowd.js reads twosTick) while the camera moves smoothly.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const VERSE = { twosHz: 12, maxSlip: 4.5, focusSpan: 0.18 };
export const lookFromHash = (hash) => (/(?:^|[#&])look=verse(?:&|$)/.test(hash || '') ? 'verse' : null);

/** The animation-on-twos tick for a time in seconds (a new pose only when it changes). */
export const twosTick = (t, hz = VERSE.twosHz) => Math.floor(t * hz);

const shader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 1000 }, focus: { value: 10 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float near; uniform float far; uniform float focus; uniform vec2 res;
    varying vec2 vUv;
    float dist(vec2 uv) { float d = texture2D(tDepth, uv).x; return (near * far) / (far - d * (far - near)); }
    float dots(vec2 f, float ang, float size, float amount) {
      float s = sin(ang), c = cos(ang); vec2 p = mat2(c, -s, s, c) * f / size;
      return 1.0 - smoothstep(-0.07, 0.07, length(fract(p) - 0.5) - sqrt(clamp(amount, 0.0, 1.0)) * 0.55);
    }
    void main() {
      float z = dist(vUv);
      // out of focus: in front of or beyond the focus distance, relative to it (a lens-like falloff)
      float rel = abs(z - focus) / max(focus, 0.5);
      float coc = smoothstep(${VERSE.focusSpan.toFixed(2)}, 1.2, rel);
      vec2 dir = normalize(vec2(1.0, 0.35)) / res * coc * ${VERSE.maxSlip.toFixed(1)};
      vec3 c = vec3(texture2D(tDiffuse, vUv + dir).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - dir).b);
      float L = dot(c, vec3(0.299, 0.587, 0.114));
      vec2 f = gl_FragCoord.xy;
      float shade = 1.0 - smoothstep(0.05, 0.6, L);
      // halftone where it is soft, denser in its shade; fine diagonal hatching on top
      c *= 1.0 - 0.32 * dots(f, 0.42, 5.0, coc * (0.25 + 0.6 * shade));
      c *= 1.0 - 0.22 * coc * step(0.78, fract((f.x - f.y) / 4.5));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** The pass (insert before the grade, so it works on the linear image). */
export function makeVersePass(gtao) {
  const pass = new ShaderPass(shader);
  pass.uniforms.tDepth.value = gtao.depthTexture;
  return pass;
}

/** Per frame: the camera and the focus distance (m: to the player, or the orbit target). */
export function updateVerse(pass, camera, focus, width, height) {
  const u = pass.uniforms;
  u.near.value = camera.near; u.far.value = camera.far; u.focus.value = focus;
  u.res.value.set(width, height);
}
