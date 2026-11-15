// Material classes keyed by the palette `material` field (CONTRACT section 3).
//
//   solid    ABS-like plastic (clearcoat)          trans  see-through plastic
//   glass    window glass: dark and reflective by day; at night each window glows with
//            its own colour/strength (per-instance attribute aGlow, see src/glow.js)
//   water    trans entries named water*: transparent, rippled normals (src/ripples.js)
//   metal    metallic plastic                      emissive  lamps (brighter at night)
import * as THREE from 'three';
import { rippleNormalTexture, addRipples } from './ripples.js';
import { classOf } from './matkey.js';
import { lookFromHash } from './render/verse.js';
import { installSurface } from './render/surface.js';

// the comic test look paints opaque surfaces (render/surface.js)
const PAINTED = typeof location !== 'undefined' && lookFromHash(location.hash) === 'verse';

// Leaves in the wind: bricks flagged per instance (aSway, set by bricks.js for the leaf colours)
// drift a few centimetres, in a slow wave that runs through a canopy (phase from where the brick
// stands). One shared time and strength for every material (life/index.js sets them from the
// clock and the real wind). Bricks without the attribute read 0 and stand still.
export const swayUniforms = { uSwayT: { value: 0 }, uSwayAmp: { value: 0.03 } };
export const SWAY = { calm: 0.012, perKmh: 0.0016, max: 0.09 }; // metres of drift: still air, per km/h of wind, storm cap
/** Drift (m) for a wind speed (km/h). */
export const swayAmp = (windKmh) => Math.min(SWAY.max, SWAY.calm + SWAY.perKmh * Math.max(0, windKmh || 0));

function addSway(m, key) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, swayUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uSwayT;\nuniform float uSwayAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          if (aSway > 0.0) {
            float swayPh = dot(instanceMatrix[3].xz, vec2(0.33, 0.27)) + instanceMatrix[3].y * 0.4;
            transformed.x += sin(uSwayT * 1.25 + swayPh) * uSwayAmp * aSway;
            transformed.z += cos(uSwayT * 0.95 + swayPh * 1.3) * uSwayAmp * aSway * 0.7;
            transformed.y += sin(uSwayT * 1.7 + swayPh * 2.1) * uSwayAmp * aSway * 0.25;
          }
        #endif`);
  };
  m.customProgramCacheKey = () => key;
  return m;
}

function plastic(extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    specularIntensity: 0.6, ...extra,
  });
}

/** Glass whose emissive light is multiplied by a per-instance colour (aGlow). */
// Shared by every window material: the share of rooms lit now (glow.js litShare) and the game
// clock in seconds; life/index.js sets both each frame.
export const windowUniforms = { uLitShare: { value: 0.55 }, uWinT: { value: 0 } };

