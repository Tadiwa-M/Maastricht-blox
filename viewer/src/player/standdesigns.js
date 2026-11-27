// The Stands (the manga look). A Stand is a combination of parts (owner: a Stand designer; the
// three original concept designs are presets of it): the anime figure's body in a painted skin,
// a head, a crown, shoulders, arms, legs, a chest piece, colours, an aura, a name (song-style, as
// that world names them) and an ability. Pure data and geometry; player/stand.js poses and shows one.
//   presets: IRON HYMN (ivory circuits, faceless helm, blades, gears; Guard), VELVET ENCORE
//   (harlequin, white mask, jester crown, ruff, claws, ribbons; Encore), LIVE WIRE (yellow zigzags,
//   speed helmet, lightning crest, bolts, fins, knee spikes; Short Circuit)
// attach(key, n, object): fixes an object to the figure part `key` (n: 0 left, 1 right), in that
// part's own frame (parts.js: head origin at the neck base, front -z; limbs hang down -y).
// The part names are listed in figure/custom.js STAND_PARTS too (the creator's choices; a test
// keeps the two in step).
import * as THREE from 'three';

/** A material whose colour (and glow) GLSL paints from the part's own coordinates p. */
export function paintedMaterial(glsl, { rough = 0.32, metal = 0.35 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: rough, metalness: metal, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;');
    sh.fragmentShader = 'varying vec3 vObj;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n  vec3 gGlow = vec3(0.0);\n  { vec3 p = vObj; vec3 c = vec3(1.0);\n${glsl}\n  diffuseColor.rgb = c; }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gGlow;');
  };
  m.customProgramCacheKey = () => `stand:${glsl}`;
  return m;
}

// ---- skins: GLSL painting colour c (and glow gGlow) from p, in the Stand's colours -----------
const v3 = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };
const SKINS = {
  circuit: ({ a, b, glow }) => `
      c = ${v3(a)};
      float seam = smoothstep(0.86, 0.9, fract(p.y * 8.0 + 0.3)) * (1.0 - smoothstep(0.9, 0.94, fract(p.y * 8.0 + 0.3)));
      c = mix(c, ${v3(b)}, seam * 0.85);
      float centre = 1.0 - smoothstep(0.004, 0.009, abs(p.x));
      float trace = (1.0 - smoothstep(0.003, 0.006, abs(fract(p.x * 9.0 + floor(p.y * 6.0) * 0.37) - 0.5) - 0.42)) * step(0.5, fract(p.y * 6.0));
      c = mix(c, ${v3(glow)}, max(centre, trace * 0.8)); gGlow = ${v3(glow)} * max(centre, trace * 0.7) * 1.6;`,
  harlequin: ({ a, b, trim }) => `
      vec2 q = vec2(p.x + p.y, p.x - p.y) * 9.0;
      float chk = mod(floor(q.x) + floor(q.y), 2.0);
      vec2 f = abs(fract(q) - 0.5);
      c = mix(${v3(b)}, ${v3(a)}, chk);
      c = mix(${v3(trim)}, c, 1.0 - smoothstep(0.44, 0.48, max(f.x, f.y)));`,
  zigzag: ({ a, b, glow }) => `
      float z = p.y * 11.0 + abs(fract((p.x + p.z) * 5.0) - 0.5) * 2.2;
      float sparkLine = 1.0 - smoothstep(0.0, 0.03, abs(fract(z) - 0.62));
      c = mix(${v3(a)}, ${v3(b)}, step(0.62, fract(z)));
      c = mix(c, ${v3(glow)}, sparkLine * 0.8); gGlow = ${v3(glow)} * sparkLine * 1.4;`,
  scales: ({ a, b, glow }) => `
      vec2 q = vec2(p.x * 16.0 + floor(p.y * 14.0) * 0.5, p.y * 14.0);
      vec2 f = vec2(fract(q.x) - 0.5, fract(q.y));
      float d = length(vec2(f.x, f.y * 1.3));
      c = mix(${v3(a)}, ${v3(b)}, smoothstep(0.4, 0.55, d));
      float rimS = 1.0 - smoothstep(0.0, 0.05, abs(d - 0.48)); c = mix(c, ${v3(glow)}, rimS * 0.5); gGlow = ${v3(glow)} * rimS * 0.5;`,
  stripes: ({ a, b, trim }) => `
      float s = fract(p.x * 12.0 + p.z * 12.0);
      c = mix(${v3(a)}, ${v3(b)}, step(0.5, s));
      c = mix(c, ${v3(trim)}, 1.0 - smoothstep(0.0, 0.05, abs(s - 0.5)));`,
};

