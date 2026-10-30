// Timetable buses: every trip under way at the life clock, placed on its GTFS shape.
//
// Pose: the shared PathMover rule (src/mover.js: heading = rear -> front axle over
// turnRadius, yaw clockwise from north), shifted LANE_M to the right of the shape so the two
// directions of a street use their own lane. LOD (lodpick.js): the nearest `full` buses are
// instanced brick models (contract/models/bus.json, body in the operator's livery (livery.js),
// wheels rolling with distance, route number sign on the nose and roof); farther ones are
// coloured boxes; beyond farDist they are hidden.
import * as THREE from 'three';
import { PathMover } from '../mover.js';
import { InstancedModel } from './instancer.js';
import { assignLod } from './lodpick.js';
import { liveryFor } from './livery.js';

export const LANE_M = 1.6;
const SIGNS = 8;
// palette indices a bus body may take (nearest to the route colour): reds, blues, greens, yellows, white, greys
const BODY_COLOURS = [38, 16, 4, 21, 44, 20, 41, 42, 37, 43, 8, 10, 45];

/** PathMover over a shape with exported cumulative distances (not re-measured). */
export function shapeMover(shape, turnRadius = 6) {
  const m = new PathMover({ path: shape.pts, loop: false, turnRadius, speed: 0 });
  m.cum = shape.cum.map((d) => d - shape.d0);
  m.length = m.cum[m.cum.length - 1];
  return m;
}

/** Nearest palette index to a '#rrggbb' colour among `candidates`. */
export function nearestPalette(palette, hex, candidates) {
  const c = new THREE.Color(hex);
  let best = candidates[0], bd = Infinity;
  for (const idx of candidates) {
    const e = palette.get(idx);
    if (!e?.srgb) continue;
    const p = new THREE.Color(e.srgb);
    const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
    if (d < bd) { bd = d; best = idx; }
  }
  return best;
}

