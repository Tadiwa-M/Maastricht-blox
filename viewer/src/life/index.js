// City life for the web game: timetable buses, pedestrians and river boats, with zero
// servers. Entry point called from main.js at the `// [life hook]`:
//   import('./life/index.js').then((m) => m.initLife(ctx))
// ctx = { stage, camera, controls, city, models, ui, world, box, demo, quality, still }.
// Data: life/*.json from `blox life` (data.js); without it, walkers use the world's paved
// cells and the demo bus/boat (src/demo.js) stay. Guide: docs/guide/05-movers-and-models.md.
import * as THREE from 'three';
import { MaterialSet } from '../materials.js';
import { placeholderModels } from '../placeholders.js';
import { LifeClock, zonedWeekTime, parseDay } from './clock.js';
import { Timetable } from './schedule.js';
import { WalkGraph } from './walkgraph.js';
import { TimetableBuses } from './buses.js';
import { Pedestrians, WALKERS_BY_TIER } from './walkers.js';
import { Boats } from './boats.js';
import { makeGround, cityOf } from './ground.js';
import { loadLifeData } from './data.js';
import { walkwaysFromWorld } from './fallback.js';
import { bindLifeUI } from './ui.js';

/** Keep only walk-graph nodes inside rect [x0, z0, x1, z1] (Unity metres). */
export function clipWalkways(doc, rect) {
  if (!rect) return doc;
  const [x0, z0, x1, z1] = rect, map = new Map(), nodes = [], weights = [], edges = [];
  for (let q = 0; q < doc.nodes.length / 2; q++) {
    const x = doc.nodes[2 * q], z = doc.nodes[2 * q + 1];
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    map.set(q, nodes.length / 2);
    nodes.push(x, z); weights.push(doc.weights?.[q] ?? 1);
  }
  for (let q = 0; q < doc.edges.length; q += 2) {
    const a = map.get(doc.edges[q]), b = map.get(doc.edges[q + 1]);
    if (a !== undefined && b !== undefined) edges.push(a, b);
  }
  return { ...doc, nodes, weights, edges };
}

/** Initial clock from the URL (#t=16.5&day=sat) or real Maastricht time. */
export function initialClock(hash = typeof location !== 'undefined' ? location.hash : '', now = new Date()) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const real = zonedWeekTime(now);
  const day = parseDay(p.get('day')) ?? real.day;
  const fixed = p.has('t');
  const sec = fixed ? Math.round(+p.get('t') * 3600) : real.sec;
  const speed = [1, 10, 60].includes(+p.get('speed')) ? +p.get('speed') : 1;
  return { clock: new LifeClock({ day, sec, speed }), fixed };
}

/** Unity y of the water surface: water tops along the river in the world, else 44.1 m NAP. */
function waterLevel(world, river, ctx) {
  if (world?.topK && river) {
    const S = world.studM, P = world.plateM, ys = [];
    for (let q = 0; q < river.path.length; q += 2) {
      const I = Math.floor(river.path[q] / S), J = Math.floor(river.path[q + 1] / S);
      const n = world.brickAt(I, J, world.topK(I, J) - 1);
      if (n >= 0 && /^water/.test(world.palette.get(world.color[n])?.name || '')) ys.push(world.topK(I, J) * P);
    }
    if (ys.length) return ys.sort((a, b) => a - b)[ys.length >> 1];
  }
  const city = cityOf(ctx);
  if (city?.groundHeight && river?.path?.length >= 2) {
    const y = city.groundHeight(river.path[0], -river.path[1]); // city.js uses three.js z = -north
    if (Number.isFinite(y)) return y;
  }
  return 44.1 - 30.0;
}

