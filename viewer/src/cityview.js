// What the streamed city looks like on screen. Three rings around the camera:
//   near   full look (src/bricks.js: bevelled instanced bricks, studs) for the closest few
//          items, built on the main thread from the item's records, one per frame
//   mid    every streamed chunk and island in the city far look (src/prepare.js output, one
//          mesh per family, hidden faces culled within the item), built in a worker
//   far    the baked regions (src/farregion.js) for everything else; a baked chunk is hidden
//          once its streamed chunk and every island it owns are on screen
// Islands hang under a group at their pose (src/island.js), exactly as in src/lod.js.
import * as THREE from 'three';
import { buildWorldMeshes, worldContext } from './bricks.js';
import { arraysToGeometry, releaseAfterUpload } from './farmesh.js';
import { applyIslandPose, worldToLocalThree } from './island.js';
import { worldFromRecords } from './prepare.js';
import { pickNearest } from './picking.js';
import { boxDistance, READY } from './stream.js';

const HYSTERESIS = 1.3;

export class CityView {
  /** meta: { palette, catalogue, manifest } as JSON; index: stream index; far: FarRegions. */
  constructor({ meta, index, mats, loader, far }) {
    Object.assign(this, { meta, index, mats, loader, far });
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.group.add(far.group);
    this.views = new Map(); // item key -> view
    this.coverDirty = true;
    this.frame = 0;
    this.studsShown = 0;
    this.tier = { nearDist: 40, maxNear: 3, studCap: 20000, nearDetail: 'lite', nearTriCap: 2.5e6 };
    // islands owned per chunk (baked faces of an island belong to its owning chunk)
    this.owned = new Map();
    for (const i of index.islands) {
      const k = `${i.cx},${i.cy}`;
      if (!this.owned.has(k)) this.owned.set(k, []);
      this.owned.get(k).push(`i${i.id}`);
    }
    far.covered = (cx, cy) => this.covered(cx, cy);
    loader.onReady = (it) => this.add(it);
    loader.onUnload = (it, payload) => this.remove(it, payload);
  }

  covered(cx, cy) {
    const c = this.loader.sched.get(`c${cx},${cy}`);
    if (c && c.state !== READY) return false;
    for (const key of this.owned.get(`${cx},${cy}`) || []) if (this.loader.sched.get(key)?.state !== READY) return false;
    return true;
  }

  setTier({ nearDist = 40, maxNear = 3, studCap = 20000, nearDetail = 'lite', nearTriCap = Infinity }) {
    const changed = nearDetail !== this.tier.nearDetail;
    this.tier = { nearDist, maxNear, studCap, nearDetail, nearTriCap };
    if (changed) for (const v of this.views.values()) this.freeNear(v);
  }

