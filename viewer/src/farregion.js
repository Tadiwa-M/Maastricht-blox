// Baked far regions (src/farbake.js, tools/bake-far.mjs) on screen: the whole-city silhouette.
//
// A region file's quads become one geometry per family ('opaque' with the city far material,
// 'water'): positions in coarse grid units (Uint16), scaled and placed by the mesh transform,
// colour from the palette, glow for glass (hashed per coarse window cell, like src/glow.js) and
// lamps, shine per material. Quads are sorted by owner chunk, so each owner is an index range,
// and a region draws only the owners whose real chunk is not streamed in (geometry groups, as
// src/lod.js clusters).
//
// FarRegions keeps level 3 (coarsest) of every region resident and streams levels 2 and 1 by
// distance (src/stream.js), showing per region the finest level that is loaded and wanted at
// that distance; with nothing finer loaded it falls back to a coarser one, so there are no holes.
import * as THREE from 'three';
import { brickColor } from './bricks-color.js';
import { windowColor } from './glow.js';
import { keyOf, farFamily, shineOf } from './matkey.js';
import { glowBytes } from './farmesh.js';
import { StreamScheduler, READY } from './stream.js';

// local mesh axes: X = i (east), Y = k (up), Z = j (north; mesh scale z < 0 turns it to -z)
const AXIS_TO_LOCAL = [0, 2, 1];
/** Corner order per dir so triangles face outward after the mesh's (+, +, -) scale. */
const ORDER = (() => {
  const out = [];
  for (let dir = 0; dir < 6; dir++) {
    const a = dir >> 1, sgn = dir & 1 ? -1 : 1, u = (a + 1) % 3, v = (a + 2) % 3;
    const corner = (du, dv) => { const g = [0, 0, 0]; g[u] = du; g[v] = dv; return [g[0], g[2], -g[1]]; }; // final three axes
    const c = [corner(0, 0), corner(1, 0), corner(1, 1)];
    const e1 = c[1].map((x, q) => x - c[0][q]), e2 = c[2].map((x, q) => x - c[0][q]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const want = [0, 0, 0]; want[AXIS_TO_LOCAL[a]] = sgn; want[2] = -want[2];
    out.push(n[0] * want[0] + n[1] * want[1] + n[2] * want[2] > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1]);
  }
  return out;
})();

/**
 * Decoded region (decodeBxf) -> { families: Map family -> { arrays, ranges: [{ start, count }]
 * per owner }, position: [x, y, z], scale: [sx, sy, sz], triangles }. palette: Map idx -> entry.
 */
