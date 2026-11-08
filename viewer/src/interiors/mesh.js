// three.js side of interiors: the room (one merged mesh of boxes with studs on top, like a brick
// model), the menu board text and the blade sign outside the door. Boxes come from layout.js in
// room metres; here room (x, y, z) is three.js local (x, y, -z), and the group is turned and
// placed into the world with the room frame (rotation.js rotToYaw, never hand-rolled).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rotToYaw, frontDir } from '../rotation.js';
import { roomBoxes, roomFrame } from './layout.js';

export const STUD = { pitch: 0.25, r: 0.075, h: 0.045 }; // furniture-scale studs (half the city's)
const AMBIENT = 0.22; // the room's own light (emissive share of every colour): rooms are lit indoors

/** Studs on a box top: centres [x, z] (room metres) on the stud pitch, at least one. Pure. */
export function studCentres(min, max, pitch = STUD.pitch) {
  const nx = Math.max(1, Math.floor((max[0] - min[0]) / pitch + 1e-6)), nz = Math.max(1, Math.floor((max[2] - min[2]) / pitch + 1e-6));
  const out = [];
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    out.push([(min[0] + max[0]) / 2 + (a - (nx - 1) / 2) * pitch, (min[2] + max[2]) / 2 + (b - (nz - 1) / 2) * pitch]);
  }
  return out;
}

/** Vertex colours + glow on a geometry (non-indexed, uv dropped so every part merges). */
function paint(geo, colour, glow) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3), e = new Float32Array(n);
  for (let q = 0; q < n; q++) { c[q * 3] = colour.r; c[q * 3 + 1] = colour.g; c[q * 3 + 2] = colour.b; e[q] = glow; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('glow', new THREE.BufferAttribute(e, 1));
  return g;
}

/** A material whose vertex colours also glow a little (indoor light) and fully where glow = 1. */
export function roomMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (${AMBIENT.toFixed(2)} + vGlow);`);
  };
  m.customProgramCacheKey = () => 'interior-room';
  return m;
}

/** A canvas texture with a title and lines (menu board, sign). */
export function textTexture(title, lines = [], { w = 512, h = 384, bg = '#1F2B24', fg = '#F6F3EA', accent = '#F2A900' } = {}) {
  if (typeof document === 'undefined') return null;
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const big = lines.length ? Math.round(h * 0.13) : Math.round(h * 0.42);
  g.fillStyle = accent; g.font = `700 ${big}px system-ui, sans-serif`;
  let size = big;
  while (g.measureText(title).width > w * 0.9 && size > 10) { size -= 2; g.font = `700 ${size}px system-ui, sans-serif`; }
  g.fillText(title, w / 2, lines.length ? h * 0.12 : h / 2);
  g.fillStyle = fg;
  const lh = Math.min(h * 0.07, (h * 0.8) / Math.max(1, lines.length));
  g.font = `500 ${Math.round(lh * 0.8)}px system-ui, sans-serif`;
  lines.forEach((l, q) => g.fillText(l, w / 2, h * 0.24 + lh * (q + 0.5)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The room as a group in room-local three.js space (x right, y up, -z into the room). */
export function buildRoomGroup(place) {
  const group = new THREE.Group();
  group.name = `interior:${place.id}`;
  const parts = [];
  const studGeo = new THREE.CylinderGeometry(STUD.r, STUD.r, STUD.h, 10, 1);
  const col = new THREE.Color();
  const texBoxes = [];
  for (const b of roomBoxes(place)) {
    const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
    col.set(b.col).multiplyScalar(b.shade ?? 1);
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, -(z0 + z1) / 2);
    parts.push(paint(geo, col, b.glow));
    if (b.studs) for (const [sx, sz] of studCentres(b.min, b.max)) parts.push(paint(studGeo.clone().translate(sx, y1 + STUD.h / 2, -sz), col, b.glow));
    if (b.tex) texBoxes.push(b);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), roomMaterial());
  for (const p of parts) p.dispose();
  studGeo.dispose();
  mesh.castShadow = false; mesh.receiveShadow = false;
  group.add(mesh);
  // menu boards: the text on a plane just in front of the board's face
  for (const b of texBoxes) {
    const tex = textTexture(place.name, place.menu.length ? place.menu : ['Welcome'], { bg: '#1F2B24' });
    if (!tex) continue;
    const [fx, fz] = frontDir(b.face);
    const w = fx ? b.max[2] - b.min[2] : b.max[0] - b.min[0], h = b.max[1] - b.min[1];
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, h * 0.96),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const c = [(b.min[0] + b.max[0]) / 2 + fx * 0.012, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2 + fz * 0.012];
    plane.position.set(c[0], c[1], -c[2]);
    plane.rotation.y = rotToYaw(b.face) + Math.PI; // a plane faces +z; the board's front faces room +z at rot 0 (three.js -z)
    group.add(plane);
  }
  return group;
}

/** Place a room group in the world: its local origin is room (0, 0) at the floor height. */
export function placeRoomGroup(group, place, floorY) {
  const fr = roomFrame(place);
  const [ux, uz] = fr.toUnity(0, 0);
  group.position.set(ux, floorY, -uz);
  group.rotation.set(0, rotToYaw(fr.roomRot), 0);
  group.updateMatrixWorld(true);
}

/**
 * The blade sign over the pavement beside the door: a board sticking out from the facade with
 * the place's name on both faces (the name is data: no logos). groundY: pavement height.
 */
export function buildSign(place, groundY) {
  const fr = roomFrame(place);
  const group = new THREE.Group();
  group.name = `interior-sign:${place.id}`;
  const tex = textTexture(place.sign.text, [], { w: 512, h: 256, bg: place.sign.colour });
  // both broad faces show the name (BoxGeometry lays each face's texture out readable from outside)
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6 });
  const edge = new THREE.MeshStandardMaterial({ color: '#1E1F21', roughness: 0.5 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.95), [face, face, edge, edge, edge, edge]);
  board.position.set(0, -0.32, 0.55);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.15), new THREE.MeshStandardMaterial({ color: '#1E1F21', roughness: 0.4, metalness: 0.6 }));
  arm.position.set(0, 0, 0.55);
  group.add(board, arm);
  // beside the door (to its left seen from the street), against the facade, 3 m up; the board
  // points out along the door's facing (local +z -> outward)
  const [ux, uz] = fr.toUnity(place.door.fromLeft + 0.95, 0.35);
  group.position.set(ux, groundY + 3.0, -uz);
  group.rotation.set(0, rotToYaw(fr.outRot) + Math.PI, 0);
  board.castShadow = true;
  return group;
}