// ---- parts: each adds meshes in the Stand's colours ------------------------------------------
const glowMat = (c, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false, transparent: true });
const std = (c, rough = 0.3, metal = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, transparent: true });
const tube = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 20, r, 8);
const mesh = (geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.rotation.set(...rot);
  if (Array.isArray(scale)) m.scale.set(...scale); else m.scale.setScalar(scale); return m;
};
/** A lightning-bolt shape, extruded (w wide, h tall, d deep). */
function bolt(w = 0.06, h = 0.22, d = 0.03) {
  const s = new THREE.Shape(), P = [[0, 0], [w * 0.55, h * 0.45], [w * 0.15, h * 0.45], [w * 0.6, h], [-w * 0.1, h * 0.4], [w * 0.3, h * 0.4], [-w * 0.2, 0]];
  s.moveTo(...P[0]); for (const p of P.slice(1)) s.lineTo(...p); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(-w * 0.2, 0, -d / 2); return g;
}

const HEADS = {
  helm(at, c) { // a smooth faceless helm with one vertical eye slit
    at('head', 0, mesh(new THREE.SphereGeometry(0.125, 24, 16), std(c.a, 0.25, 0.3), [0, 0.2, 0.01], [0, 0, 0], [1, 1.16, 1.12]));
    at('head', 0, mesh(new THREE.BoxGeometry(0.014, 0.12, 0.02), glowMat(c.glow), [0, 0.2, -0.138]));
  },
  mask(at, c) { // a white mask with diamond eyes, a painted tear
    at('head', 0, mesh(new THREE.SphereGeometry(0.12, 24, 16), std('#f6f0ea', 0.3, 0.1), [0, 0.19, -0.02], [0, 0, 0], [0.92, 1.22, 0.95]));
    for (const s of [-1, 1]) at('head', 0, mesh(new THREE.OctahedronGeometry(0.03), glowMat(c.glow), [s * 0.042, 0.2, -0.124], [0, 0, 0], [0.7, 1.3, 0.25]));
    at('head', 0, mesh(new THREE.BoxGeometry(0.006, 0.05, 0.01), std(c.b, 0.35, 0.2), [0.042, 0.15, -0.12], [0, 0, 0.1]));
  },
  speed(at, c) { // a swept speed helmet, a dark face plate, three eyes in a triangle
    at('head', 0, mesh(new THREE.SphereGeometry(0.12, 24, 16), std(c.a, 0.25, 0.5), [0, 0.2, 0.03], [0.15, 0, 0], [0.95, 1.02, 1.4]));
    at('head', 0, mesh(new THREE.SphereGeometry(0.11, 20, 14, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.3, Math.PI * 0.45), std(c.b, 0.3, 0.6), [0, 0.2, 0], [0, Math.PI, 0], [1, 1, 1.12]));
    for (const [x, y] of [[-0.035, 0.22], [0.035, 0.22], [0, 0.17]]) at('head', 0, mesh(new THREE.SphereGeometry(0.014, 8, 6), glowMat(c.glow, 2.8), [x, y, -0.123]));
  },
};
const CROWNS = {
  none() {},
  blades(at, c) { for (const k of [-1, 0, 1]) at('head', 0, mesh(new THREE.ConeGeometry(0.035, 0.32 - Math.abs(k) * 0.08, 4), std(c.trim, 0.22, 0.85), [k * 0.05, 0.36, 0.08], [-1.15, 0, k * 0.35], [0.5, 1, 1])); },
  jester(at, c) {
    at('head', 0, mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 18, Math.PI * 1.3), std(c.trim, 0.22, 0.85), [0, 0.29, -0.1], [0, 0, -0.5])); // a crescent on the brow
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.42;
      at('head', 0, mesh(new THREE.ConeGeometry(0.04, 0.26, 8), std(k % 2 ? c.b : c.a, 0.35, 0.2), [Math.sin(a) * 0.1, 0.37, 0.02], [0.2, 0, -a * 1.1]));
      at('head', 0, mesh(new THREE.SphereGeometry(0.022, 8, 6), std(c.trim, 0.22, 0.85), [Math.sin(a) * 0.22, 0.47 - Math.abs(a) * 0.12, 0.05]));
    }
  },
  bolt(at, c) { at('head', 0, mesh(bolt(0.12, 0.3, 0.035), std(c.a, 0.25, 0.5), [0, 0.3, 0.02], [0, Math.PI / 2, 0.15])); },
};
const SHOULDERS = {
  none() {},
  gears(at, c) {
    for (const n of [0, 1]) {
      const gear = new THREE.Group(), gold = std(c.trim, 0.22, 0.85); gear.add(mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 24), gold));
      for (let t = 0; t < 10; t++) { const a = (t / 10) * Math.PI * 2; gear.add(mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), gold, [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0], [0, 0, a])); }
      gear.position.set((n ? 1 : -1) * 0.03, -0.01, 0); gear.rotation.y = Math.PI / 2; at('upperArm', n, gear);
    }
  },
  ruff(at, c) { for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; at('top', 0, mesh(new THREE.ConeGeometry(0.03, 0.14, 6), std(k % 2 ? '#f6f0ea' : c.a, 0.35, 0.2), [Math.cos(a) * 0.1, 0.57, Math.sin(a) * 0.07], [Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3])); } },
  bolts(at, c) { for (const n of [0, 1]) at('upperArm', n, mesh(bolt(0.07, 0.2, 0.03), std(c.a, 0.25, 0.5), [(n ? 1 : -1) * 0.05, 0.02, 0], [0, Math.PI / 2, (n ? -1 : 1) * 0.4])); },
};
const ARMS = {
  none() {},
  vambraces(at, c) { for (const n of [0, 1]) at('foreArm', n, mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.17, 12), std(c.trim, 0.22, 0.85), [0, -0.13, 0])); },
  claws(at, c) { for (const n of [0, 1]) for (let f = 0; f < 3; f++) at('hand', n, mesh(new THREE.ConeGeometry(0.012, 0.14, 6), std(c.b, 0.35, 0.2), [-0.02 + f * 0.02, -0.15, -0.01], [Math.PI, 0, 0])); },
  fins(at, c) { for (const n of [0, 1]) at('foreArm', n, mesh(new THREE.ConeGeometry(0.03, 0.2, 4), std(c.b, 0.3, 0.6), [0, -0.1, 0.06], [-1.9, 0, 0], [0.4, 1, 1])); },
};
const LEGS = {
  full() {},
  spiked(at, c) { for (const n of [0, 1]) at('shin', n, mesh(new THREE.ConeGeometry(0.04, 0.16, 5), std(c.a, 0.25, 0.5), [0, 0.02, -0.07], [-1.3, 0, 0])); },
  ribbons(at, c) { // the legs end in ribbons (the shins and feet are not drawn)
    for (const n of [0, 1]) for (let k = 0; k < 3; k++) {
      const rb = new THREE.PlaneGeometry(0.07, 0.75, 1, 12); rb.translate(0, -0.375, 0); const pa = rb.attributes.position;
      for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setX(i, pa.getX(i) * (1 + y * 0.9) + 0.06 * Math.sin(y * 7 + k * 2)); pa.setZ(i, 0.05 * Math.cos(y * 5 + k)); }
      rb.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({ color: k === 1 ? c.b : c.a, side: THREE.DoubleSide, roughness: 0.5, transparent: true });
      at('thigh', n, mesh(rb, m, [(k - 1) * 0.04, -0.36, 0], [0, k * 0.4, 0]));
    }
  },
};
const CHESTS = {
  none() {},
  keyhole(at, c) { // a glowing keyhole on the chest and cables from the helm down the back
    const g = glowMat(c.glow), key = new THREE.Group(); key.add(mesh(new THREE.CircleGeometry(0.035, 18), g), mesh(new THREE.PlaneGeometry(0.028, 0.06), g, [0, -0.04, 0]));
    key.position.set(0, 0.44, -0.122); key.rotation.y = Math.PI; at('top', 0, key);
    for (const s of [-1, 1]) at('top', 0, mesh(tube([[s * 0.04, 0.68, 0.1], [s * 0.1, 0.72, 0.2], [s * 0.18, 0.55, 0.18], [s * 0.16, 0.42, 0.12]], 0.016), std(c.b, 0.4, 0.6)));
  },
  star(at, c) { // a glowing star on the chest
    const s = new THREE.Shape(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.02 : 0.05, a = (k / 10) * Math.PI * 2; s[k ? 'lineTo' : 'moveTo'](Math.sin(a) * r, Math.cos(a) * r); }
    at('top', 0, mesh(new THREE.ShapeGeometry(s), glowMat(c.glow), [0, 0.43, -0.122], [0, Math.PI, 0]));
  },
};
const PARTS = { skin: SKINS, head: HEADS, crown: CROWNS, shoulders: SHOULDERS, arms: ARMS, legs: LEGS, chest: CHESTS };
/** The part names per slot (figure/custom.js STAND_PARTS lists the same, for the creator). */
export const PART_NAMES = Object.fromEntries(Object.entries(PARTS).map(([k, t]) => [k, Object.keys(t)]));

