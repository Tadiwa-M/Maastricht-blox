// The weather you can see (life/weather.js decides it from the real Maastricht weather, or #rain=,
// #snow=, #storm= in the address):
//   rain    streaks falling round the camera, slanted by the wind, as many as the rain is heavy;
//           streets wet: darker paving with a sheen and puddles that mirror the sky and the lamps
//           (render/surface.js uWet)
//   snow    flakes drifting down; roofs and streets slowly turn white while it snows and thaw after
//   cloud   an overcast sky dims the sun and lifts the shade a little (scene.js weatherSun)
//   storm   lightning: the whole city flashes, thunder follows a moment later (audio listens for
//           'blox:lightning'); in the comic look a white flash
// The falling stuff is one draw call each and moves on the GPU (positions wrap round the camera
// in the vertex shader), so it costs almost nothing on the CPU.
import * as THREE from 'three';
import { weatherUniforms } from './surface.js';
import { comicFx } from './comicfx.js';

// drops are short (a raindrop seen in a frame is a short dash, not a long line) and fine; flakes are
// small specks of different sizes, the near ones larger and softer (out of focus, as in the film's snow)
export const PRECIP = { box: [40, 24, 40], counts: { high: 12000, medium: 7000, low: 3500, lite: 2000 }, rainSpeed: 8.5, snowSpeed: 0.9, streak: [0.07, 0.2] };

const VERT = `
  attribute float aEnd; attribute float aId;
  uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uAmount; uniform float uSpeed; uniform float uStreak; uniform float uSnow; uniform float uPx;
  varying float vA; varying float vSoft; varying float vFade;
  void main() {
    vec3 p = position;
    float fall = uTime * uSpeed * (0.85 + 0.3 * fract(aId * 7.31));
    p.y = mod(p.y - fall - uCam.y, uBox.y) + uCam.y - uBox.y * 0.45;
    vec2 drift = uWind * (uTime + p.y * 0.0) + (uSnow > 0.5 ? vec2(sin(uTime * 0.7 + aId * 13.0), cos(uTime * 0.6 + aId * 9.0)) * 0.6 : vec2(0.0));
    p.xz = mod(p.xz + drift - uCam.xz + uBox.xz * 0.5, uBox.xz) + uCam.xz - uBox.xz * 0.5;
    // the streak's other end trails up and back along the fall (wind slant)
    vec3 v = normalize(vec3(uWind.x, -uSpeed, uWind.y));
    p -= v * aEnd * mix(${PRECIP.streak[0].toFixed(2)}, ${PRECIP.streak[1].toFixed(2)}, fract(aId * 3.77)) * uStreak;
    vA = step(fract(aId * 0.6180339) , uAmount); // as many drops as the rain is heavy
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    // flakes: 1 to 3 px far away, bigger and softer close to the camera; drops fade with distance
    float size = mix(0.7, 1.6, fract(aId * 5.13));
    gl_PointSize = uPx * size * clamp(9.0 / d, 0.9, 6.0);
    vSoft = smoothstep(2.5, 0.6, d);
    vFade = mix(0.55, 1.0, fract(aId * 2.31)) * (1.0 - smoothstep(14.0, 22.0, d));
  }`;
