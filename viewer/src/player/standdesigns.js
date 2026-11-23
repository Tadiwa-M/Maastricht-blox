// The Stands a player can have (the manga look; owner-approved concept mockup, 2026-11-23): three
// original designs, each the anime figure's body (figure/animeparts.js) in a painted skin, a head
// and armour of its own, an aura colour. Not designs from the series; named after songs, as that
// world names them. Pure data and geometry; player/stand.js poses and shows them.
//   iron    IRON HYMN: ivory armour, glowing teal circuit lines, a faceless helm with one eye slit,
//           three swept blades, gear shoulder plates, cables, a keyhole on the chest
//   velvet  VELVET ENCORE: a magenta and black harlequin, a white mask with diamond eyes, a jester
//           crown, a ruff, claws; the legs end in ribbons
//   wire    LIVE WIRE: yellow with black zigzags and blue sparks, a swept speed helmet with three
//           eyes and a lightning crest, bolts off the shoulders, fins, knee spikes
// attach(key, n, object): fixes an object to the figure part `key` (n: 0 left, 1 right), in that
// part's own frame (parts.js: head origin at the neck base, front -z; limbs hang down -y).
import * as THREE from 'three';

export { STANDS as STAND_IDS } from '../figure/custom.js';

/** A material whose colour (and glow) GLSL paints from the part's own coordinates p. */
export function paintedMaterial(glsl, { rough = 0.32, metal = 0.35 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: rough, metalness: metal, transparent: true });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;');
    sh.fragmentShader = 'varying vec3 vObj;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n  vec3 gGlow = vec3(0.0);\n  { vec3 p = vObj; vec3 c = vec3(1.0);\n${glsl}\n  diffuseColor.rgb = c; }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += gGlow;');
  };
  m.customProgramCacheKey = () => `stand:${glsl.length}:${glsl.slice(0, 40)}`;
  return m;
}

const glow = (c, k = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false, transparent: true });
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