// ---- the presets: the owner-approved concept designs ------------------------------------------
export const PRESETS = {
  iron: { name: 'IRON HYMN', skin: 'circuit', head: 'helm', crown: 'blades', shoulders: 'gears', arms: 'vambraces', legs: 'full', chest: 'keyhole',
    a: '#eee6d1', b: '#1a1f24', trim: '#e8b84a', glow: '#27f2e0', aura: '#38f2e0', build: 'broad', ability: 'guard' },
  velvet: { name: 'VELVET ENCORE', skin: 'harlequin', head: 'mask', crown: 'jester', shoulders: 'ruff', arms: 'claws', legs: 'ribbons', chest: 'none',
    a: '#e01f80', b: '#120812', trim: '#f2c050', glow: '#ffe14a', aura: '#ff3fa8', build: 'slender', ability: 'encore' },
  wire: { name: 'LIVE WIRE', skin: 'zigzag', head: 'speed', crown: 'bolt', shoulders: 'bolts', arms: 'fins', legs: 'spiked', chest: 'none',
    a: '#ffcc1a', b: '#0c0c10', trim: '#0c0c10', glow: '#4dd2ff', aura: '#ffd21f', build: 'athletic', ability: 'dash' },
};
const BUILDS = { broad: { width: 1.2, scale: 1.42 }, slender: { width: 0.95, scale: 1.5 }, athletic: { width: 1.12, scale: 1.4 } };
export const ABILITIES = {
  guard: { name: 'Guard', coolS: 8, text: 'blocks every hit for 2 s' },
  encore: { name: 'Encore', coolS: 6, text: 'rewinds you 3 s' },
  dash: { name: 'Short Circuit', coolS: 4, text: 'a lightning dash that hits whoever is in the way' },
};