const FRAG = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uSnow;
  varying float vA; varying float vSoft; varying float vFade;
  void main() {
    if (vA < 0.5) discard;
    float a = uOpacity * vFade;
    if (uSnow > 0.5) { float r = length(gl_PointCoord - 0.5); a *= (1.0 - smoothstep(mix(0.3, 0.05, vSoft), 0.5, r)) * mix(1.0, 0.45, vSoft); }
    gl_FragColor = vec4(uColor, a);
  }`;

function precipGeometry(n, snow) {
  const g = new THREE.BufferGeometry(), per = snow ? 1 : 2;
  const pos = new Float32Array(n * per * 3), end = new Float32Array(n * per), id = new Float32Array(n * per);
  const [bx, by, bz] = PRECIP.box;
  for (let q = 0; q < n; q++) {
    const x = (Math.random() - 0.5) * bx, y = Math.random() * by, z = (Math.random() - 0.5) * bz, r = Math.random();
    for (let k = 0; k < per; k++) { const i = q * per + k; pos.set([x, y, z], i * 3); end[i] = k; id[i] = r; }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aId', new THREE.BufferAttribute(id, 1));
  return g;
}

function precipMaterial(snow) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...PRECIP.box) }, uWind: { value: new THREE.Vector2() },
      uAmount: { value: 0 }, uSpeed: { value: snow ? PRECIP.snowSpeed : PRECIP.rainSpeed }, uStreak: { value: snow ? 0 : 1 }, uSnow: { value: snow ? 1 : 0 },
      uPx: { value: 2.0 }, uColor: { value: new THREE.Color(snow ? '#f4f6ff' : '#b9c6da') }, uOpacity: { value: snow ? 0.95 : 0.32 } },
  });
}

/** Wind (km/h) to a horizontal drift (m/s), blowing toward the north-east by default. */
export const windDrift = (kmh, dir = [0.6, -0.8]) => { const s = Math.min(14, (kmh || 0) / 3.6) * 0.55; return [dir[0] * s, dir[1] * s]; };

/** How much the sun dims (factor) for a weather state: an overcast or wet sky. */
export const sunFactor = (w) => 1 - 0.55 * Math.max((w?.cloud ?? 0.4) - 0.4, 0) / 0.6 * 0.6 - 0.45 * Math.min(1, w?.rain || 0) - 0.3 * (w?.snow ? 1 : 0);

/** The settings checkbox "Real cloud cover" (off by default: Maastricht is often grey, the game need not be). */
export function realSky() { try { return localStorage.getItem('blox.realsky') === 'on'; } catch { return false; } }
if (typeof document !== 'undefined') queueMicrotask(() => {
  const box = document.getElementById('realsky');
  if (!box) return;
  box.checked = realSky();
  box.addEventListener('change', () => { try { localStorage.setItem('blox.realsky', box.checked ? 'on' : 'off'); } catch { /* blocked */ } });
});

/** The sky this weather shows: the real cover with the setting on, or when it rains or snows; else a fair sky. */
export const skyCloud = (w, real) => ((real || (w?.rain || 0) > 0 || w?.snow) ? Math.max(0, Math.min(1, w?.cloud ?? 0.4)) : 0.4);

export class WeatherFx {
  constructor(stage, { tier = 'medium' } = {}) {
    this.stage = stage;
    const n = PRECIP.counts[tier] ?? PRECIP.counts.medium;
    this.rain = new THREE.LineSegments(precipGeometry(n, false), precipMaterial(false));
    this.snow = new THREE.Points(precipGeometry(Math.round(n * 1.3), true), precipMaterial(true)); // (a snowfall is dense)
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.renderOrder = 3; o.visible = false; stage.scene.add(o); }
    this.t = 0; this.wet = 0; this.cover = 0; this.flash = 0; this.nextBolt = 0; this.sun = 1;
  }

  /** Per frame. w: the weather (life/weather.js weatherState): { rain, snow, storm, wind, cloud }. */
  update(dt, w, camera) {
    this.t += dt;
    const rain = w?.snow ? 0 : Math.max(0, Math.min(1, w?.rain || 0)), snow = w?.snow ? Math.max(0.4, Math.min(1, w.rain || 0.6)) : 0;
    const drift = windDrift(w?.wind);
    for (const [o, amount] of [[this.rain, rain], [this.snow, snow]]) {
      o.visible = amount > 0.01;
      if (!o.visible) continue;
      const u = o.material.uniforms;
      u.uTime.value = this.t; u.uCam.value.copy(camera.position); u.uAmount.value = amount; u.uWind.value.set(drift[0], drift[1]);
    }
    // the streets get wet quickly in the rain and dry slowly; snow settles over minutes and thaws
    this.wet += ((rain > 0 ? Math.min(1, 0.35 + rain) : 0) - this.wet) * Math.min(1, dt * (rain > 0 ? 0.25 : 0.02));
    this.cover += ((snow > 0 ? 1 : 0) - this.cover) * Math.min(1, dt * (snow > 0 ? 0.006 : 0.01));
    weatherUniforms.uWet.value = this.wet; weatherUniforms.uSnowCover.value = this.cover;
    // an overcast sky dims the sun (scene.js reads it on the next time update)
    // and the sky shows the real cloud cover, greyer in rain or snow
    const cl = skyCloud(w, realSky()), s = Math.max(0.3, sunFactor({ ...w, cloud: cl })), gr = Math.min(1, (w?.rain || 0) + (w?.snow ? 0.4 : 0));
    if (Math.abs(s - this.sun) > 0.02 || Math.abs(cl - (this.stage.weatherCloud ?? -1)) > 0.03 || Math.abs(gr - (this.stage.weatherGrey ?? -1)) > 0.03) {
      this.sun = s; this.stage.weatherSun = s; this.stage.weatherCloud = cl; this.stage.weatherGrey = gr;
      this.stage.setTime?.(this.stage.hours ?? 12);
    }
    // lightning in a storm, every 8 to 30 s
    if (w?.storm) {
      if (this.t >= this.nextBolt) {
        this.nextBolt = this.t + 8 + Math.random() * 22;
        this.flash = 1;
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('blox:lightning', { detail: { delay: 0.5 + Math.random() * 2.5 } }));
        comicFx('lightning');
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      const f = this.flash * (0.6 + 0.4 * Math.sin(this.t * 90)); // a flicker
      this.stage.hemi.intensity = (this.baseHemi ??= this.stage.hemi.intensity) * (1 + 2.5 * f);
      if (this.flash === 0) { this.stage.hemi.intensity = this.baseHemi; this.baseHemi = null; }
    }
  }

  dispose() { for (const o of [this.rain, this.snow]) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } }
}
