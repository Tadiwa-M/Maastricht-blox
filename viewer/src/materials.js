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

function plastic(extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    specularIntensity: 0.6, ...extra,
  });
}

/** Glass whose emissive light is multiplied by a per-instance colour (aGlow). */
function windowGlass(extra = {}) {
  const m = plastic({ ...extra, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
    specularIntensity: 1, emissive: 0xffffff, emissiveIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aGlow;\nvarying vec3 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow;');
  };
  m.customProgramCacheKey = () => 'window-glass';
  return m;
}

export class MaterialSet {
  /** clippingPlanes: optional, e.g. to cut moving models at the diorama edge. */
  constructor({ clippingPlanes = null } = {}) {
    this.solid = plastic();
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
    if (key === 'solid') m = std({});
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

  /** night in [0, 1]: lamps and windows glow. */
  setNight(night) {
    this.night = night;
    for (const m of this.emissive.values()) m.emissiveIntensity = 0.8 + night * 3;
    for (const [key, m] of this.far) if (key.startsWith('emissive:')) m.emissiveIntensity = 0.8 + night * 3;
    for (const g of [this.glass, this.far.get('glass')]) {
      if (!g) continue;
      g.emissiveIntensity = night * 1.6;
      g.envMapIntensity = 1.6 * (1 - 0.6 * night);
    }
  }

  /** Animate time-dependent materials (water ripples). seconds since start. */
  update(seconds) { this.waterUniforms.uTime.value = seconds; }
}