/**
 * A Stand from a preset id or a designer spec (figure/custom.js customVariant: v.standSpec) ->
 * { key, name, aura, accent, width, scale, ribbons, sparks, ability, skin(), build(attach) }.
 */
export function resolveStand(spec) {
  const s = { ...PRESETS.iron, ...(typeof spec === 'string' ? PRESETS[spec] : spec) };
  for (const [k, table] of Object.entries(PARTS)) if (!table[s[k]]) s[k] = PRESETS.iron[k]; // unknown parts fall back
  const colours = { a: s.a, b: s.b, trim: s.trim, glow: s.glow };
  return {
    ...(BUILDS[s.build] || BUILDS.broad), key: JSON.stringify(s), name: s.name, aura: s.aura,
    accent: s.trim === s.b ? s.glow : s.trim, ribbons: s.legs === 'ribbons', sparks: s.skin === 'zigzag' ? s.glow : null,
    ability: ABILITIES[s.ability] ? s.ability : 'guard',
    skin: () => paintedMaterial(SKINS[s.skin](colours), s.skin === 'harlequin' ? { rough: 0.4, metal: 0.2 } : {}),
    build(at) { for (const k of ['head', 'crown', 'shoulders', 'arms', 'legs', 'chest']) PARTS[k][s[k]](at, colours); },
  };
}

/** A soft flame-shaped aura in a colour (a canvas texture for a sprite). */
export function auraTexture(col) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 300, 10, 128, 300, 230); g.addColorStop(0, `${col}aa`); g.addColorStop(0.5, `${col}44`); g.addColorStop(1, `${col}00`);
  x.fillStyle = g; x.fillRect(0, 0, 256, 512);
  x.globalCompositeOperation = 'lighter'; x.filter = 'blur(7px)';
  for (let k = 0; k < 18; k++) { // flame tongues licking upwards
    const bx = 30 + Math.random() * 196, by = 330 + Math.random() * 140, h = 120 + Math.random() * 220, w = 10 + Math.random() * 24;
    const lg = x.createLinearGradient(bx, by, bx, by - h); lg.addColorStop(0, `${col}55`); lg.addColorStop(1, `${col}00`);
    x.fillStyle = lg; x.beginPath(); x.moveTo(bx - w, by);
    x.quadraticCurveTo(bx - w * 0.2 + (Math.random() - 0.5) * 30, by - h * 0.6, bx + (Math.random() - 0.5) * 40, by - h);
    x.quadraticCurveTo(bx + w * 0.4, by - h * 0.5, bx + w, by); x.fill();
  }
  x.filter = 'none'; x.globalCompositeOperation = 'destination-in';
  x.setTransform(1, 0, 0, 2, 0, -280); // an ellipse as tall as the canvas: zero at every edge
  const fade = x.createRadialGradient(128, 280, 20, 128, 280, 126); fade.addColorStop(0, '#000f'); fade.addColorStop(0.6, '#000c'); fade.addColorStop(1, '#0000');
  x.fillStyle = fade; x.fillRect(0, 0, 256, 512); x.setTransform(1, 0, 0, 1, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
