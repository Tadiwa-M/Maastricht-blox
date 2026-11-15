// The comic-print focus (work in progress toward the owner's Spider-Verse reference; behind the
// test flag #look=verse, not a menu setting yet): what is in focus stays a clean render; what is
// out of focus is not blurred but printed badly: the colour plates slip apart, a halftone dot
// screen and fine diagonal hatching come in, more the further from focus. Depth from the AO pass
// (GTAOPass renders it anyway). Also animation on twos: figures pose 12 times a second
// (figure/crowd.js reads twosTick) while the camera moves smoothly.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const VERSE = { twosHz: 12, maxSlip: 2.6, focusSpan: 0.55 };
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
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float dots(vec2 f, float ang, float size, float amount) {
      float s = sin(ang), c = cos(ang); vec2 p = mat2(c, -s, s, c) * f / size;
      return 1.0 - smoothstep(-0.07, 0.07, length(fract(p) - 0.5) - sqrt(clamp(amount, 0.0, 1.0)) * 0.55);
    }
    // the colour treatment: the city's own colours, handled like a comic. Works on lightness and
    // chroma separately so a colour keeps its hue at every value.
    vec3 treat(vec3 c) {
      float L = luma(c);
      vec3 chroma = c - L;
      // values in clear groups: a soft three-step (shade, mid, light) blended with the original
      float s1 = smoothstep(0.20, 0.27, L), s2 = smoothstep(0.50, 0.57, L);
      float grouped = mix(mix(0.16, 0.42, s1), 0.78, s2) + (L - mix(mix(0.16, 0.42, s1), 0.78, s2)) * 0.35;
      float L2 = mix(L, grouped, 0.55);
      L2 = max(L2, 0.085 + L2 * 0.6 * step(L2, 0.085)); // a lifted toe: never crushed to black
      // chroma: kept with the colour as the value moves (no greying in the shade), punchier
      float keep = clamp(L2 / max(L, 0.03), 0.6, 1.8);
      // punchier colour, but a colourless shade (moonlight, sky fill) is not pushed into a blue wash
      float own = smoothstep(0.03, 0.12, length(chroma) / max(L, 0.05));
      chroma *= keep * mix(1.05, 1.32, own) * mix(0.85, 1.0, smoothstep(0.12, 0.35, L2));
      // a slight hue shift by value: shade a touch cooler, light a touch warmer (the colour itself stays)
      vec3 cool = vec3(-0.012, 0.0, 0.03), warm = vec3(0.025, 0.008, -0.025);
      vec3 shift = mix(cool, warm, smoothstep(0.25, 0.7, L2));
      return clamp(vec3(L2) + chroma + shift, 0.0, 1.0);
    }
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      float z = dist(vUv);
      float rel = abs(z - focus) / max(focus, 0.5);
      float coc = smoothstep(${VERSE.focusSpan.toFixed(2)}, 2.6, rel);
      float bright = smoothstep(0.82, 0.98, luma(base));
      // the print slip only on soft shapes: lights stay clean glows
      float slip = coc * (1.0 - bright);
      vec2 dir = normalize(vec2(1.0, 0.35)) / res * slip * ${VERSE.maxSlip.toFixed(1)};
      vec3 c = vec3(texture2D(tDiffuse, vUv + dir).r, base.g, texture2D(tDiffuse, vUv - dir).b);
      c = treat(c);
      float L = luma(c);
      vec2 f = gl_FragCoord.xy;
      float shade = 1.0 - smoothstep(0.12, 0.55, L);
      float soft = smoothstep(0.3, 0.8, slip); // print texture only where it is clearly out of focus
      c *= 1.0 - 0.22 * dots(f, 0.42, 5.0, soft * (0.2 + 0.6 * shade));
      c *= 1.0 - 0.14 * soft * step(0.8, fract((f.x - f.y) / 4.5));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** The pass (after the grade: it treats the displayed colours). */
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