function signTexture(text, colour) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#111'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = colour; g.fillRect(4, 4, 120, 56);
  g.fillStyle = '#fff'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 4), 64, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TimetableBuses {
  /**
   * timetable: Timetable. model: bus model JSON. opts: { palette, types, mats, studM, plateM }.
   * ground(x, z) -> y. caps: { full, box, fullDist, farDist }.
   */
  constructor({ timetable, model, opts, ground, caps = {}, modes = null, laneM = LANE_M }) {
    this.tt = timetable;
    this.modes = modes; // e.g. ['bus'] or ['rail']: one fleet per vehicle model; null = all
    this.laneM = laneM; // buses keep right of the shape's centre line; trains run on it
    this.ground = ground;
    this.caps = { full: 24, box: 300, fullDist: 180, farDist: 900, ...caps };
    this.palette = opts.palette;
    this.clip = opts.mats.clippingPlanes || null;
    this.group = new THREE.Group();
    this.group.name = 'life:buses';
    this.full = new InstancedModel(model, opts, this.caps.full);
    this.group.add(this.full.group);
    const L = model.size[1] * opts.studM, W = model.size[0] * opts.studM, H = model.size[2] * opts.plateM;
    const boxGeo = new THREE.BoxGeometry(W, H, L).translate(0, H / 2, 0);
    this.boxes = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, clippingPlanes: this.clip }), this.caps.box);
    this.boxes.count = 0; this.boxes.frustumCulled = false; this.boxes.castShadow = true;
    this.group.add(this.boxes);
    this.movers = new Map();
    this.wheelR = Object.fromEntries(Object.entries(model.parts || {}).filter(([n]) => n.startsWith('wheel'))
      .map(([n, p]) => [n, Math.max(0.05, (p.pivot[2] - (model.pivot?.[2] || 0)) * opts.plateM)]));
    this.bodyIdx = BODY_COLOURS.filter((i) => opts.palette.has(i));
    this.slotRoute = new Array(this.caps.full).fill(null);
    this.signMats = new Map();
    this.signs = [];
    if (typeof document !== 'undefined') {
      for (let q = 0; q < SIGNS; q++) {
        const g = new THREE.Group();
        const front = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.6));
        front.position.set(0, H - 0.45, -L / 2 - 0.03);
        front.rotation.set(0, Math.PI, 0); // a plane faces +z; the bus front is -z
        const roof = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0));
        roof.position.set(0, H + 0.22, -L / 4);
        roof.rotation.set(-Math.PI / 2, 0, 0);
        g.add(front, roof);
        g.visible = false;
        this.group.add(g);
        this.signs.push(g);
      }
    }
    this.stats = { active: 0, full: 0, box: 0, hidden: 0 };
    this.color = new THREE.Color();
  }

  /** One sign material per route (number on the route colour). */
  signMaterial(route) {
    const key = `${route.short}|${route.colour}`;
    if (!this.signMats.has(key)) {
      const map = signTexture(String(route.short ?? ''), route.colour || '#C8102E');
      this.signMats.set(key, new THREE.MeshBasicMaterial({ map, clippingPlanes: this.clip }));
    }
    return this.signMats.get(key);
  }

  mover(shape) {
    if (!this.movers.has(shape)) this.movers.set(shape, shapeMover(shape));
    return this.movers.get(shape);
  }

  /** Poses of the trips active at the clock: [{ x, y, z (Unity metres), yaw, dist, route, id }]. */
  poses(clock) {
    const list = this.tt.activeAt(clock.day, clock.sec).filter((a) => !this.modes || this.modes.includes(a.route?.mode || 'bus'));
    return list.map((a) => {
      const pose = this.mover(a.shape).poseAt(a.dist - a.shape.d0);
      const r = (pose.yaw * Math.PI) / 180;
      const x = pose.position[0] + Math.cos(r) * this.laneM, z = pose.position[2] - Math.sin(r) * this.laneM;
      return { x, y: this.ground(x, z), z, yaw: pose.yaw, dist: a.dist, route: a.route, id: a.id,
        trip: a.trip, pattern: a.pattern, tRel: a.tRel, mode: a.route?.mode || 'bus' };
    });
  }

  /** Body colour of a route's buses: the operator's livery (livery.js; Arriva blue in Maastricht). */
  routeColour(route) {
    if (route._body === undefined) route._body = new THREE.Color(liveryFor(route));
    return route._body;
  }

  /** camera: THREE.Camera (three.js space). Returns the poses. */
  update(clock, camera) {
    const all = this.poses(clock);
    // the vehicle being ridden is not drawn (the passenger sees ride/cabin.js instead)
    const list = this.hideId ? all.filter((b) => b.id !== this.hideId) : all;
    const cp = camera.position;
    const dist = list.map((b) => Math.hypot(b.x - cp.x, b.y - cp.y, -b.z - cp.z));
    const lod = assignLod(dist, { fullDist: this.caps.fullDist, farDist: this.caps.farDist,
      fullCap: this.caps.full, boxCap: this.caps.box });
    lod.full.forEach((q, slot) => {
      const b = list[q];
      if (this.slotRoute[slot] !== b.route) {
        this.slotRoute[slot] = b.route;
        this.full.setColors(slot, { 38: b.route ? this.routeColour(b.route) : new THREE.Color(liveryFor(null)) });
      }
      const angles = {};
      for (const [n, r] of Object.entries(this.wheelR)) angles[n] = -b.dist / r;
      this.full.setPose(slot, b.x, b.y, -b.z, (-b.yaw * Math.PI) / 180, angles);
    });
    this.full.setCount(lod.full.length);
    this.full.commit();
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    lod.box.forEach((q, n) => {
      const b = list[q];
      m.compose(at.set(b.x, b.y, -b.z), qt.setFromAxisAngle(up, (-b.yaw * Math.PI) / 180), one);
      this.boxes.setMatrixAt(n, m);
      this.boxes.setColorAt(n, b.route ? this.routeColour(b.route) : this.color.set(liveryFor(null)));
    });
    this.boxes.count = lod.box.length;
    this.boxes.instanceMatrix.needsUpdate = true;
    if (this.boxes.instanceColor) this.boxes.instanceColor.needsUpdate = true;
    this.signs.forEach((g, n) => {
      const q = lod.full[n];
      g.visible = q !== undefined;
      if (!g.visible) return;
      const b = list[q];
      g.position.set(b.x, b.y, -b.z);
      g.rotation.set(0, (-b.yaw * Math.PI) / 180, 0);
      const mat = this.signMaterial(b.route || { short: '', colour: '#C8102E' });
      for (const c of g.children) c.material = mat;
    });
    this.stats = { active: all.length, full: lod.full.length, box: lod.box.length, hidden: lod.hidden };
    return all;
  }
}
