// Per-chunk level of detail.
//
// Bricks are grouped by the chunk their min corner lies in. Each chunk has two looks:
//   near  the full look (src/bricks.js): bevelled instanced bricks, detail pieces, studs.
//         Built lazily the first time the chunk comes close, at most one chunk per frame,
//         and kept for a while (least recently used are freed). Its instanced meshes hold
//         only that chunk, so their bounding spheres let three.js cull whole chunks.
//   far   flat-shaded merged meshes with hidden faces removed (src/farmesh.js), built once
//         at load. Chunks are merged in CLUSTER x CLUSTER blocks, one mesh per (cluster,
//         material): each chunk is an index range, and a cluster draws its far chunks as
//         geometry groups (one draw per contiguous run), so a 7x7 world costs ~16 x 6
//         draws instead of 49 x 6.
// update(camera) picks near chunks by distance from the camera to the chunk's box, with
// hysteresis so a chunk on the edge does not flip every frame, caps how many are near and
// how many studs are drawn.
//
// Islands (CONTRACT 5.1, src/island.js) are extra "chunks" with their own World in local cells:
// one per island, its near and far looks built from that World exactly like a chunk's and
// hung under a THREE.Group carrying the island pose. Their box (for the near/far choice) is
// the island's world-space bounding box; near/stud caps are shared with the chunks. Each look casts its own shadows (near studs do not, with LOD). (Shadow-only proxies on a
// separate layer do not work: three.js tests shadow casters against the MAIN camera's layers.)
import * as THREE from 'three';
import { buildWorldMeshes, brickColor } from './bricks.js';
import { buildFarGeometry } from './farmesh.js';
import { NO_VARIATION } from './world.js';
import { applyIslandPose, islandWorldBox } from './island.js';

const HYSTERESIS = 1.3; // leave the near set only beyond nearDist * this
const CLUSTER = 2;      // far meshes merge CLUSTER x CLUSTER chunks
const BLACK = new THREE.Color(0, 0, 0);

class Chunk {
  constructor(cx, cy, src) {
    Object.assign(this, { cx, cy, src, list: [], box: new THREE.Box3(), near: null, isNear: false, dist: 0, used: 0,
      farTris: 0, nearTris: 0, studTris: 0, studs: 0, studMeshes: [] });
  }
}

/** Triangles drawn by one instanced or plain mesh (all instances). */
function meshTriangles(m) {
  const g = m.geometry;
  const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
  return per * (m.isInstancedMesh ? m.count : 1);
}

export class ChunkLOD {
  /**
   * ctx: worldContext(world, mats) from src/bricks.js. islands: [{ world, ctx }] with
   * world.island = { id, origin, yawDeg, cx, cy } (src/island.js).
   */
  constructor(world, mats, ctx, islands = []) {
    Object.assign(this, { world, mats, ctx, group: new THREE.Group(), frame: 0, clusters: null, studsShown: 0 });
    this.group.name = 'chunks';
    const main = { world, ctx, parent: this.group, island: null };
    this.sources = [main];
    const CS = world.chunkStuds, S = world.studM, P = world.plateM;
    const map = new Map();
    const lo = new THREE.Vector3(), hi = new THREE.Vector3();
    for (let n = 0; n < world.count; n++) {
      const t = world.typeOf(n);
      if (!t) continue;
      const cx = Math.floor(world.I[n] / CS), cy = Math.floor(world.J[n] / CS);
      const key = `${cx},${cy}`;
      if (!map.has(key)) map.set(key, new Chunk(cx, cy, main));
      const c = map.get(key);
      c.list.push(n);
      const [ei, ej] = world.extentOf(n);
      c.box.expandByPoint(lo.set(world.I[n] * S, world.K[n] * P, -(world.J[n] + ej) * S));
      c.box.expandByPoint(hi.set((world.I[n] + ei) * S, (world.K[n] + t.h) * P, -world.J[n] * S));
    }
    this.chunks = [...map.values()];
    for (const isl of islands) {
      const { id, cx, cy, origin, yawDeg } = isl.world.island;
      const parent = applyIslandPose(new THREE.Group(), origin, yawDeg);
      parent.name = `island ${id}`;
      this.group.add(parent);
      const src = { world: isl.world, ctx: isl.ctx, parent, island: isl.world.island };
      this.sources.push(src);
      const c = new Chunk(cx, cy, src);
      for (let n = 0; n < isl.world.count; n++) if (isl.world.typeOf(n)) c.list.push(n);
      c.box.copy(islandWorldBox(isl.world));
      this.chunks.push(c);
    }
    for (const c of this.chunks) c.list = Int32Array.from(c.list);
    this.setTier({ lod: false });
  }

