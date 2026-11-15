// The comic-print focus (work in progress toward the owner's Spider-Verse reference; behind the
// test flag #look=verse, not a menu setting yet): what is in focus stays a clean render; what is
// out of focus is not blurred but printed badly: the colour plates slip apart, a halftone dot
// screen and fine diagonal hatching come in, more the further from focus. Depth from the AO pass
// (render/depthpass.js keeps the scene render's depth). Also animation on twos: figures pose 12 times a second
// (figure/crowd.js reads twosTick) while the camera moves smoothly.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const VERSE = { twosHz: 12, maxSlip: 1.3, focusSpan: 1.0 };
export const lookFromHash = (hash) => /(?:^|[#&])look=(verse|manga)(?:&|$)/.exec(hash || '')?.[1] || null;
/** Looks offered in the pause menu (manga stays a test flag until it is right). */
export const MENU_LOOKS = [{ id: null, name: 'Classic' }, { id: 'verse', name: 'Comic' }];
const STORE_KEY = 'blox.look';
const safeStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/** The look for a page: the address (#look=verse|manga|classic) wins, then the saved choice. */
export function chooseLook(hash, store = safeStore()) {
  const h = lookFromHash(hash);
  if (h) return h;
  if (/(?:^|[#&])look=classic(?:&|$)/.test(hash || '')) return null;
  try { const s = store?.getItem(STORE_KEY); return s === 'verse' || s === 'manga' ? s : null; } catch { return null; }
}

/** The look of this page: null (the toy look), 'verse' (comic colour) or 'manga' (ink and screentone). */
export const LOOK = typeof location !== 'undefined' ? chooseLook(location.hash) : null;

/** The address for another look (keeps the other hash settings). */
export function hashWithLook(hash, id) {
  const parts = (hash || '').replace(/^#/, '').split('&').filter((p) => p && !p.startsWith('look='));
  parts.push(`look=${id || 'classic'}`);
  return `#${parts.join('&')}`;
}

/** Switch look: save it and reload (materials are compiled for one look). */
export function switchLook(id) {
  try { safeStore()?.setItem(STORE_KEY, id || 'classic'); } catch { /* storage blocked: the address still carries it */ }
  location.hash = hashWithLook(location.hash, id);
  location.reload();
}
/** Painted looks: textured materials, figures and vehicles finished as film props. */
export const PAINTED_LOOK = LOOK === 'verse' || LOOK === 'manga';

/** The animation-on-twos tick for a time in seconds (a new pose only when it changes). */
export const twosTick = (t, hz = VERSE.twosHz) => Math.floor(t * hz);

const shader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, fovScale: { value: new THREE.Vector2(1, 1) }, near: { value: 0.1 }, far: { value: 1000 }, depthOk: { value: 1 }, night: { value: 0 }, dpr: { value: 1 }, phone: { value: 0 }, fxImpact: { value: 0 }, fxAt: { value: new THREE.Vector2(0.5, 0.5) }, fxSplit: { value: 0 }, fxDuo: { value: 0 }, fxLines: { value: 1 }, fxDuoLo: { value: new THREE.Vector3() }, fxDuoHi: { value: new THREE.Vector3() }, focus: { value: 10 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 fovScale; uniform float near; uniform float far; uniform float depthOk; uniform float night; uniform float dpr; uniform float phone; uniform float fxImpact; uniform vec2 fxAt; uniform float fxSplit; uniform float fxDuo; uniform float fxLines; uniform vec3 fxDuoLo; uniform vec3 fxDuoHi; uniform float focus; uniform vec2 res;
    varying vec2 vUv;
    float dist(vec2 uv) { float d = texture2D(tDepth, uv).x; return depthOk > 0.5 ? (near * far) / (far - d * (far - near)) : focus; } // (no depth: all in focus, no lines)
    vec3 vpos(vec2 uv) { float z = dist(uv); return vec3((uv * 2.0 - 1.0) * fovScale * z, -z); }
    vec3 nrm(vec2 uv) { // view-space normal from the depth (no second scene render for normals)
      vec2 px = 1.0 / res; vec3 p = vpos(uv);
      return normalize(cross(vpos(uv + vec2(px.x, 0.0)) - p, vpos(uv + vec2(0.0, px.y)) - p));
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float dots(vec2 f, float ang, float size, float amount) {
      float s = sin(ang), c = cos(ang); vec2 p = mat2(c, -s, s, c) * f / size;
      // (no dot at all for no amount: a zero-size dot still drew a speck at every grid point)
      return (1.0 - smoothstep(-0.07, 0.07, length(fract(p) - 0.5) - sqrt(clamp(amount, 0.0, 1.0)) * 0.55)) * smoothstep(0.0, 0.05, amount);
    }
    float hHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float hNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hHash(i), hHash(i + vec2(1, 0)), f.x), mix(hHash(i + vec2(0, 1)), hHash(i + vec2(1, 1)), f.x), f.y); }
    // inked hatching like the film's: parallel lines whose direction follows the surface (from its
    // screen-space normal, in four set directions so it reads drawn, not computed), whose width
    // grows with the shade, tapered and broken by a slow noise (a pen, not a ruler); a second set
    // across them only in the deepest shade. f: pixel, n: view normal, shade 0..1, pitch in px.
    float hatchLines(vec2 f, float ang, float pitch, float w) {
      vec2 d = vec2(cos(ang), sin(ang));
      float u = dot(f, vec2(-d.y, d.x)) / pitch;
      float taper = hNoise(vec2(dot(f, d) / (pitch * 6.0), floor(u) * 1.7));
      float x = abs(fract(u) - 0.5) * 2.0; // 0 on the line, 1 between lines
      float ww = w * smoothstep(0.15, 0.55, taper);
      return 1.0 - smoothstep(ww - 0.12, ww + 0.12, x);
    }
    float inkHatch(vec2 f, vec3 n, float shade, float pitch) {
      float a = atan(n.y, n.x);
      float ang = floor(a / 0.7854 + 0.5) * 0.7854 + 0.785; // across the form, snapped to 45 degrees
      float w = mix(0.0, 0.62, smoothstep(0.15, 1.0, shade));
      float h = hatchLines(f, ang, pitch, w);
      float cross = hatchLines(f, ang + 1.5708, pitch, mix(0.0, 0.5, smoothstep(0.7, 1.0, shade)));
      return max(h, cross);
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
      chroma *= keep * mix(0.74, 1.04, own) * mix(0.85, 1.0, smoothstep(0.12, 0.35, L2)); // the film's muted palette: accents carry the colour
      // a slight hue shift by value: shade a touch cooler, light a touch warmer (the colour itself stays)
      vec3 cool = vec3(-0.012, 0.0, 0.03), warm = vec3(0.025, 0.008, -0.025);
      // (scaled with the value: in a dark night frame a fixed shift would turn everything navy)
      vec3 shift = mix(cool, warm, smoothstep(0.25, 0.7, L2)) * clamp(L2 / 0.45, 0.25, 1.0);
      vec3 o = clamp(vec3(L2) + chroma + shift, 0.0, 1.0);
      // the film's print: mids a little deeper, highlights rolled off (no paper white), blacks
      // lifted toward a cool ink
      o = pow(o, vec3(1.1));
      o = mix(o, 0.9 + (o - 0.9) * 0.35, step(0.9, o));
      // split toning, kept gentle: the shade a little cool (violet at night), the light all but
      // neutral (the sun's own colour already warms it; an amber on top turned people orange)
      float Lo = luma(o);
      vec3 shadeT = mix(vec3(0.96, 0.99, 1.04), vec3(0.98, 0.94, 1.06), night), lightT = vec3(1.015, 1.0, 0.98);
      o *= mix(shadeT, lightT, smoothstep(0.12, 0.72, Lo));
      return o * 0.95 + vec3(0.018, 0.022, 0.034);
    }
    #ifdef MANGA
    // ink on paper: the value picks a tone (paper, fine screentone, dense screentone, cross-hatching,
    // solid black); lines in ink at silhouettes (bold) and creases (fine), lighter with distance;
    // the sky is paper; lights stay paper white. Night is lifted so it stays readable.
    vec3 manga(vec3 base, float z, float sky, float dEdge, float nEdge, float nearK, vec2 f, vec3 nrmM) {
      float L = luma(base);
      L = mix(L, pow(L, 0.55), night);
      L = mix(L, 1.0, smoothstep(250.0, 1400.0, z) * 0.55); // aerial: distance goes pale
      float s = sin(0.785), co = cos(0.785);
      vec2 q = mat2(co, -s, s, co) * f / 3.0; // a 45-degree screen, 3 px pitch (finer: reads as grey, not dots)
      float dotR = length(fract(q) - 0.5);
      float tone = 1.0;
      float t1 = 1.0 - smoothstep(0.4, 0.46, L), t2 = 1.0 - smoothstep(0.24, 0.29, L), t3 = 1.0 - smoothstep(0.13, 0.17, L), t4 = 1.0 - smoothstep(0.08, 0.11, L); // mostly paper, solid blacks, tone only where it shapes
      tone -= t1 * (1.0 - smoothstep(0.17, 0.23, dotR)) * (1.0 - t2);         // fine dots
      tone -= t2 * (1.0 - smoothstep(0.3, 0.36, dotR)) * (1.0 - t3);          // dense dots
      float hk = inkHatch(f, nrmM, t3 * 0.8, 3.5);
      tone -= t3 * hk * (1.0 - t4) * 0.9;                                     // inked hatching along the form
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
      // the plates slip out of focus, and jump apart for a moment on the action (render/comicfx.js)
      float slipPx = slip * ${VERSE.maxSlip.toFixed(1)} + fxSplit * 3.5;
      vec2 dir = normalize(vec2(1.0, 0.35)) / res * slipPx;
      vec3 c = vec3(slipPx > 0.03 ? texture2D(tDiffuse, vUv + dir).r : base.r, base.g, slipPx > 0.03 ? texture2D(tDiffuse, vUv - dir).b : base.b);
      c = treat(c);
      c = mix(vec3(luma(c)), c, 1.0 - sky * 0.35); // a hazier, paler sky
      // a modelled look: fine lines where a shape passes in front of another (depth) and lighter
      // ones at creases (normals), drawn in a darker shade of the surface's own colour; a rim of
      // light on edges turning away from the eye. Fades with distance and out of focus.
      vec3 n0 = nrm(vUv);
      float zx = dist(vUv + vec2(px.x, 0.0)), zy = dist(vUv + vec2(0.0, px.y)), zx2 = dist(vUv - vec2(px.x, 0.0)), zy2 = dist(vUv - vec2(0.0, px.y));
      float dEdge = smoothstep(0.035, 0.08, (abs(zx - z) + abs(zy - z) + abs(zx2 - z) + abs(zy2 - z)) / max(z, 0.5));
      float nEdge = smoothstep(0.6, 1.1, (1.0 - dot(n0, nrm(vUv + vec2(px.x, 0.0)))) + (1.0 - dot(n0, nrm(vUv + vec2(0.0, px.y)))));
      float near = 1.0 - smoothstep(60.0, 260.0, z);
      // fine detail (crease lines, hatching, dots) needs pixels: on a small, low-resolution screen
      // (a phone on Low) it would read as a filter over everything, so it fades out; outlines stay
      float detail = phone > 0.5 ? smoothstep(360.0, 600.0, res.y * dpr) : 1.0; // phones only: laptops and desktops keep it all
      float line = max(dEdge, nEdge * 0.35 * detail) * near * (1.0 - coc * 0.7) * (1.0 - sky); // (the sky has no normals: no lines in the clouds)
      c = mix(c, c * 0.42, line * 0.85);
      float rim = smoothstep(0.55, 0.92, 1.0 - abs(n0.z)) * near * (1.0 - dEdge) * (1.0 - sky);
      c += rim * 0.07 * vec3(1.0, 0.95, 0.88);
      float L = luma(c);
      vec2 f = gl_FragCoord.xy;
      float shade = 1.0 - smoothstep(0.12, 0.55, L);
      float soft = smoothstep(0.55, 0.95, slip); // print texture only where it is clearly out of focus
      // the print texture sits in the shade only: lit walls and the street stay clean colour
      c *= 1.0 - 0.18 * detail * dots(f, 0.42, 5.0, soft * shade * 0.8);
      // inked hatching in the shadows (in focus too, as on the film's shaded sides), stronger out of
      // focus, fading with distance; drawn in a darker shade of the colour, not black
      float hpitch = max(3.0, res.y / 260.0);
      float hk = inkHatch(f, n0, shade, hpitch) * (1.0 - sky) * (0.45 + 0.55 * near) * detail;
      c = mix(c, c * 0.55, hk * (0.32 + 0.28 * soft));
      // the action (render/comicfx.js): lines bursting from the impact, a ring of dots running out,
      // a two-colour flash
      if (fxImpact > 0.001) {
        vec2 d = (vUv - fxAt) * vec2(res.x / res.y, 1.0);
        float r = length(d), a = atan(d.y, d.x);
        float ray = step(0.86, hHash(vec2(floor(a * 64.0), 7.0))) * smoothstep(0.16, 0.42, r) * (1.0 - smoothstep(0.55, 1.2, r)); // (the target itself stays clear)
        c = mix(c, vec3(0.04, 0.035, 0.05), ray * fxImpact * 0.6 * fxLines);
        float ring = (1.0 - fxImpact) * 0.32 + 0.04;
        float band = 1.0 - smoothstep(0.0, 0.045, abs(r - ring));
        c = mix(c, c * 0.35, band * fxImpact * dots(f, 0.785, 4.0, 0.75));
      }
      if (fxDuo > 0.001) c = mix(c, mix(fxDuoLo, fxDuoHi, smoothstep(0.04, 0.85, luma(c))), fxDuo);
      #ifdef MANGA
        gl_FragColor = vec4(manga(base, z, sky, dEdge, nEdge, near, f, n0), 1.0);
      #else
        gl_FragColor = vec4(c, 1.0);
      #endif
    }`,
};

/** A phone: a touch screen whose short side is phone-sized (laptops, tablets and desktops are not). */
export const isPhone = (coarse, shortSide) => !!coarse && shortSide <= 520;
const IS_PHONE = typeof matchMedia !== 'undefined' && typeof screen !== 'undefined'
  && isPhone(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height));

/** The pass (after the grade: it treats the displayed colours). */
export function makeVersePass(scenePass, look = 'verse') {
  const pass = new ShaderPass(look === 'manga' ? { ...shader, defines: { MANGA: 1 } } : shader);
  pass.uniforms.tDepth.value = scenePass.depthTexture; // render/depthpass.js (normals come from it too)
  return pass;
}

/** Per frame: the camera and the focus distance (m: to the player, or the orbit target). */
export function updateVerse(pass, camera, focus, width, height, night = 0, dpr = 1) {
  const u = pass.uniforms;
  u.dpr.value = dpr;
  u.phone.value = IS_PHONE ? 1 : 0;
  u.night.value = night;
  u.near.value = camera.near; u.far.value = camera.far; u.focus.value = focus;
  const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2);
  u.fovScale.value.set(ty * (camera.aspect || 1), ty);
  u.res.value.set(width, height);
}