export const STAND_DESIGNS = {
  iron: {
    name: 'IRON HYMN', aura: '#38f2e0', accent: '#e8b84a', width: 1.2, scale: 1.42,
    skin: () => paintedMaterial(`
      c = vec3(0.93, 0.9, 0.82);
      float seam = smoothstep(0.86, 0.9, fract(p.y * 8.0 + 0.3)) * (1.0 - smoothstep(0.9, 0.94, fract(p.y * 8.0 + 0.3)));
      c = mix(c, vec3(0.1, 0.12, 0.14), seam * 0.85);
      float centre = 1.0 - smoothstep(0.004, 0.009, abs(p.x));
      float trace = (1.0 - smoothstep(0.003, 0.006, abs(fract(p.x * 9.0 + floor(p.y * 6.0) * 0.37) - 0.5) - 0.42)) * step(0.5, fract(p.y * 6.0));
      vec3 teal = vec3(0.15, 0.95, 0.88);
      c = mix(c, teal, max(centre, trace * 0.8)); gGlow = teal * max(centre, trace * 0.7) * 1.6;`),
    build(attach) {
      const ivory = std('#efe8d6', 0.25, 0.3), gold = std('#e8b84a', 0.22, 0.85), teal = glow('#38f2e0'), dark = std('#1a2026', 0.4, 0.6);
      attach('head', 0, mesh(new THREE.SphereGeometry(0.125, 24, 16), ivory, [0, 0.2, 0.01], [0, 0, 0], [1, 1.16, 1.12])); // a smooth faceless helm
      attach('head', 0, mesh(new THREE.BoxGeometry(0.014, 0.12, 0.02), teal, [0, 0.2, -0.138])); // one vertical eye slit
      for (const k of [-1, 0, 1]) attach('head', 0, mesh(new THREE.ConeGeometry(0.035, 0.32 - Math.abs(k) * 0.08, 4), gold, [k * 0.05, 0.36, 0.08], [-1.15, 0, k * 0.35], [0.5, 1, 1]));
      for (const s of [-1, 1]) attach('top', 0, mesh(tube([[s * 0.04, 0.68, 0.1], [s * 0.1, 0.72, 0.2], [s * 0.18, 0.55, 0.18], [s * 0.16, 0.42, 0.12]], 0.016), dark)); // cables
      for (const n of [0, 1]) {
        const gear = new THREE.Group(); gear.add(mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 24), gold));
        for (let t = 0; t < 10; t++) { const a = (t / 10) * Math.PI * 2; gear.add(mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), gold, [Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0], [0, 0, a])); }
        gear.position.set((n ? 1 : -1) * 0.03, -0.01, 0); gear.rotation.y = Math.PI / 2; attach('upperArm', n, gear);
        attach('foreArm', n, mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.17, 12), gold, [0, -0.13, 0]));
      }
      const key = new THREE.Group(); key.add(mesh(new THREE.CircleGeometry(0.035, 18), teal), mesh(new THREE.PlaneGeometry(0.028, 0.06), teal, [0, -0.04, 0]));
      key.position.set(0, 0.44, -0.122); key.rotation.y = Math.PI; attach('top', 0, key); // a glowing keyhole on the chest
    },
  },
  velvet: {
    name: 'VELVET ENCORE', aura: '#ff3fa8', accent: '#d11a72', width: 0.95, scale: 1.5, ribbons: true,
    skin: () => paintedMaterial(`
      vec2 q = vec2(p.x + p.y, p.x - p.y) * 9.0;
      float chk = mod(floor(q.x) + floor(q.y), 2.0);
      vec2 f = abs(fract(q) - 0.5);
      float edge = 1.0 - smoothstep(0.44, 0.48, max(f.x, f.y));
      c = mix(vec3(0.07, 0.03, 0.09), vec3(0.88, 0.12, 0.5), chk);
      c = mix(vec3(0.95, 0.75, 0.3), c, edge);`, { rough: 0.4, metal: 0.2 }),
    build(attach) {
      const pearl = std('#f6f0ea', 0.3, 0.1), gold = std('#e8b84a', 0.22, 0.85), black = std('#120812', 0.35, 0.2), mag = std('#d11a72', 0.35, 0.2), eye = glow('#ffe14a');
      attach('head', 0, mesh(new THREE.SphereGeometry(0.12, 24, 16), pearl, [0, 0.19, -0.02], [0, 0, 0], [0.92, 1.22, 0.95])); // the white mask
      for (const s of [-1, 1]) attach('head', 0, mesh(new THREE.OctahedronGeometry(0.03), eye, [s * 0.042, 0.2, -0.124], [0, 0, 0], [0.7, 1.3, 0.25])); // diamond eyes
      attach('head', 0, mesh(new THREE.BoxGeometry(0.006, 0.05, 0.01), black, [0.042, 0.15, -0.12], [0, 0, 0.1])); // one painted tear
      attach('head', 0, mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 18, Math.PI * 1.3), gold, [0, 0.29, -0.1], [0, 0, -0.5])); // a crescent on the brow
      for (let k = 0; k < 5; k++) { // the jester crown, tipped with gold
        const a = (k - 2) * 0.42;
        attach('head', 0, mesh(new THREE.ConeGeometry(0.04, 0.26, 8), k % 2 ? black : mag, [Math.sin(a) * 0.1, 0.37, 0.02], [0.2, 0, -a * 1.1]));
        attach('head', 0, mesh(new THREE.SphereGeometry(0.022, 8, 6), gold, [Math.sin(a) * 0.22, 0.47 - Math.abs(a) * 0.12, 0.05]));
      }
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; attach('top', 0, mesh(new THREE.ConeGeometry(0.03, 0.14, 6), k % 2 ? pearl : mag, [Math.cos(a) * 0.1, 0.57, Math.sin(a) * 0.07], [Math.sin(a) * 1.3, 0, -Math.cos(a) * 1.3])); } // a ruff
      for (const n of [0, 1]) for (let f = 0; f < 3; f++) attach('hand', n, mesh(new THREE.ConeGeometry(0.012, 0.14, 6), black, [-0.02 + f * 0.02, -0.15, -0.01], [Math.PI, 0, 0])); // long claws
      for (const n of [0, 1]) for (let k = 0; k < 3; k++) { // the legs end in ribbons
        const rb = new THREE.PlaneGeometry(0.07, 0.75, 1, 12); rb.translate(0, -0.375, 0); const pa = rb.attributes.position;
        for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setX(i, pa.getX(i) * (1 + y * 0.9) + 0.06 * Math.sin(y * 7 + k * 2)); pa.setZ(i, 0.05 * Math.cos(y * 5 + k)); }
        rb.computeVertexNormals();
        const m = new THREE.MeshStandardMaterial({ color: k === 1 ? '#120812' : '#d11a72', side: THREE.DoubleSide, roughness: 0.5, transparent: true });
        attach('thigh', n, mesh(rb, m, [(k - 1) * 0.04, -0.36, 0], [0, k * 0.4, 0]));
      }
    },
  },
  wire: {
    name: 'LIVE WIRE', aura: '#ffd21f', accent: '#5fd8ff', width: 1.12, scale: 1.4, sparks: '#9fe8ff',
    skin: () => paintedMaterial(`
      float z = p.y * 11.0 + abs(fract((p.x + p.z) * 5.0) - 0.5) * 2.2;
      float band = step(0.62, fract(z));
      float sparkLine = (1.0 - smoothstep(0.0, 0.03, abs(fract(z) - 0.62)));
      c = mix(vec3(1.0, 0.8, 0.1), vec3(0.05, 0.05, 0.06), band);
      vec3 blue = vec3(0.3, 0.8, 1.0); c = mix(c, blue, sparkLine * 0.8); gGlow = blue * sparkLine * 1.4;`, { rough: 0.28, metal: 0.4 }),
    build(attach) {
      const yel = std('#ffcc1a', 0.25, 0.5), black = std('#0c0c10', 0.3, 0.6), blue = glow('#5fd8ff', 2.8);
      attach('head', 0, mesh(new THREE.SphereGeometry(0.12, 24, 16), yel, [0, 0.2, 0.03], [0.15, 0, 0], [0.95, 1.02, 1.4])); // a swept speed helmet
      attach('head', 0, mesh(new THREE.SphereGeometry(0.11, 20, 14, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.3, Math.PI * 0.45), black, [0, 0.2, 0], [0, Math.PI, 0], [1, 1, 1.12])); // the face plate
      for (const [x, y] of [[-0.035, 0.22], [0.035, 0.22], [0, 0.17]]) attach('head', 0, mesh(new THREE.SphereGeometry(0.014, 8, 6), blue, [x, y, -0.123])); // three eyes
      attach('head', 0, mesh(bolt(0.12, 0.3, 0.035), yel, [0, 0.3, 0.02], [0, Math.PI / 2, 0.15])); // a lightning crest
      for (const n of [0, 1]) {
        attach('upperArm', n, mesh(bolt(0.07, 0.2, 0.03), yel, [(n ? 1 : -1) * 0.05, 0.02, 0], [0, Math.PI / 2, (n ? -1 : 1) * 0.4])); // bolts off the shoulders
        attach('foreArm', n, mesh(new THREE.ConeGeometry(0.03, 0.2, 4), black, [0, -0.1, 0.06], [-1.9, 0, 0], [0.4, 1, 1])); // fins
        attach('shin', n, mesh(new THREE.ConeGeometry(0.04, 0.16, 5), yel, [0, 0.02, -0.07], [-1.3, 0, 0])); // knee spikes
      }
    },
  },
};

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
  x.filter = 'none'; x.globalCompositeOperation = 'destination-in'; // fade out at the edges, no hard border
  x.setTransform(1, 0, 0, 2, 0, -280); // an ellipse as tall as the canvas: zero at every edge
  const fade = x.createRadialGradient(128, 280, 20, 128, 280, 126); fade.addColorStop(0, '#000f'); fade.addColorStop(0.6, '#000c'); fade.addColorStop(1, '#0000');
  x.fillStyle = fade; x.fillRect(0, 0, 256, 512); x.setTransform(1, 0, 0, 1, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