  /**
   * { lod, nearDist (m), maxNear (chunks), studCap (studs), nearDetail 'full' | 'lite' }
   * (src/quality.js). lod false: every chunk near in the full look (no far meshes at all).
   */
  setTier({ lod = true, nearDist = Infinity, maxNear = Infinity, studCap = Infinity, nearDetail = 'full' }) {
    const lite = lod && nearDetail === 'lite';
    if (lod !== this.lod || lite !== this.lite) for (const c of this.chunks) this.freeNear(c);
    Object.assign(this, lod ? { nearDist, maxNear, studCap } : { nearDist: Infinity, maxNear: Infinity, studCap: Infinity });
    Object.assign(this, { lod, lite });
    if (lod && !this.clusters) this.buildFar();
    if (this.clusters) for (const g of this.farGroups) g.visible = lod;
  }

  buildNear(c) {
    const built = buildWorldMeshes(c.src.world, this.mats, { list: c.list, ctx: c.src.ctx, lite: this.lite });
    c.near = built;
    c.studMeshes = built.meshes.filter((m) => m.name.startsWith('stud|'));
    // with LOD the shadow map spans the whole town (~11 cm texels): stud shadows would not resolve
    if (this.lod) for (const m of c.studMeshes) m.castShadow = false;
    c.studs = built.studs;
    c.nearTris = 0; c.studTris = 0;
    for (const m of built.meshes) {
      if (m.name.startsWith('stud|')) c.studTris += meshTriangles(m); else c.nearTris += meshTriangles(m);
    }
    built.group.name = c.src.island ? `near island ${c.src.island.id}` : `near ${c.cx},${c.cy}`;
    c.src.parent.add(built.group);
  }

  freeNear(c) {
    if (!c.near) return;
    c.src.parent.remove(c.near.group);
    for (const m of c.near.meshes) {
      m.dispose();
      if (m.geometry.userData.owned) m.geometry.dispose();
    }
    c.near = null;
    c.studMeshes = [];
  }

  /** Far look of every chunk, merged per cluster and material (one cluster per island). */
  buildFar() {
    this.clusters = [];
    this.farGroups = [];
    this.farFaces = 0; this.farCulled = 0;
    for (const src of this.sources) {
      const byCluster = new Map();
      for (const c of this.chunks) {
        if (c.src !== src) continue;
        const k = src.island ? 'island' : `${Math.floor(c.cx / CLUSTER)},${Math.floor(c.cy / CLUSTER)}`;
        if (!byCluster.has(k)) byCluster.set(k, []);
        byCluster.get(k).push(c);
      }
      if (!byCluster.size) continue;
      const farGroup = new THREE.Group();
      farGroup.name = 'far';
      src.parent.add(farGroup);
      this.farGroups.push(farGroup);
      for (const chunks of byCluster.values()) this.buildCluster(src, chunks, farGroup);
    }
  }

