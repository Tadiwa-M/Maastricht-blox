// Locomotion demo: a bus loops along the road, a boat cruises the river, two figures stroll
// on the square. Everything is found from the world data (no hard-coded coordinates):
// the road is the widest run of asphalt tops, the river the run of water tops, and the
// walking loop the largest clear rectangle near a cafe (or on the square).
//
// Models are cut by clipping planes at the diorama edge, so the bus can turn around
// out of sight and come back on the other lane, like a cut-away model railway.
import * as THREE from 'three';
import { MaterialSet } from './materials.js';
import { buildModel } from './models.js';
import { PathMover, WalkCycle, WheelSpin, poseToObject } from './mover.js';
import { placeholderModels } from './placeholders.js';

const OFF_PLATE = 18; // metres the loops extend past the edge (longer than the bus)

/** Name of the palette entry on top of column (I, J). */
function topName(world, I, J) {
  const K = world.topK(I, J) - 1;
  const n = world.brickAt(I, J, K);
  return n < 0 ? '' : world.palette.get(world.color[n])?.name || '';
}

/** Longest run [J0, J1] (inclusive) of columns at I whose top colour matches test. */
function longestRun(world, I, test) {
  let best = null, start = null;
  const { J0, J1 } = world.bounds;
  for (let J = J0; J <= J1; J++) {
    const ok = J < J1 && test(topName(world, I, J));
    if (ok && start === null) start = J;
    if (!ok && start !== null) {
      if (!best || J - 1 - start > best[1] - best[0]) best = [start, J - 1];
      start = null;
    }
  }
  return best;
}

/** Largest rectangle loop (cells) whose path stays on flat, empty ground. */
function clearLoop(world, area, groundK) {
  const flat = (I, J) => world.topK(I, J) === groundK;
  const ringOk = (I0, J0, I1, J1) => {
    for (let I = I0 - 1; I <= I1 + 1; I++) for (const J of [J0 - 1, J0, J0 + 1, J1 - 1, J1, J1 + 1]) if (!flat(I, J)) return false;
    for (let J = J0 - 1; J <= J1 + 1; J++) for (const I of [I0 - 1, I0, I0 + 1, I1 - 1, I1, I1 + 1]) if (!flat(I, J)) return false;
    return true;
  };
  let best = null;
  for (let I0 = area[0]; I0 <= area[2]; I0 += 2)
    for (let J0 = area[1]; J0 <= area[3]; J0 += 2)
      for (let s = 24; s >= 8; s -= 4) {
        const I1 = I0 + s, J1 = J0 + Math.round(s * 0.6);
        if (I1 > area[2] || J1 > area[3]) continue;
        if (best && s <= best.s) break;
        if (ringOk(I0, J0, I1, J1)) { best = { s, rect: [I0, J0, I1, J1] }; break; }
      }
  return best?.rect || null;
}

function pickModels(json) {
  const ph = placeholderModels();
  const all = { ...(json || {}) };
  const walkers = Object.keys(all).filter((n) => /walk|person|figure|character|pedestrian|people/i.test(n));
  return {
    bus: all.bus || ph.bus,
    boat: all.boat || ph.boat,
    walkers: walkers.length ? walkers.map((n) => all[n]) : [ph.walker_a, ph.walker_b],
    placeholder: !all.bus || !all.boat || !walkers.length,
  };
}

/** Builds the actors. Returns { group, update(dt), actors }. */
export function setupDemo(world, box, modelJson) {
  const S = world.studM, P = world.plateM;
  const planes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z), new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z)];
  const mats = new MaterialSet({ clippingPlanes: planes });
  const models = pickModels(modelJson);
  const opts = { palette: world.palette, types: world.types, mats, studM: S, plateM: P };
  const group = new THREE.Group();
  group.name = 'demo';
  const actors = [];
  const { I0, I1, J0, J1 } = world.bounds;
  const midI = Math.floor((I0 + I1) / 2);
  const xW = I0 * S - OFF_PLATE, xE = I1 * S + OFF_PLATE, xMid = (I0 + I1) * S / 2;
  const add = (json, mover, walk) => {
    const obj = buildModel(json, opts);
    group.add(obj);
    const parts = obj.userData.parts, model = obj.userData.model;
    const wheelRadius = (name) => (model.parts[name].pivot[2] - (model.pivot?.[2] || 0)) * P; // hub height
    actors.push({ obj, mover, walk: walk ? new WalkCycle(parts) : null, wheels: new WheelSpin(parts, wheelRadius) });
  };

  const road = longestRun(world, midI, (n) => n === 'asphalt');
  if (road) { // drive on the right: eastbound on the south lane, westbound on the north lane
    const w = road[1] - road[0] + 1;
    const zE = (road[0] + w * 0.3) * S, zWst = (road[0] + w * 0.72) * S;
    const y = world.topK(midI, road[0] + (w >> 1)) * P;
    const path = [[xW, y, zE], [xE, y, zE], [xE, y, zWst], [xW, y, zWst]];
    add(models.bus, new PathMover({ path, speed: 4, turnRadius: 3, start: xMid - xW - 6 }));
  }
  const river = longestRun(world, midI, (n) => /^water/.test(n));
  if (river) {
    const zc = (river[0] + river[1] + 1) / 2 * S;
    const y = world.topK(midI, river[0] + 1) * P; // boat pivot = its waterline
    add(models.boat, new PathMover({ path: [[xE, y, zc], [xW, y, zc]], speed: 1.6, turnRadius: 4, start: (xE - xMid) - 5 }));
  }
  const cafe = [...world.features.values()].find((f) => /caf/i.test(f.name || '') && f.bboxIJ);
  const square = [...world.features.values()].filter((f) => f.kind === 'street' && f.bboxIJ)
    .sort((a, b) => (b.bboxIJ[2] - b.bboxIJ[0]) * (b.bboxIJ[3] - b.bboxIJ[1]) - (a.bboxIJ[2] - a.bboxIJ[0]) * (a.bboxIJ[3] - a.bboxIJ[1]))[0];
  const area = cafe ? [cafe.bboxIJ[0] - 10, cafe.bboxIJ[1] - 10, cafe.bboxIJ[2] + 10, cafe.bboxIJ[3] + 10]
    : square ? square.bboxIJ : [I0 + 2, J0 + 2, I1 - 3, J1 - 3];
  const rect = clearLoop(world, area.map((v, q) => Math.max([I0 + 1, J0 + 1, I0 + 1, J0 + 1][q], Math.min([I1 - 2, J1 - 2, I1 - 2, J1 - 2][q], v))), world.groundK);
  if (rect) {
    const y = world.groundK * P;
    const [a, b, c, d] = rect.map((v) => (v + 0.5) * S);
    const loop = [[a, y, b], [c, y, b], [c, y, d], [a, y, d]];
    add(models.walkers[0], new PathMover({ path: loop, speed: 0.9, turnRadius: 0.6, start: 1 }), true);
    const back = [...loop].reverse();
    add(models.walkers[1 % models.walkers.length], new PathMover({ path: back, speed: 0.75, turnRadius: 0.6, start: (c - a) + 2 }), true);
  }

  function update(dt) {
    mats.update(performance.now() / 1000);
    for (const a of actors) {
      const { pose, travelled } = a.mover.update(dt);
      poseToObject(pose, a.obj);
      a.walk?.update(travelled, dt > 0 ? travelled / dt : 0);
      a.wheels.update(travelled);
    }
  }
  update(0);
  return { group, update, actors, mats, placeholder: models.placeholder, paths: { road, river, rect } };
}