function windowGlass(extra = {}) {
  const m = plastic({ ...extra, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
    specularIntensity: 1, emissive: 0xffffff, emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, windowUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aGlow; varying vec3 vGlow; varying float vRoomY;
        uniform float uLitShare; uniform float uWinT;
        float winHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;
        vRoomY = 0.5;
        #ifdef USE_INSTANCING
          // which rooms have the light on: a share by the hour, each window on its own slow
          // schedule (switches about every 6 to 18 game minutes), so the city changes as you watch
          vec3 cell = floor(instanceMatrix[3].xyz * vec3(0.5, 0.35, 0.5));
          float own = winHash(cell);
          float slot = floor(uWinT / (360.0 + own * 720.0) + own * 17.0);
          float lit = step(winHash(cell + slot * 0.731), uLitShare);
          // a TV room (blue) flickers
          float tv = step(vGlow.r * 1.5, vGlow.b);
          float flick = 0.75 + 0.25 * sin(uWinT * 0.9 + own * 40.0) * sin(uWinT * 2.3 + own * 11.0);
          vGlow *= lit * mix(1.0, flick, tv) * (0.7 + 0.5 * winHash(cell + 3.1));
          vRoomY = fract(position.y + 0.5); // within the pane: 0 at the sill, 1 at the top
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow; varying float vRoomY;')
      // a room lit from the ceiling: the light falls off toward the sill
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow * (0.55 + 0.6 * smoothstep(0.0, 1.0, vRoomY));');
  };
  m.customProgramCacheKey = () => 'window-glass';
  return m;
}

export class MaterialSet {
  /** clippingPlanes: optional, e.g. to cut moving models at the diorama edge. */
  constructor({ clippingPlanes = null } = {}) {
    this.solid = addSway(plastic(), 'solid-sway');
    if (PAINTED) installSurface(this.solid, 'solid');
    this.glass = windowGlass();
    this.trans = plastic({ roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true,
      opacity: 0.75, envMapIntensity: 1.6, depthWrite: false });
    this.water = plastic({ roughness: 0.06, clearcoat: 0, specularIntensity: 1, ior: 1.33,
      transparent: true, opacity: 0.9, envMapIntensity: 2.0 });
    this.waterUniforms = addRipples(this.water, rippleNormalTexture(), 0.6);
    this.metal = plastic({ metalness: 0.8, roughness: 0.28, clearcoat: 0.2, envMapIntensity: 1.4 });
    this.emissive = new Map();
    this.far = new Map(); // far-LOD variants (vertex colours), see farFor()
    this.clippingPlanes = clippingPlanes;
    if (clippingPlanes) for (const m of this.all()) m.clippingPlanes = clippingPlanes;
    this.night = 0;
  }

  all() { return [this.solid, this.glass, this.trans, this.water, this.metal, ...this.emissive.values()]; }

  /** Class name for a palette entry ('solid', 'glass', 'water', ...). */
  classOf(entry) { return classOf(entry); }

  /** { key, material, cls } for a palette entry. */
  forEntry(entry) {
    const cls = this.classOf(entry);
    if (cls === 'emissive') {
      const key = `emissive:${entry.idx}`;
      if (!this.emissive.has(key)) {
        const m = plastic({ emissive: new THREE.Color(entry.srgb), emissiveIntensity: 0.8, roughness: 0.2 });
        if (this.clippingPlanes) m.clippingPlanes = this.clippingPlanes;
        this.emissive.set(key, m);
      }
      return { key, material: this.emissive.get(key), cls };
    }
    return { key: cls, material: this[cls], cls };
  }

  /**
   * Far-LOD material for a near-material key (from forEntry): colour comes from vertex
   * colours (merged meshes have no instances), and opaque plastic drops the clearcoat
   * (MeshStandardMaterial: cheaper per pixel, no visible difference at that distance).
   */
  farFor(key) {
    if (this.far.has(key)) return this.far.get(key);
    let m;
    const std = (extra) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0, ...extra });
    if (key === 'solid') { m = std({}); if (PAINTED) installSurface(m, 'far-solid'); }
    else if (key === 'metal') m = std({ metalness: 0.8, roughness: 0.28, envMapIntensity: 1.4 });
    else if (key === 'glass') m = windowGlass({ vertexColors: true });
    else if (key === 'trans') m = this.trans.clone();
    else if (key === 'water') {
      m = this.water.clone();
      const u = addRipples(m, this.waterUniforms.uRipple.value, 0.6);
      u.uTime = this.waterUniforms.uTime; // one clock for near and far water
    } else if (key.startsWith('emissive:')) {
      m = std({ emissive: this.emissive.get(key).emissive.clone(), roughness: 0.2 });
    } else m = std({});
    m.vertexColors = true;
    if (this.clippingPlanes) m.clippingPlanes = this.clippingPlanes;
    this.far.set(key, m);
    this.setNight(this.night);
    return m;
  }

  /**
   * City far look (streamed chunks/islands and baked regions, src/cityview.js): 'opaque' folds
   * solid, glass, metal and lamps into ONE material; per vertex aExtra = (glow rgb at half
   * scale, shine: 0 plastic, 128 metal, 255 glass), so a chunk is one draw call. 'water' and
   * 'trans' reuse the far see-through materials.
   */
  cityFar(family) {
    if (family !== 'opaque') return this.farFor(family);
    if (this.cityOpaque) return this.cityOpaque;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 });
    const uGlow = { value: 0 };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = uGlow;
      Object.assign(sh.uniforms, windowUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aExtra;\nvarying vec4 vExtra;\nvarying vec3 vWinP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvExtra = aExtra;\nvWinP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vExtra; varying vec3 vWinP; uniform float uGlow; uniform float uLitShare; uniform float uWinT;
          float winHashF(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vExtra.a > 0.75 ? 0.06 : (vExtra.a > 0.25 ? 0.28 : roughnessFactor);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = (vExtra.a > 0.25 && vExtra.a < 0.75) ? 0.8 : metalnessFactor;')
        // the bake lit 60 % of windows; keep the share the hour wants (glow.js litShare), each window
        // (its metre cell) on its own slow schedule, as the near glass does
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 wc = floor(vWinP * vec3(0.9, 0.6, 0.9) + 0.01);
          float own = winHashF(wc);
          float slot = floor(uWinT / (360.0 + own * 720.0) + own * 17.0);
          float keep = step(winHashF(wc + slot * 0.731), min(1.0, uLitShare / 0.6));
          totalEmissiveRadiance += vExtra.rgb * 2.0 * uGlow * keep;`);
    };
    m.customProgramCacheKey = () => 'city-far-opaque';
    if (PAINTED) installSurface(m, 'city-far');
    m.userData.uGlow = uGlow;
    this.cityOpaque = m;
    this.setNight(this.night);
    return m;
  }

  /** night in [0, 1]: lamps and windows glow. */
  setNight(night) {
    this.night = night;
    if (this.cityOpaque) this.cityOpaque.userData.uGlow.value = night * 1.2;
    for (const m of this.emissive.values()) m.emissiveIntensity = 0.8 + night * 3;
    for (const [key, m] of this.far) if (key.startsWith('emissive:')) m.emissiveIntensity = 0.8 + night * 3;
    for (const g of [this.glass, this.far.get('glass')]) {
      if (!g) continue;
      g.emissiveIntensity = night * 1.15; // a room's light, not a lamp: it should not light the street
      g.envMapIntensity = 1.6 * (1 - 0.6 * night);
    }
  }

  /** Animate time-dependent materials (water ripples). seconds since start. */
  update(seconds) { this.waterUniforms.uTime.value = seconds; }
}