  add(it) {
    const p = it.payload;
    const parent = new THREE.Group();
    parent.name = it.key;
    if (it.kind === 'island') applyIslandPose(parent, [p.header.originX, p.header.originZ], p.header.yawDeg);
    const view = { it, parent, mid: [], near: null, studMeshes: [], studs: 0, used: 0, isNear: false, world: null, triangles: p.triangles || 0,
      box: new THREE.Box3(new THREE.Vector3().copy(it.box.min), new THREE.Vector3().copy(it.box.max)) };
    for (const [fam, arrays] of Object.entries(p.far || {})) {
      const mat = this.mats.cityFar(fam);
      const mesh = new THREE.Mesh(releaseAfterUpload(arraysToGeometry(arrays)), mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      mesh.name = `mid|${fam}`;
      parent.add(mesh);
      view.mid.push(mesh);
    }
    delete p.far; // the arrays live in the geometry now (and leave the CPU after upload)
    parent.updateMatrixWorld(true);
    this.group.add(parent);
    this.views.set(it.key, view);
    this.coverDirty = true;
  }

  remove(it) {
    const v = this.views.get(it.key);
    if (!v) return;
    this.freeNear(v);
    for (const m of v.mid) m.geometry.dispose();
    this.group.remove(v.parent);
    this.views.delete(it.key);
    this.coverDirty = true;
  }

  /** World of a streamed item (built on demand: near look, picking). */
  worldOf(v) {
    if (!v.world) {
      const p = v.it.payload;
      v.world = worldFromRecords(this.meta, v.it.kind, p.header, p.records);
    }
    return v.world;
  }

  buildNear(v) {
    const world = this.worldOf(v);
    v.ctx ||= worldContext(world, this.mats);
    const built = buildWorldMeshes(world, this.mats, { ctx: v.ctx, lite: this.tier.nearDetail === 'lite' });
    v.near = built;
    v.studMeshes = built.meshes.filter((m) => m.name.startsWith('stud|'));
    for (const m of v.studMeshes) m.castShadow = false;
    v.studs = built.studs;
    v.nearTris = 0;
    for (const m of built.meshes) {
      const g = m.geometry;
      v.nearTris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (m.isInstancedMesh ? m.count : 1);
    }
    v.parent.add(built.group);
  }

  freeNear(v) {
    if (!v.near) return;
    v.parent.remove(v.near.group);
    for (const m of v.near.meshes) { m.dispose(); if (m.geometry.userData.owned) m.geometry.dispose(); }
    v.near = null;
    v.studMeshes = [];
    v.isNear = false;
    for (const m of v.mid) m.visible = true;
  }

  /** Per frame. all: build every wanted near look now (screenshots). */
  update(camera, { all = false } = {}) {
    this.frame++;
    const eye = camera.position;
    const views = [...this.views.values()];
    for (const v of views) v.dist = boxDistance(v.box, eye);
    views.sort((a, b) => a.dist - b.dist);
    const { nearDist, maxNear, studCap, nearTriCap } = this.tier;
    const want = new Set();
    let budget = nearTriCap;
    for (const v of views) {
      if (want.size >= maxNear) break;
      if (!(v.dist < (v.isNear ? nearDist * HYSTERESIS : nearDist))) continue;
      // near cost ~ 25x the mid look (lite bevels); the closest item is always allowed
      const cost = v.nearTris ?? v.triangles * 25;
      if (want.size && cost > budget) continue;
      budget -= cost;
      want.add(v);
    }
    let built = 0, pending = false;
    for (const v of views) {
      if (want.has(v) && !v.near) {
        if (all || built === 0) { this.buildNear(v); built++; } else pending = true;
      }
      v.isNear = want.has(v) && !!v.near;
      if (v.near) { v.near.group.visible = v.isNear; if (v.isNear) v.used = this.frame; }
      for (const m of v.mid) m.visible = !v.isNear;
    }
    let studs = 0;
    for (const v of views) {
      if (!v.isNear) continue;
      const show = studs === 0 || studs + v.studs <= studCap;
      for (const m of v.studMeshes) m.visible = show;
      if (show) studs += v.studs;
    }
    this.studsShown = studs;
    const cached = views.filter((v) => v.near && !v.isNear).sort((a, b) => b.used - a.used);
    for (const v of cached.slice(maxNear + 4)) { this.freeNear(v); v.world = null; v.ctx = null; }
    // keep the World (cell map) of near items only: it is the biggest per-item structure
    for (const v of views) if (!v.near && v.world && v.dist > nearDist * 3) { v.world = null; v.ctx = null; }
    this.far.update(eye, this.coverDirty);
    this.coverDirty = false;
    return pending;
  }

  settled() { return this.loader.settled() && this.far.settled(); }

  stats() {
    let near = 0, mid = 0, nearTris = 0, midTris = 0;
    for (const v of this.views.values()) {
      if (v.isNear) { near++; nearTris += v.nearTris; } else { mid++; midTris += v.triangles; }
    }
    const { triangles: farTris = 0, ...far } = this.far.stats();
    // triangles: one geometry pass before frustum culling (near counts include hidden studs)
    return { near, mid, studs: this.studsShown, nearTris, midTris, farTris, triangles: nearTris + midTris + farTris, ...far };
  }

  /**
   * Nearest brick under a ray (three.js origin/direction) over the streamed items the ray
   * crosses. Returns { hit, world, view } or null. Worlds are built on demand (cell maps).
   */
  pick(ray) {
    const cands = [];
    const hitPt = new THREE.Vector3();
    for (const v of this.views.values()) {
      if (!v.it.payload?.records) continue;
      const p = ray.intersectBox(v.box, hitPt);
      if (p) cands.push({ v, d: p.distanceTo(ray.origin) });
    }
    cands.sort((a, b) => a.d - b.d);
    let best = null;
    for (const { v, d } of cands.slice(0, 12)) {
      if (best && d > best.distance) break;
      const w = this.worldOf(v);
      const target = { world: w, parent: v.it.kind === 'island' ? v.parent : this.group, view: v,
        toLocal: v.it.kind === 'island' ? (pt, dir) => worldToLocalThree(w.island, pt, dir) : null };
      const hit = pickNearest([target], ray.origin, ray.direction);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
}