export function regionArrays({ header: h, owners, quads }, palette, studM = 0.5, plateM = 0.2) {
  const fams = new Map();
  const famOf = new Uint8Array(256), names = [];
  const style = new Map();
  for (const [idx, entry] of palette) {
    const key = keyOf(entry);
    const fam = farFamily(key);
    if (!names.includes(fam)) names.push(fam);
    famOf[idx] = names.indexOf(fam);
    style.set(idx, { key, shine: shineOf(key), color: brickColor(entry, 0, 0, 0, true) });
  }
  // pass 1: quads per family to size the buffers
  const perFam = names.map(() => 0);
  for (let q = 0; q < quads.count; q++) perFam[famOf[quads.color[q]]]++;
  const bufs = names.map((name, f) => {
    const n = perFam[f], verts = n * 4;
    return { name, n, v: 0, i: 0, position: new Uint16Array(verts * 3), normal: new Int8Array(verts * 3),
      color: new Uint16Array(verts * 3), extra: new Uint8Array(verts * 4),
      index: verts > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6), ranges: owners.map(() => ({ start: 0, count: 0 })) };
  });
  const col = new THREE.Color(), glow = new THREE.Color();
  const g = [0, 0, 0];
  let o = 0, ownerEnd = owners.length ? owners[0].quads : 0;
  for (const b of bufs) b.ranges[0] && (b.ranges[0].start = 0);
  for (let q = 0; q < quads.count; q++) {
    while (o < owners.length - 1 && q >= ownerEnd) {
      o++; ownerEnd += owners[o].quads;
      for (const b of bufs) b.ranges[o].start = b.i;
    }
    const c = quads.color[q], st = style.get(c) || { key: 'solid', shine: 0, color: col.set('#ff00ff').clone() };
    const b = bufs[famOf[c]];
    const dir = quads.dir[q], a = dir >> 1, u = (a + 1) % 3, v = (a + 2) % 3;
    const x = quads.x[q], y = quads.y[q], z = quads.z[q], w = quads.w[q], hh = quads.h[q];
    // colour: palette colour with a small hashed variation per quad (big merged quads stay calm)
    col.copy(st.color);
    const f = 1 + (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 255) / 255 * 0.06 - 0.03;
    col.multiplyScalar(f);
    let gl = null;
    if (st.key === 'glass') gl = windowColor(0, h.gi0 + x, h.gj0 + y, h.gk0 * 7 + z * 3 + dir, glow);
    else if (st.key.startsWith('emissive:')) gl = glow.copy(st.color).multiplyScalar(0.6);
    const [gr, gg, gb] = glowBytes(gl);
    const nl = [0, 0, 0]; nl[AXIS_TO_LOCAL[a]] = dir & 1 ? -127 : 127;
    const base = b.v;
    for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      g[0] = x; g[1] = y; g[2] = z;
      g[u] += du * w; g[v] += dv * hh;
      const p = b.v * 3;
      b.position[p] = g[0]; b.position[p + 1] = g[2]; b.position[p + 2] = g[1];
      b.normal[p] = nl[0]; b.normal[p + 1] = nl[1]; b.normal[p + 2] = nl[2];
      b.color[p] = Math.min(65535, col.r * 65535); b.color[p + 1] = Math.min(65535, col.g * 65535); b.color[p + 2] = Math.min(65535, col.b * 65535);
      const e = b.v * 4;
      b.extra[e] = gr; b.extra[e + 1] = gg; b.extra[e + 2] = gb; b.extra[e + 3] = st.shine;
      b.v++;
    }
    const ord = ORDER[dir];
    b.index[b.i++] = base + ord[0]; b.index[b.i++] = base + ord[1]; b.index[b.i++] = base + ord[2];
    b.index[b.i++] = base + ord[0]; b.index[b.i++] = base + ord[2]; b.index[b.i++] = base + ord[3];
    b.ranges[o].count += 6;
  }
  const families = new Map();
  for (const b of bufs) {
    if (!b.n) continue;
    families.set(b.name, { arrays: { position: b.position, normal: b.normal, color: b.color, extra: b.extra, index: b.index }, ranges: b.ranges });
  }
  const sx = h.cellStuds * studM, sy = h.cellPlates * plateM;
  return { families, position: [h.gi0 * sx, h.gk0 * sy, -h.gj0 * sx], scale: [sx, sy, -sx], triangles: quads.count * 2 };
}

function geometryOf(a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3, true));
  g.setAttribute('aExtra', new THREE.BufferAttribute(a.extra, 4, true));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Region meshes of one level: { group, parts: [{ mesh, ranges }], owners, triangles }. */
export function regionMeshes(decoded, palette, mats, studM, plateM) {
  const r = regionArrays(decoded, palette, studM, plateM);
  const group = new THREE.Group();
  group.position.fromArray(r.position);
  group.scale.fromArray(r.scale);
  group.name = `far region ${decoded.header.rx},${decoded.header.ry}`;
  const parts = [];
  for (const [fam, { arrays, ranges }] of r.families) {
    const mat = mats.cityFar(fam);
    const mesh = new THREE.Mesh(geometryOf(arrays), [mat]);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    mesh.name = `farbake|${fam}`;
    group.add(mesh);
    parts.push({ mesh, ranges });
  }
  group.updateMatrixWorld(true);
  return { group, parts, owners: decoded.owners, triangles: r.triangles };
}

/** Index ranges of the owners not hidden, merged into geometry groups. */
export function refreshGroups(look, hidden) {
  for (const { mesh, ranges } of look.parts) {
    const g = mesh.geometry;
    g.clearGroups();
    let run = null, tris = 0;
    look.owners.forEach((ow, s) => {
      const r = ranges[s];
      if (!r.count || hidden(ow.cx, ow.cy)) { run = null; return; }
      tris += r.count / 3;
      if (run && run.start + run.count === r.start) run.count += r.count;
      else { run = { start: r.start, count: r.count, materialIndex: 0 }; g.groups.push(run); }
    });
    mesh.visible = g.groups.length > 0;
    mesh.userData.triangles = tris;
  }
}

/**
 * All baked regions. index = far/index.json; fetchBytes(path, signal) -> Uint8Array;
 * decode(bytes) -> decoded region (decodeBxf); covered(cx, cy) -> is the real chunk shown?
 * showDist: [d1, d2]: level 1 within d1 m of the camera, level 2 within d2, else level 3.
 */
