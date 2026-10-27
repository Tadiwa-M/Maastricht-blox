// City life for the web game: timetable buses, pedestrians, cyclists, cars, cafe terraces,
// the market and river boats, with zero servers. People, bikes, cars and props are smooth toy
// figures (src/figure/) in one shared set of instanced meshes (~45 draw calls in all). Entry point, called once from main.js initHooks (the `// [life hook]`):
//   const hook = await initLife(ctx); hook.update(dt) every frame before drawing
// ctx = { stage, camera, controls, city, models, ui, world, islands, box, demo, quality, still }.
// Data: life/*.json from `blox life` (data.js); without it, walkers use the world's paved
// cells and the demo bus/boat (src/demo.js) stay. Guide: docs/guide/05-movers-and-models.md.
import * as THREE from 'three';
import { MaterialSet } from '../materials.js';
import { placeholderModels } from '../placeholders.js';
import { LifeClock, zonedWeekTime, parseDay } from './clock.js';
import { Timetable } from './schedule.js';
import { WalkGraph } from './walkgraph.js';
import { TimetableBuses } from './buses.js';
import { Pedestrians } from './walkers.js';
import { Cyclists, parkedBikes } from './cyclists.js';
import { Cars } from './cars.js';
import { Terraces } from './terraces.js';
import { Market } from './market.js';
import { FIGURES_BY_TIER, CYCLISTS_BY_TIER, CARS_BY_TIER, PARKED_BIKES_BY_TIER, nearestWithin, crowdFactor, trafficFactor, liveWeights, marketState } from './density.js';
import { FigureCrowd } from '../figure/crowd.js';
import { VehicleFleet } from '../figure/vehicles.js';
import { PropSet } from '../figure/props.js';
import { figureMaterial } from '../figure/parts.js';
import { Boats } from './boats.js';
import { makeGround, cityOf } from './ground.js';
import { loadLifeData } from './data.js';
import { walkwaysFromWorld, islandBlocker } from './fallback.js';
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

/** Keep only road-graph nodes inside rect (edges with both ends inside). */
export function clipRoads(doc, rect) {
  if (!rect) return doc;
  const [x0, z0, x1, z1] = rect, map = new Map(), nodes = [], edges = [], flags = [];
  for (let q = 0; q < doc.nodes.length / 2; q++) {
    const x = doc.nodes[2 * q], z = doc.nodes[2 * q + 1];
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    map.set(q, nodes.length / 2);
    nodes.push(x, z);
  }
  for (let q = 0; q < doc.flags.length; q++) {
    const a = map.get(doc.edges[2 * q]), b = map.get(doc.edges[2 * q + 1]);
    if (a !== undefined && b !== undefined) { edges.push(a, b); flags.push(doc.flags[q]); }
  }
  return { ...doc, nodes, edges, flags };
}