export async function initLife(ctx) {
  const state = { ready: false, buses: null, walkers: null, boats: null, clock: null, source: null };
  if (typeof window !== 'undefined') window.__bloxLife = state;
  const { stage, world } = ctx;
  const camera = ctx.camera || stage.camera;
  const box = ctx.box || null;
  const planes = box ? [new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z), new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z)] : null;
  const mats = new MaterialSet({ clippingPlanes: planes });
  const ph = placeholderModels();
  const models = { bus: ctx.models?.bus || ph.bus, boat: ctx.models?.boat || ph.boat, character: ctx.models?.character || ph.walker_a };
  const opts = { palette: world.palette, types: world.types, mats, studM: world.studM, plateM: world.plateM };
  const ground = makeGround(ctx, world);
  const group = new THREE.Group();
  group.name = 'life';
  stage.scene.add(group);
  const rect = box ? [box.min.x, -box.max.z, box.max.x, -box.min.z] : null; // three box -> Unity x/z

  const data = await loadLifeData(ctx);
  state.source = data ? 'export' : 'world';
  const { clock, fixed } = initialClock();
  state.clock = clock;
  const tier = () => (typeof ctx.quality === 'function' ? ctx.quality() : 'medium');
  const hideDemo = (name) => { for (const a of ctx.demo?.actors || []) if (a.obj.userData.model?.name === name || a.obj.name === `model:${name}`) a.obj.visible = false; };

  if (data?.transit?.trips?.length) {
    state.buses = new TimetableBuses({ timetable: new Timetable(data.transit), model: models.bus, opts, ground });
    group.add(state.buses.group);
    hideDemo('bus');
  }
  let walkDoc = data?.walkways || null;
  if (!walkDoc && world.topK) walkDoc = walkwaysFromWorld(world);
  if (walkDoc) {
    const graph = new WalkGraph(clipWalkways(walkDoc, rect));
    if (graph.buckets.size) {
      state.walkers = new Pedestrians({ graph, model: models.character, opts, ground });
      group.add(state.walkers.group);
      hideDemo(models.character.name);
    }
  }
  if (data?.river?.path?.length >= 4) {
    state.boats = new Boats({ river: data.river, model: models.boat, opts, waterY: waterLevel(world, data.river, ctx) });
    for (const b of state.boats.items) group.add(b.obj);
    if (state.boats.items.length) hideDemo('boat');
  }

  const still = !!ctx.still;
  const ui = bindLifeUI(clock, {
    still,
    onNow: () => { const r = zonedWeekTime(); clock.set(r.day, r.sec); },
  });
  const target = () => {
    const t = ctx.controls?.target || new THREE.Vector3();
    return [t.x, -t.z];
  };
  const livingRadius = () => {
    const t = ctx.controls?.target, h = t ? camera.position.distanceTo(t) : 100;
    return Math.max(50, Math.min(220, h * 1.1));
  };
  let night = -1, last = performance.now(), statT = 0;
  function step(dt) {
    if (stage.night !== undefined && stage.night !== night) { night = stage.night; mats.setNight(night); }
    clock.advance(dt);
    const animOn = typeof document === 'undefined' || document.getElementById('anim')?.checked !== false;
    if (state.buses) state.buses.update(clock, camera);
    if (state.walkers) {
      state.walkers.setCount(WALKERS_BY_TIER[tier()] ?? WALKERS_BY_TIER.medium, target());
      state.walkers.update(animOn ? dt : 0, target(), livingRadius());
    }
    if (state.boats) state.boats.update(animOn ? dt : 0);
    ui.update();
  }
  // a shot is one still frame: everything placed once at the URL's time
  step(0);
  if (state.walkers) for (let q = 0; q < 3; q++) state.walkers.update(0.4, target(), livingRadius()); // spread the walk cycles
  state.ready = true;
  if (still) return state;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const anim = document.getElementById('anim')?.checked !== false;
    step(anim ? dt : 0);
    if ((statT += dt) > 0.5) {
      statT = 0;
      const b = state.buses?.stats;
      ui.stats([b ? `${b.active} buses (${b.full} near)` : 'demo bus', `${state.walkers?.count || 0} walkers`,
        `${state.boats?.items.length || 0} boats`, state.source === 'export' ? 'timetable' : 'no life export'].join(' · '));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return state;
}
