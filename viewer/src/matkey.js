// Material classes and keys from palette entries (CONTRACT section 3), without three.js, so a
// Web Worker and the far bake can sort faces by material exactly as MaterialSet does.
//
//   class  solid | glass | trans | water (trans entries named water*) | metal | emissive
//   key    the class, or `emissive:<idx>` (each lamp colour is its own material)
export function classOf(entry) {
  const cls = entry?.material || 'solid';
  if (cls === 'trans' && /^water/.test(entry.name || '')) return 'water';
  return ['glass', 'trans', 'metal', 'emissive'].includes(cls) ? cls : 'solid';
}

export function keyOf(entry) {
  const cls = classOf(entry);
  return cls === 'emissive' ? `emissive:${entry.idx}` : cls;
}

/**
 * City far look (src/cityfar.js) folds every opaque class into one material: the class rides
 * along per vertex as a "shine" byte (0 plastic, 128 metal, 255 glass). See-through classes keep
 * their own material. Returns 'opaque' | 'water' | 'trans'.
 */
export function farFamily(key) {
  return key === 'water' || key === 'trans' ? key : 'opaque';
}

export const SHINE = Object.freeze({ plastic: 0, metal: 128, glass: 255 });

/** Shine byte of a material key (see farFamily). */
export function shineOf(key) {
  return key === 'glass' ? SHINE.glass : key === 'metal' ? SHINE.metal : SHINE.plastic;
}