  buildCluster({ world, ctx }, chunks, farGroup) {
    const { mats } = this;
    const col = new THREE.Color();
    const style = (n, part) => {
      const entry = part === 'glass' ? (ctx.glassEntry || world.palette.get(world.color[n])) : world.palette.get(world.color[n]);
      const { key } = mats.forEntry(entry);
      const exact = part === 'glass' || !!(world.rotFlags[n] & NO_VARIATION);
      const color = brickColor(entry, world.I[n], world.J[n], world.K[n], exact, col).clone();
      return { key, color, glow: key === 'glass' ? (ctx.glows.get(n) || BLACK) : null };
    };
    const code = ctx.grid ? ctx.grid.code : (I, J, K) => {
      const n = world.brickAt(I, J, K);
      return n < 0 ? 1 : ctx.codeOf(n);
    };
    const r = buildFarGeometry(world, chunks.map((c) => c.list), { code, codeOf: ctx.codeOf, style, glowKeys: new Set(['glass']) });
    chunks.forEach((c, s) => { c.farTris = r.segmentTriangles[s]; });
    this.farFaces += r.faces; this.farCulled += r.culled;
    const cl = { chunks, parts: [], sig: '' };
    for (const [key, geometry] of r.geometries) {
      const material = mats.farFor(key);
      const main = new THREE.Mesh(geometry, [material]); // drawn by groups: the far chunks only
      main.receiveShadow = true;
      main.castShadow = !material.transparent;
      main.name = `far|${key}`;
      farGroup.add(main);
      cl.parts.push({ main, ranges: r.ranges.get(key) });
    }
    this.clusters.push(cl);
  }

  /** Geometry groups for the far chunks of a cluster (one group per contiguous run). */
  refreshCluster(cl) {
    const sig = cl.chunks.map((c) => (c.isNear ? 1 : 0)).join('');
    if (sig === cl.sig) return;
    cl.sig = sig;
    for (const { main, ranges } of cl.parts) {
      const g = main.geometry;
      g.clearGroups();
      let run = null;
      cl.chunks.forEach((c, s) => {
        const r = ranges[s];
        if (c.isNear || !r.count) { run = null; return; }
        if (run && run.start + run.count === r.start) run.count += r.count;
        else { run = { start: r.start, count: r.count, materialIndex: 0 }; g.groups.push(run); }
      });
      main.visible = g.groups.length > 0;
    }
  }

  /**
   * Choose near/far per chunk for this camera. Builds at most one missing near look per call
   * unless `all` (screenshots, first frame). Returns true while near builds are pending.
   */
  update(camera, { all = false } = {}) {
    this.frame++;
    const p = camera.position;
    for (const c of this.chunks) c.dist = c.box.distanceToPoint(p);
    const order = [...this.chunks].sort((a, b) => a.dist - b.dist);
    const want = new Set();
    for (const c of order) {
      if (want.size >= this.maxNear) break;
      if (c.dist < (c.isNear ? this.nearDist * HYSTERESIS : this.nearDist)) want.add(c);
    }
    let built = 0, pending = false;
    for (const c of order) {
      if (want.has(c) && !c.near) {
        if (all || built === 0) { this.buildNear(c); built++; } else pending = true;
      }
      // without LOD there is no far look: a chunk waiting for its near look stays empty
      c.isNear = want.has(c) && !!c.near;
      if (c.near) { c.near.group.visible = c.isNear; if (c.isNear) c.used = this.frame; }
    }
    if (this.lod) for (const cl of this.clusters) this.refreshCluster(cl);
    // studs: nearest chunks first, until the cap (the closest chunk always keeps its studs)
    let studs = 0;
    for (const c of order) {
      if (!c.isNear) continue;
      const show = studs === 0 || studs + c.studs <= this.studCap;
      for (const m of c.studMeshes) m.visible = show;
      if (show) studs += c.studs;
    }
    this.studsShown = studs;
    // keep a few near looks around for when the camera comes back; free the rest
    const keep = Math.min(this.maxNear, 16) + 4;
    const cached = this.chunks.filter((c) => c.near && !c.isNear).sort((a, b) => b.used - a.used);
    for (const c of cached.slice(keep)) this.freeNear(c);
    return pending;
  }

  /** Build every near look the camera wants now (screenshots, first frame). */
  settle(camera) { this.update(camera, { all: true }); }

  /** Counts for the HUD and tools/perf.mjs (triangles of one geometry pass, before culling). */
  stats() {
    let near = 0, tris = 0;
    for (const c of this.chunks) {
      if (c.isNear) { near++; tris += c.nearTris + (c.studMeshes[0]?.visible ? c.studTris : 0); }
      else if (this.lod) tris += c.farTris;
    }
    return { chunks: this.chunks.length, clusters: this.clusters?.length ?? 0, near, studs: this.studsShown,
      triangles: tris, farFaces: this.farFaces, farCulled: this.farCulled };
  }
}