export class FarRegions {
  constructor(index, { palette, mats, fetchBytes, decode, covered, showDist = [260, 900] }) {
    Object.assign(this, { index, palette, mats, fetchBytes, decode, covered, showDist });
    this.group = new THREE.Group();
    this.group.name = 'far regions';
    this.regions = new Map();
    const R = index.regionChunks, CM = index.chunkStuds * index.studM;
    const levels = [...index.levels].sort((a, b) => b.level - a.level); // coarsest first
    this.levels = levels.map((l) => l.level);
    this.coarsest = this.levels[0];
    this.schedulers = new Map();
    for (const lv of levels) {
      const items = lv.regions.map((r) => {
        const key = `${r.rx},${r.ry}`;
        if (!this.regions.has(key)) {
          this.regions.set(key, { key, rx: r.rx, ry: r.ry, looks: new Map(), shown: null, sig: '',
            box: { min: { x: r.rx * R * CM, y: 0, z: -(r.ry + 1) * R * CM }, max: { x: (r.rx + 1) * R * CM, y: 120, z: -r.ry * R * CM } } });
        }
        const reg = this.regions.get(key);
        return { key: `${lv.level}|${key}`, box: reg.box, file: r.file, level: lv.level, region: reg };
      });
      const coarsest = lv.level === this.coarsest;
      const sched = new StreamScheduler(items, {
        loadRadius: coarsest ? Infinity : this.loadRadius(lv.level), unloadRadius: coarsest ? Infinity : this.loadRadius(lv.level) * 1.4,
        concurrency: coarsest ? 8 : 3,
        load: async (it, signal) => {
          const look = regionMeshes(await this.decode(await this.fetchBytes(it.file, signal)), this.palette, this.mats, index.studM, index.plateM);
          return look;
        },
        unload: (it, look) => {
          if (!look) return;
          if (it.region.looks.get(it.level) === look) it.region.looks.delete(it.level);
          this.group.remove(look.group);
          for (const p of look.parts) p.mesh.geometry.dispose();
          if (it.region.shown === look) it.region.shown = null;
        },
      });
      sched.onReady = (it) => { it.region.looks.set(it.level, it.payload); it.payload.level = it.level; this.group.add(it.payload.group); it.payload.group.visible = false; };
      this.schedulers.set(lv.level, sched);
    }
  }

  loadRadius(level) {
    const i = this.levels.indexOf(level); // levels: coarsest first
    const finer = this.levels.length - 1 - i; // 0 for the finest
    return (this.showDist[finer] ?? this.showDist[this.showDist.length - 1]) * 1.3;
  }

  /** Has the coarsest level of every region arrived (the whole silhouette)? */
  silhouetteReady() { return this.schedulers.get(this.coarsest).settled() && this.schedulers.get(this.coarsest).loadedCount > 0; }
  settled() { return [...this.schedulers.values()].every((s) => s.settled()); }

  levelFor(dist) {
    const finest = this.levels[this.levels.length - 1];
    for (let q = 0; q < this.showDist.length; q++) if (dist < this.showDist[q]) return Math.min(this.coarsest, finest + q);
    return this.coarsest;
  }

  /** eye: camera position; dirty: something changed what is covered. */
  update(eye, coverChanged = false) {
    for (const s of this.schedulers.values()) s.update(eye);
    let tris = 0, draws = 0;
    for (const reg of this.regions.values()) {
      const dx = Math.max(reg.box.min.x - eye.x, 0, eye.x - reg.box.max.x), dz = Math.max(reg.box.min.z - eye.z, 0, eye.z - reg.box.max.z);
      const want = this.levelFor(Math.hypot(dx, Math.max(0, eye.y - reg.box.max.y), dz));
      let look = reg.looks.get(want) || null;
      for (let l = want + 1; !look && l <= this.coarsest; l++) look = reg.looks.get(l) || null; // coarser fallback
      for (let l = want - 1; !look && l >= 1; l--) look = reg.looks.get(l) || null;
      if (look !== reg.shown) {
        if (reg.shown) reg.shown.group.visible = false;
        reg.shown = look;
        reg.sig = '';
      }
      if (!look) continue;
      look.group.visible = true;
      if (coverChanged || !reg.sig) { refreshGroups(look, this.covered); reg.sig = 'ok'; }
      for (const p of look.parts) if (p.mesh.visible) { tris += p.mesh.userData.triangles; draws += p.mesh.geometry.groups.length; }
    }
    this.lastStats = { regions: this.regions.size, triangles: tris, groups: draws };
    return this.lastStats;
  }

  stats() {
    const loaded = {};
    for (const [l, s] of this.schedulers) loaded[`l${l}`] = s.loadedCount;
    return { ...this.lastStats, ...loaded };
  }
}

export { READY };
