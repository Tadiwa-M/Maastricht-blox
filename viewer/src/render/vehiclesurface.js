// Vehicles in the comic look (test flag #look=verse): each part its own stuff. Which bit of a
// part is which comes from its vertex colours (geometry tints in figure/vehicles.js: paint = 1,
// trims dark, rims light grey):
//   body    deep glossy paint with a clear coat (sharp reflections), matte black trims, road dirt
//           creeping up from the sills and wheel arches
//   glass   dark and mirror-like
//   wheel   rubber tyres with tread across the face and a sidewall ring; metal rims with spokes
//   frame   (bike) enamelled steel; grips and saddle matte
// Pools of light at night (render/pools.js) light them like everything else.
import { lookFromHash } from './verse.js';
import { addPartVaryings } from './pools.js';

export const VEHICLE_LOOK = typeof location !== 'undefined' && lookFromHash(location.hash) === 'verse';

/** Material kind of a vehicle mesh key ('body:saloon', 'glass:van', 'carWheel', 'bikeFrame', ...). */
export function vehicleKindOf(key) {
  if (key.startsWith('body:')) return 'body';
  if (key.startsWith('glass:')) return 'glass';
  if (key === 'carWheel' || key === 'bikeWheel') return 'wheel';
  if (key === 'bikeFrame') return 'frame';
  return null;
}

const paintMask = 'float paint = step(0.97, min(vLocC.r, min(vLocC.g, vLocC.b)));';

const KIND = {
  body: { params: { clearcoat: 1, clearcoatRoughness: 0.05, roughness: 0.34, metalness: 0.12, envMapIntensity: 1.3 },
    color: `${paintMask}
      float low = 1.0 - smoothstep(0.18, 0.55, p.y);
      float dirt = low * (0.55 + 0.45 * fNoise(p * vec3(6.0, 14.0, 6.0))) * paint;
      c = mix(c, c * vec3(0.55, 0.5, 0.45), dirt * 0.45);
      c *= 1.0 + (fNoise(p * 90.0) - 0.5) * 0.02 * paint;`,
    rough: `${paintMask} roughnessFactor = mix(0.78, roughnessFactor + (1.0 - smoothstep(0.18, 0.55, vLocP.y)) * 0.25, paint);`,
    coat: `${paintMask} material.clearcoat *= paint * (1.0 - (1.0 - smoothstep(0.18, 0.55, vLocP.y)) * 0.6);` },
  glass: { params: { clearcoat: 1, clearcoatRoughness: 0.02, roughness: 0.05, metalness: 0.0, envMapIntensity: 2.2 },
    color: '', rough: '', coat: '' },
  wheel: { params: { clearcoat: 0, roughness: 0.85, metalness: 0 },
    color: `float rim = step(0.5, vLocC.r);
      float r = length(p.yz), a = atan(p.y, p.z);
      float face = step(0.8, abs(normalize(vLocN).x)); // the flat side vs the tread
      float tread = (1.0 - face) * (1.0 - rim) * step(0.5, fract(a * 4.456));
      float wall = face * (1.0 - rim) * fLine(r - 0.27, 0.004);
      float spokes = rim * face * smoothstep(0.35, 0.65, abs(fract(a * 0.7958) - 0.5) * 2.0) * step(0.035, r);
      c *= 1.0 - tread * 0.35 + wall * 0.6;
      c = mix(c, c * 0.25, spokes * 0.85);`,
    rough: 'roughnessFactor = mix(roughnessFactor, 0.22, step(0.5, vLocC.r));',
    metal: 'metalnessFactor = mix(metalnessFactor, 0.9, step(0.5, vLocC.r));', coat: '' },
  frame: { params: { clearcoat: 0.8, clearcoatRoughness: 0.12, roughness: 0.4, metalness: 0.2 },
    color: '', rough: `${paintMask} roughnessFactor = mix(0.8, roughnessFactor, paint);`, coat: `${paintMask} material.clearcoat *= paint;` },
};

/** A clone of the vehicle material for a mesh kind (see KIND), or the material itself. */
export function vehicleMaterialFor(base, kind) {
  const spec = KIND[kind];
  if (!spec) return base;
  const m = base.clone();
  Object.assign(m, spec.params);
  m.onBeforeCompile = (sh) => {
    addPartVaryings(sh);
    let f = sh.fragmentShader;
    if (spec.color) f = f.replace('#include <color_fragment>', `#include <color_fragment>\n{ vec3 c = diffuseColor.rgb; vec3 p = vLocP; ${spec.color} diffuseColor.rgb = max(c, 0.0); }`);
    if (spec.rough) f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n{ ${spec.rough} }`);
    if (spec.metal) f = f.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n{ ${spec.metal} }`);
    if (spec.coat) f = f.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n{ ${spec.coat} }`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => `vehicle:${kind}`;
  return m;
}
