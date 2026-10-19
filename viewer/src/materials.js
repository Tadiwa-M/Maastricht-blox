// Material classes keyed by the palette `material` field (CONTRACT section 3).
//
//   solid    ABS-like plastic (clearcoat)          trans  see-through plastic
//   glass    window glass: dark and reflective by day; at night each window glows with
//            its own colour/strength (per-instance attribute aGlow, see src/glow.js)
//   water    trans entries named water*: transparent, rippled normals (src/ripples.js)
//   metal    metallic plastic                      emissive  lamps (brighter at night)
import * as THREE from 'three';
import { rippleNormalTexture, addRipples } from './ripples.js';

function plastic(extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    specularIntensity: 0.6, ...extra,
  });
}

/** Glass whose emissive light is multiplied by a per-instance colour (aGlow). */
function windowGlass() {
  const m = plastic({ roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
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
      transparent: true, opacity: 0.88, envMapIntensity: 1.3 });
    this.waterUniforms = addRipples(this.water, rippleNormalTexture());
    this.metal = plastic({ metalness: 0.8, roughness: 0.28, clearcoat: 0.2, envMapIntensity: 1.4 });
    this.emissive = new Map();
    this.clippingPlanes = clippingPlanes;
    if (clippingPlanes) for (const m of this.all()) m.clippingPlanes = clippingPlanes;
    this.night = 0;
  }

  all() { return [this.solid, this.glass, this.trans, this.water, this.metal, ...this.emissive.values()]; }

  /** Class name for a palette entry ('solid', 'glass', 'water', ...). */
  classOf(entry) {
    const cls = entry?.material || 'solid';
    if (cls === 'trans' && /^water/.test(entry.name || '')) return 'water';
    return ['glass', 'trans', 'metal', 'emissive'].includes(cls) ? cls : 'solid';
  }

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

  /** night in [0, 1]: lamps and windows glow. */
  setNight(night) {
    this.night = night;
    for (const m of this.emissive.values()) m.emissiveIntensity = 0.8 + night * 5;
    this.glass.emissiveIntensity = night * 1.6;
    this.glass.envMapIntensity = 1.6 * (1 - 0.6 * night);
  }

  /** Animate time-dependent materials (water ripples). seconds since start. */
  update(seconds) { this.waterUniforms.uTime.value = seconds; }
}
