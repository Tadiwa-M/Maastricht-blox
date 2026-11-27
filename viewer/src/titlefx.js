// The title screen's moving print layer (owner, 2026-11-24: a shader background "from that shader site").
// Our own small WebGL take on shaders.com's FlowingGradient + Halftone + LightLeak + FilmGrain stack:
// that library is WebGPU-only (no iPhone or Firefox), 2.6 MB, and reports to its own server by default,
// so the idea is ported, not the package. A flowing colour field in the look's colours, printed as
// halftone dots, a light leak breathing in from one corner, and film grain; screen-blended over the
// key art and faded out when the live city takes over (index.html #loading .fx). Pure data + a thin
// WebGL layer: TITLE_FX holds every number, titlePalette() is tested.

/** Every number of the effect, per look: colours (sRGB 0..1), dot size, leak strength, motion speed. */
export const TITLE_FX = {
  classic: { colors: [[0.06, 0.02, 0.62], [0.94, 0.2, 0.25], [0.95, 0.66, 0]], leak: [1.0, 0.78, 0.45] }, // the logo's blue, red and yellow
  verse: { colors: [[0.95, 0.1, 0.55], [0.1, 0.85, 1.0], [1.0, 0.85, 0.1]], leak: [1.0, 0.35, 0.6] }, // magenta, cyan, yellow print inks
  manga: { colors: [[0.3, 0.16, 0.62], [0.74, 0.78, 0.92], [0.24, 0.66, 0.56]], leak: [0.85, 0.8, 1.0] }, // violet, lilac, teal (the cooled palette)
  dots: 9.0, // halftone cell, CSS px
  speed: 0.06,
  leakK: 0.55,
  grain: 0.06,
};

/** The palette for a look (unknown looks get the classic one). */
export function titlePalette(look) { return TITLE_FX[look] && TITLE_FX[look].colors ? TITLE_FX[look] : TITLE_FX.classic; }

const VS = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision mediump float;
uniform vec2 res; uniform float t, dpr, dots, leakK, grain; uniform vec3 c0, c1, c2, leak;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { return n(p) * 0.6 + n(p * 2.1 + 3.7) * 0.3 + n(p * 4.3 + 1.3) * 0.1; }
void main() {
  vec2 uv = gl_FragCoord.xy / res, q = uv * vec2(res.x / res.y, 1.0) * 1.6;
  // the flowing field: domain-warped noise picks between the three inks
  vec2 w = vec2(fbm(q + t), fbm(q - t * 0.7 + 5.2));
  float f = fbm(q + w * 1.8 + vec2(t * 0.5, -t * 0.3));
  vec3 col = mix(c0, c1, smoothstep(0.3, 0.6, f));
  col = mix(col, c2, smoothstep(0.55, 0.8, fbm(q * 0.7 + w - t * 0.4)));
  float lum = smoothstep(0.42, 0.8, f); // print only where the field is strong: patches of ink, clean image between
  // halftone: a 45-degree dot screen, dot size by the field's strength
  float cell = dots * dpr;
  vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
  float d = length(fract(g) - 0.5), r = 0.58 * sqrt(lum);
  float dotK = 1.0 - smoothstep(r - 0.06, r + 0.06, d);
  vec3 c = col * dotK;
  // a light leak breathing in from the top right, with soft streaks
  vec2 lp = uv - vec2(1.05, 0.95);
  float lk = exp(-dot(lp, lp) * 3.2) * (0.75 + 0.25 * sin(t * 9.0)) * (0.8 + 0.2 * sin(atan(lp.y, lp.x) * 14.0 + t * 3.0));
  c += leak * lk * leakK;
  c += (h(gl_FragCoord.xy + fract(t * 61.0) * 100.0) - 0.5) * grain; // film grain
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

/**
 * Start the layer on a canvas (the title screen's .fx). -> { stop() } (stop also frees the GL
 * context). No WebGL, or reduced motion asked for: a single still frame, or nothing. Never throws.
 */
export function startTitleFx(canvas, look = 'classic', win = typeof window !== 'undefined' ? window : null) {
  const none = { stop() {} };
  if (!canvas || !win) return none;
  let gl;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' }); } catch { return none; }
  if (!gl) return none;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return none;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (k) => gl.getUniformLocation(prog, k), pal = titlePalette(look);
  gl.uniform3fv(U('c0'), pal.colors[0]); gl.uniform3fv(U('c1'), pal.colors[1]); gl.uniform3fv(U('c2'), pal.colors[2]);
  gl.uniform3fv(U('leak'), pal.leak);
  gl.uniform1f(U('dots'), TITLE_FX.dots); gl.uniform1f(U('leakK'), TITLE_FX.leakK); gl.uniform1f(U('grain'), TITLE_FX.grain);
  const still = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, t0 = win.performance?.now?.() ?? 0;
  const draw = (now) => {
    const dpr = Math.min(win.devicePixelRatio || 1, 1.5); // a soft layer: no need for full phone resolution
    const w = Math.round(canvas.clientWidth * dpr), hgt = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== hgt) { canvas.width = w; canvas.height = hgt; gl.viewport(0, 0, w, hgt); }
    gl.uniform2f(U('res'), w, hgt); gl.uniform1f(U('dpr'), dpr);
    gl.uniform1f(U('t'), ((now - t0) / 1000) * TITLE_FX.speed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) raf = win.requestAnimationFrame(draw);
  };
  raf = win.requestAnimationFrame(draw);
  return { stop() { win.cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}
