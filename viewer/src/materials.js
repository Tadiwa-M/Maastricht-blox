// Plastic material classes keyed by palette `material` (CONTRACT section 3).
import * as THREE from 'three';

const WARM_WINDOW = new THREE.Color('#ffb661');

function plastic(extra = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.35, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    specularIntensity: 0.6, ...extra,
  });
}

export class MaterialSet {
  constructor() {
    this.solid = plastic();
    this.glass = plastic({ roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2,
      specularIntensity: 1, emissive: WARM_WINDOW.clone(), emissiveIntensity: 0 });
    this.trans = plastic({ roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true,
      opacity: 0.75, envMapIntensity: 1.6, depthWrite: false });
    this.metal = plastic({ metalness: 0.8, roughness: 0.28, clearcoat: 0.2, envMapIntensity: 1.4 });
    this.emissive = new Map();
    this.night = 0;
  }

  /** Material key + material for a palette entry. */
  forEntry(entry) {
    const cls = entry?.material || 'solid';
    if (cls === 'emissive') {
      const key = `emissive:${entry.idx}`;
      if (!this.emissive.has(key)) {
        const c = new THREE.Color(entry.srgb);
        this.emissive.set(key, plastic({ emissive: c, emissiveIntensity: 0.8, roughness: 0.2 }));
      }
      return { key, material: this.emissive.get(key) };
    }
    const m = this[cls] instanceof THREE.Material ? this[cls] : this.solid;
    return { key: this[cls] instanceof THREE.Material ? cls : 'solid', material: m };
  }

  /** night in [0, 1]: lamps and windows glow. */
  setNight(night) {
    this.night = night;
    for (const m of this.emissive.values()) m.emissiveIntensity = 0.8 + night * 5;
    this.glass.emissiveIntensity = night * 0.9;
    this.glass.envMapIntensity = 2.2 * (1 - 0.6 * night);
  }
}