const inRect = (pois, rect) => (rect ? pois.filter((p) => p.x > rect[0] && p.x < rect[2] && p.z > rect[1] && p.z < rect[3]) : pois);

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
  if (world?.count > 0 && river) {
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

const LIFE_VIEW_M = 650; // camera farther than this from its target: no people or vehicles drawn
const FIGURE_CULL_M = 320; // single figures farther than this from the camera are skipped

/** Returns { update(dt) } for the render loop (main.js initHooks). */
export async function initLife(ctx) {
  const state = { ready: false, buses: null, walkers: null, cyclists: null, cars: null, terraces: null, market: null,
    boats: null, clock: null, source: null, crowd: null, fleet: null, props: null };
  if (typeof window !== 'undefined') window.__bloxLife = state;
  const { stage, world } = ctx;
  const camera = ctx.camera || stage.camera;
  const box = ctx.box || null;
  const planes = box ? [new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z), new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z)] : null;
  const mats = new MaterialSet({ clippingPlanes: planes });
  const ph = placeholderModels();
  const models = { bus: ctx.models?.bus || ph.bus, boat: ctx.models?.boat || ph.boat, character: ctx.models?.character || ph.walker_a };
  const toyMat = figureMaterial({ clippingPlanes: planes });
  const capOf = (t) => t.high;
  const crowd = new FigureCrowd(capOf(FIGURES_BY_TIER) + 900, { material: toyMat }); // walkers + riders + seated + market
  const fleet = new VehicleFleet({ bikes: capOf(CYCLISTS_BY_TIER) + 500, cars: capOf(CARS_BY_TIER) + 10, material: toyMat });
  const props = new PropSet({ material: toyMat });
  Object.assign(state, { crowd, fleet, props });
  const opts = { palette: world.palette, types: world.types, mats, studM: world.studM, plateM: world.plateM };
  const ground = makeGround(ctx, world);
  const group = new THREE.Group();
  group.name = 'life';
  stage.scene.add(group);
  group.add(crowd.group, fleet.group, props.group);
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
  if (!walkDoc && world.count > 0) walkDoc = walkwaysFromWorld(world, { blocked: islandBlocker(ctx.islands) });
  let walkGraph = null;
  if (walkDoc) {
    const graph = new WalkGraph(clipWalkways(walkDoc, rect));
    if (graph.buckets.size) {
      walkGraph = graph;
      state.walkers = new Pedestrians({ graph, ground, cap: FIGURES_BY_TIER.high });
      hideDemo(models.character.name);
    }
  }
  const streets = data?.streets || null;
  if (streets?.cycle?.edges?.length) {
    const graph = new WalkGraph(clipWalkways(streets.cycle, rect));
    if (graph.buckets.size) state.cyclists = new Cyclists({ graph, ground, cap: CYCLISTS_BY_TIER.high });
  }
  if (streets?.roads?.edges?.length) state.cars = new Cars({ doc: clipRoads(streets.roads, rect), ground, cap: CARS_BY_TIER.high });
  if (streets?.pois?.length) state.terraces = new Terraces({ pois: inRect(streets.pois, rect), ground });
  if (streets?.market?.poly?.length >= 6) {
    const near = walkGraph ? (x, z) => walkGraph.spawnNear(x, z, 4, () => 0.5) >= 0 : () => true;
    state.market = new Market({ market: streets.market, ground, keep: near });
  }
  const parked = parkedBikes((streets?.bikes || []).filter(([x, z]) => !rect || (x > rect[0] && x < rect[2] && z > rect[1] && z < rect[3])));
  let marketWas = null;
  /** Spawn weights for the moment: busy squares by day, the market square when it is on. */
  function reweigh() {
    if (!walkGraph) return;
    const open = state.market ? marketState(streets.market, clock.day, clock.sec) === 'open' : false;
    const key = `${open}|${clock.hours >= 9 && clock.hours <= 19}`;
    if (key === marketWas) return;
    marketWas = key;
    walkGraph.w = liveWeights(walkGraph.base, walkGraph.x, walkGraph.z, { market: streets?.market, open, hours: clock.hours });
  }
  function rebuildProps() {
    props.begin();
    state.terraces?.props(props);
    state.market?.props(props);
    for (const r of parked.racks) props.add('rack', r.x, ground(r.x, r.z), -r.z, (-r.yaw * Math.PI) / 180);
    props.end();
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
  let night = -1, statT = 0, t = 0;
  const busHalf = [models.bus.size[0] * world.studM / 2, models.bus.size[1] * world.studM / 2];
  const by = (table) => table[tier()] ?? table.medium;
  // weather: ctx.weather?.rain (0..1) when a weather source exists, else #rain=0..1 in the URL
  const hashRain = typeof location !== 'undefined' ? +(new URLSearchParams(location.hash.replace(/^#/, '')).get('rain') || 0) : 0;
  const rainNow = () => Math.max(0, Math.min(1, ctx.weather?.rain ?? hashRain));
  // From far away people and vehicles are a pixel or less, yet they were half of all triangles
  // drawn on the overview (and again in the shadow pass): hide them beyond LIFE_VIEW_M, cull
  // single figures beyond FIGURE_CULL_M, and let only the higher tiers' life cast shadows.
  let shadowTier = null;
  function budget() {
    if (ctx.perf === false) { crowd.cullDist2 = 0; return; } // performance mode off: draw as before
    const t = ctx.controls?.target, d = t ? camera.position.distanceTo(t) : 0;
    group.visible = d < LIFE_VIEW_M;
    crowd.cullDist2 = FIGURE_CULL_M * FIGURE_CULL_M;
    const tierNow = tier();
    if (tierNow !== shadowTier) {
      shadowTier = tierNow;
      const cast = tierNow === 'high' || tierNow === 'medium';
      group.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.castShadow0 ??= o.castShadow;
        o.castShadow = cast && o.userData.castShadow0;
      });
    }
  }
  function step(dt) {
    budget();
    if (stage.night !== undefined && stage.night !== night) { night = stage.night; mats.setNight(night); }
    clock.advance(dt);
    t += dt;
    const at = target(), R = livingRadius();
    const buses = state.buses ? state.buses.update(clock, camera) : [];
    const traffic = trafficFactor(clock.hours, clock.day);
    if (state.cars) {
      state.cars.setCount(Math.round(by(CARS_BY_TIER) * traffic), at);
      state.cars.update(dt, at, Math.max(R, 150));
    }
    if (state.cyclists) {
      state.cyclists.setCount(Math.round(by(CYCLISTS_BY_TIER) * traffic), at);
      state.cyclists.update(dt, at, Math.max(R, 120));
    }
    if (state.walkers) {
      reweigh();
      state.walkers.setRain(rainNow());
      state.walkers.setCount(Math.round(by(FIGURES_BY_TIER) * crowdFactor(clock.hours, clock.day)), at);
      const vehicles = buses.map((b) => ({ x: b.x, z: b.z, yaw: b.yaw, halfW: busHalf[0], halfL: busHalf[1] }));
      if (state.cars) vehicles.push(...state.cars.footprints(at, 30));
      state.walkers.update(dt, at, R, vehicles);
    }
    let dirty = state.terraces ? state.terraces.refresh(at) : false;
    if (state.market?.refresh(clock)) dirty = true;
    if (dirty || !props.built) { rebuildProps(); props.built = true; }
    crowd.begin(camera.position); fleet.begin();
    state.walkers?.draw(crowd);
    state.terraces?.draw(crowd, clock, t, rainNow());
    state.market?.draw(crowd, t);
    state.cyclists?.draw(crowd, fleet);
    state.cars?.draw(fleet);
    state.market?.drawVans(fleet);
    const pb = ctx.perf === false ? { r: Infinity, cap: Infinity } : by(PARKED_BIKES_BY_TIER);
    for (const b of nearestWithin(parked.bikes, camera.position.x, -camera.position.z, pb.r, pb.cap)) {
      fleet.addBike(b.x, ground(b.x, b.z), -b.z, (-b.yaw * Math.PI) / 180, { colour: b.colour });
    }
    crowd.end(); fleet.end();
    if (state.boats) state.boats.update(dt);
    ui.update();
    if ((statT += dt) > 0.5 || dt === 0) {
      statT = 0;
      const b = state.buses?.stats;
      state.stats = { people: crowd.count, walkers: state.walkers?.people || 0, cyclists: state.cyclists?.count || 0,
        cars: state.cars?.count || 0, carsMoving: state.cars ? state.cars.cars.slice(0, state.cars.count).filter((c) => c.v > 0.5).length : 0, seated: state.terraces?.seated || 0, market: state.market?.state || 'none',
        drawCalls: crowd.drawCalls() + fleet.drawCalls() + props.drawCalls() };
      ui.stats([b ? `${b.active} buses (${b.full} near)` : 'no timetable', `${crowd.count} people`,
        `${state.stats.cyclists} bikes`, `${state.stats.cars} cars`, `${state.boats?.items.length || 0} boats`].join(' · '));
    }
  }
  state.step = step; // screenshots: re-place everything after moving the camera
  step(0);
  for (let q = 0; q < 4; q++) { // spread the walk cycles and let traffic settle
    state.walkers?.update(0.4, target(), livingRadius());
    state.cars?.update(0.5, target(), Math.max(livingRadius(), 150));
    state.cyclists?.update(0.4, target(), Math.max(livingRadius(), 120));
  }
  step(0);
  state.ready = true;
  /** Called by main.js / citymode.js every frame before drawing. A shot is one still frame. */
  return {
    update(dt) {
      const anim = typeof document === 'undefined' || document.getElementById('anim')?.checked !== false;
      step(still || !anim ? 0 : Math.min(dt, 0.1));
    },
  };
}
