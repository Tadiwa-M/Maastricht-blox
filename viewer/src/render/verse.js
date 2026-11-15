// The comic-print focus (work in progress toward the owner's Spider-Verse reference; behind the
// test flag #look=verse, not a menu setting yet): what is in focus stays a clean render; what is
// out of focus is not blurred but printed badly: the colour plates slip apart, a halftone dot
// screen and fine diagonal hatching come in, more the further from focus. Depth from the AO pass
// (GTAOPass renders it anyway). Also animation on twos: figures pose 12 times a second
// (figure/crowd.js reads twosTick) while the camera moves smoothly.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const VERSE = { twosHz: 12, maxSlip: 1.3, focusSpan: 1.0 };
export const lookFromHash = (hash) => /(?:^|[#&])look=(verse|manga)(?:&|$)/.exec(hash || '')?.[1] || null;
/** The look of this page: null (the toy look), 'verse' (comic colour) or 'manga' (ink and screentone). */
export const LOOK = typeof location !== 'undefined' ? lookFromHash(location.hash) : null;
/** Painted looks: textured materials, figures and vehicles finished as film props. */
export const PAINTED_LOOK = LOOK === 'verse' || LOOK === 'manga';

/** The animation-on-twos tick for a time in seconds (a new pose only when it changes). */
export const twosTick = (t, hz = VERSE.twosHz) => Math.floor(t * hz);

const shader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, tNormal: { value: null }, near: { value: 0.1 }, far: { value: 1000 }, depthOk: { value: 1 }, night: { value: 0 }, focus: { value: 10 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform float near; uniform float far; uniform float depthOk; uniform float night; uniform float focus; uniform vec2 res;
    varying vec2 vUv;
    float dist(vec2 uv) { float d = texture2D(tDepth, uv).x; return depthOk > 0.5 ? (near * far) / (far - d * (far - near)) : focus; } // (no depth: all in focus, no lines)
    vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).rgb * 2.0 - 1.0; } // view-space normal (the AO pass)
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float dots(vec2 f, float ang, float size, float amount) {
      float s = sin(ang), c = cos(ang); vec2 p = mat2(c, -s, s, c) * f / size;
      // (no dot at all for no amount: a zero-size dot still drew a speck at every grid point)
      return (1.0 - smoothstep(-0.07, 0.07, length(fract(p) - 0.5) - sqrt(clamp(amount, 0.0, 1.0)) * 0.55)) * smoothstep(0.0, 0.05, amount);
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
      float own = smoothstep(0.12, 0.35, length(chroma) / max(L, 0.05)); // tinted greys (moonlit paving) stay grey
      chroma *= keep * mix(0.92, 1.22, own) * mix(0.85, 1.0, smoothstep(0.12, 0.35, L2)); // a restrained palette, accents carry the colour
      // a slight hue shift by value: shade a touch cooler, light a touch warmer (the colour itself stays)
      vec3 cool = vec3(-0.012, 0.0, 0.03), warm = vec3(0.025, 0.008, -0.025);
      // (scaled with the value: in a dark night frame a fixed shift would turn everything navy)
      vec3 shift = mix(cool, warm, smoothstep(0.25, 0.7, L2)) * clamp(L2 / 0.45, 0.25, 1.0);
      return clamp(vec3(L2) + chroma + shift, 0.0, 1.0);
    }
    #ifdef MANGA
    // ink on paper: the value picks a tone (paper, fine screentone, dense screentone, cross-hatching,
    // solid black); lines in ink at silhouettes (bold) and creases (fine), lighter with distance;
    // the sky is paper; lights stay paper white. Night is lifted so it stays readable.
    vec3 manga(vec3 base, float z, float sky, float dEdge, float nEdge, float nearK, vec2 f) {
      float L = luma(base);
      L = mix(L, pow(L, 0.55), night);
      L = mix(L, 1.0, smoothstep(250.0, 1400.0, z) * 0.55); // aerial: distance goes pale
      float s = sin(0.785), co = cos(0.785);
      vec2 q = mat2(co, -s, s, co) * f / 4.0; // a 45-degree screen, 4 px pitch
      float dotR = length(fract(q) - 0.5);
      float tone = 1.0;
      float t1 = 1.0 - smoothstep(0.5, 0.56, L), t2 = 1.0 - smoothstep(0.3, 0.36, L), t3 = 1.0 - smoothstep(0.16, 0.21, L), t4 = 1.0 - smoothstep(0.05, 0.08, L); // mostly paper
      tone -= t1 * (1.0 - smoothstep(0.17, 0.23, dotR)) * (1.0 - t2);         // fine dots
      tone -= t2 * (1.0 - smoothstep(0.3, 0.36, dotR)) * (1.0 - t3);          // dense dots
      float h1 = step(0.62, fract((f.x + f.y) / 3.5)), h2 = step(0.62, fract((f.x - f.y) / 3.5));
      tone -= t3 * max(h1, h2 * t3) * (1.0 - t4) * 0.95;                      // cross-hatching
      tone = mix(tone, 0.0, t4);                                              // solid black
      tone = mix(tone, 1.0, sky);
      float ink = max(dEdge, nEdge * 0.5) * mix(0.35, 1.0, nearK) * (1.0 - sky);
      vec3 paper = vec3(0.965, 0.955, 0.925), black = vec3(0.07, 0.065, 0.075);
      return mix(black, paper, clamp(tone, 0.0, 1.0) * (1.0 - ink));
    }
    #endif
    void main() {
      vec2 px = 1.0 / res;
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      // crisp: a light unsharp mask (detail at full resolution, no halo on lights)
      vec3 nb = (texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
        + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25;
      base = clamp(base + (base - nb) * 0.32 * (1.0 - smoothstep(0.85, 1.0, luma(base))), 0.0, 1.0);
      float z = dist(vUv);
      // in front of the focus counts half (people passing close by stay readable); the sky is not printed
      float rel = (z < focus ? (focus - z) * 0.5 : z - focus) / max(focus, 0.5);
      float sky = max(step(far * 0.92, z), step(2400.0, z)); // cleared depth, or the sky dome (3 km round the camera)
      float coc = smoothstep(${VERSE.focusSpan.toFixed(2)}, 4.0, rel);
      float bright = smoothstep(0.55, 0.8, luma(base)); // lit windows and lamps stay clean
      // the print slip only on soft shapes: lights stay clean glows
      float slip = coc * (1.0 - bright) * (1.0 - sky);
      vec2 dir = normalize(vec2(1.0, 0.35)) / res * slip * ${VERSE.maxSlip.toFixed(1)};
      vec3 c = vec3(slip > 0.01 ? texture2D(tDiffuse, vUv + dir).r : base.r, base.g, slip > 0.01 ? texture2D(tDiffuse, vUv - dir).b : base.b);
      c = treat(c);
      // a modelled look: fine lines where a shape passes in front of another (depth) and lighter
      // ones at creases (normals), drawn in a darker shade of the surface's own colour; a rim of
      // light on edges turning away from the eye. Fades with distance and out of focus.
      vec3 n0 = nrm(vUv);
      float zx = dist(vUv + vec2(px.x, 0.0)), zy = dist(vUv + vec2(0.0, px.y)), zx2 = dist(vUv - vec2(px.x, 0.0)), zy2 = dist(vUv - vec2(0.0, px.y));
      float dEdge = smoothstep(0.035, 0.08, (abs(zx - z) + abs(zy - z) + abs(zx2 - z) + abs(zy2 - z)) / max(z, 0.5));
      float nEdge = smoothstep(0.6, 1.1, (1.0 - dot(n0, nrm(vUv + vec2(px.x, 0.0)))) + (1.0 - dot(n0, nrm(vUv + vec2(0.0, px.y)))));
      float near = 1.0 - smoothstep(60.0, 260.0, z);
      float line = max(dEdge, nEdge * 0.35) * near * (1.0 - coc * 0.7) * (1.0 - sky); // (the sky has no normals: no lines in the clouds)
      c = mix(c, c * 0.42, line * 0.85);
      float rim = smoothstep(0.55, 0.92, 1.0 - abs(n0.z)) * near * (1.0 - dEdge) * (1.0 - sky);
      c += rim * 0.07 * vec3(1.0, 0.95, 0.88);
      float L = luma(c);
      vec2 f = gl_FragCoord.xy;
      float shade = 1.0 - smoothstep(0.12, 0.55, L);
      float soft = smoothstep(0.55, 0.95, slip); // print texture only where it is clearly out of focus
      // the print texture sits in the shade only: lit walls and the street stay clean colour
      c *= 1.0 - 0.18 * dots(f, 0.42, 5.0, soft * shade * 0.8);
      // fine hatching drawn into the shadows, in focus too (the reference's shaded side), fading with distance
      c *= 1.0 - (0.05 + 0.08 * soft) * shade * shade * (0.4 + 0.6 * near) * smoothstep(0.55, 0.85, fract((f.x - f.y * 0.6) / 3.2));
      #ifdef MANGA
        gl_FragColor = vec4(manga(base, z, sky, dEdge, nEdge, near, f), 1.0);
      #else
        gl_FragColor = vec4(c, 1.0);
      #endif
    }`,
};

/** The pass (after the grade: it treats the displayed colours). */
export function makeVersePass(gtao, look = 'verse') {
  const pass = new ShaderPass(look === 'manga' ? { ...shader, defines: { MANGA: 1 } } : shader);
  pass.uniforms.tDepth.value = gtao.depthTexture;
  pass.uniforms.tNormal.value = gtao.normalTexture;
  return pass;
}

/** Per frame: the camera and the focus distance (m: to the player, or the orbit target). */
export function updateVerse(pass, camera, focus, width, height, night = 0) {
  const u = pass.uniforms;
  u.night.value = night;
  u.near.value = camera.near; u.far.value = camera.far; u.focus.value = focus;
  u.res.value.set(width, height);
}
