// City mode: the streamed site build (build.mjs --site). The whole city is always on screen as
// baked far regions (src/farregion.js); chunks and islands stream in around the camera
// (src/loader.js, src/cityview.js); the camera is a map camera for a 2 km city (src/citycam.js).
//
// URL hash (as the diorama, plus): #view=city|hero|street|map|<place>&at=x,z&dist=m&worker=0
//   city   the whole city from the south-southwest     map    straight down on the whole city
//   hero   3/4 view over the Markt (or the data centre) street  street level on the Markt
//   <place> markt | vrijthof | brug | station | bonnefanten: a 3/4 view over that place
//   at=x,z (Unity metres east, north) + dist: look at any point; worker=0: prepare on the main thread;
//   stream=0: baked far regions only (check the bake), farlevel=1|2|3: force one baked level
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { MaterialSet } from './materials.js';
import { World } from './world.js';
import { TIERS, MODES, initialTier, FrameGovernor, FpsMeter } from './quality.js';
import { Stage } from './scene.js';
import { FarRegions } from './farregion.js';
import { decodeBxf } from './farbake.js';
import { readBody } from './bxc.js';
import { PreparePool } from './workers.js';
import { CityLoader } from './loader.js';
import { CityView } from './cityview.js';
import { CityCamera, tiltFor, zoomT } from './citycam.js';
import { FACING_NAMES } from './rotation.js';
import { bindUI, escapeHtml } from './ui.js';

const DEG = Math.PI / 180;
import { PLACES_RD, placeChunk } from './places.js';
import { loadingScreen, loadState } from './loading.js';
import { gpuInfo, autoTierFor } from './gpu.js';
import { showNotice } from './ui.js';

function parseHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const at = p.get('at')?.split(',').map(Number);
  return {
    view: p.get('view') || 'city',
    time: p.has('t') ? +p.get('t') : 16.5,
    tilt: p.get('tilt') !== '0',
    ao: p.get('ao') !== '0',
    anim: p.get('anim') !== '0',
    quality: MODES.includes(p.get('quality')) ? p.get('quality') : 'auto',
    zoom: p.has('zoom') ? Math.max(0.05, +p.get('zoom') || 1) : 1,
    at: at?.length === 2 && at.every(Number.isFinite) ? at : null,
    dist: p.has('dist') ? +p.get('dist') : null,
    worker: p.get('worker') !== '0',
    stream: p.get('stream') !== '0',
    farLevel: p.has('farlevel') ? +p.get('farlevel') : null,
  };
}

/** Direction from target to camera for a compass azimuth (0 = north) and elevation. */
function offset(azDeg, elDeg, dist) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
}

/** City box (three.js) from the stream index. */
export function cityBox(index) {
  const S = index.studM, P = index.plateM, CM = index.chunkStuds * S;
  const b = new THREE.Box3();
  for (const c of index.chunks) {
    b.expandByPoint(new THREE.Vector3(c.cx * CM, c.minK * P, -(c.cy + 1) * CM));
    b.expandByPoint(new THREE.Vector3((c.cx + 1) * CM, c.maxK * P, -c.cy * CM));
  }
  for (const i of index.islands) {
    b.expandByPoint(new THREE.Vector3(i.rect[0], i.minK * P, -i.rect[3]));
    b.expandByPoint(new THREE.Vector3(i.rect[2], i.maxK * P, -i.rect[1]));
  }
  return b;
}

/** Ground height (m) at any (x, z) from the baked per-chunk ground (nearest known chunk). */
export function groundGrid(farIndex, index) {
  const CM = index.chunkStuds * index.studM, P = index.plateM;
  const m = new Map((farIndex.ground || []).map(([cx, cy, k]) => [`${cx},${cy}`, k]));
  const ks = [...m.values()].filter((k) => k !== null).sort((a, b) => a - b);
  const median = ks.length ? ks[ks.length >> 1] : 0;
  return (x, z) => {
    const cx = Math.floor(x / CM), cy = Math.floor(-z / CM);
    for (let r = 0; r <= 2; r++)
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const k = m.get(`${cx + dx},${cy + dy}`);
        if (k !== undefined && k !== null) return k * P;
      }
    return median * P;
  };
}

/** Camera presets for a city: { name: { target, cam, fov } }. */
export function cityPresets(index, box, approxGround) {
  const CM = index.chunkStuds * index.studM;
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.hypot(size.x, size.z) / 2;
  const have = new Set(index.chunks.map((e) => `${e.cx},${e.cy}`));
  const at = (x, z, lift = 0) => new THREE.Vector3(x, approxGround(x, z) + lift, z);
  const places = {};
  const origin = index.originRD || [175700, 316500];
  for (const name of Object.keys(PLACES_RD)) {
    const [cx, cy] = placeChunk(name, origin, CM);
    if (have.has(`${cx},${cy}`)) places[name] = at(PLACES_RD[name][0] - origin[0], -(PLACES_RD[name][1] - origin[1]));
  }
  const focus = places.markt || at(c.x, c.z);
  const out = {
    city: (() => { const t = at(c.x, c.z); return { target: t, cam: t.clone().add(offset(200, 42, Math.max(150, r * 1.55))), fov: 40 }; })(),
    map: (() => { const t = at(c.x, c.z); return { target: t, cam: t.clone().add(offset(180, 89, Math.max(150, r * 2.3))), fov: 40 }; })(),
    hero: { target: focus, cam: focus.clone().add(offset(206, 17, Math.min(320, Math.max(90, r * 0.6)))), fov: 40 },
    street: { target: focus.clone().setY(focus.y + 2), cam: focus.clone().setY(focus.y + 2).add(offset(200, 8, 26)), fov: 50 },
  };
  for (const [name, t] of Object.entries(places)) out[name] = { target: t, cam: t.clone().add(offset(206, 30, 160)), fov: 40 };
  return out;
}

/**
 * Street-level camera near (x, z): the open ground spot (no roof above, at the lowest ground
 * around) closest to the point, looked at from the side with the longest clear line of sight,
 * eye 1.7 m above the street, 6 degrees down. Needs the area streamed (city query API);
 * returns null while it is unknown.
 */
export function findStreetSpot(city, x, z, { search = 40, step = 2, eye = 1.7, dist = 24 } = {}) {
  const open = (px, pz) => {
    const g = city.groundHeight(px, pz);
    return typeof g === 'number' ? g : null;
  };
  let lowest = Infinity;
  for (let dx = -search; dx <= search; dx += step * 4) for (let dz = -search; dz <= search; dz += step * 4) {
    const g = open(x + dx, z + dz);
    if (g !== null) lowest = Math.min(lowest, g);
  }
  if (lowest === Infinity) return null;
  // nearest column whose top is street level (within 0.5 m of the lowest ground seen)
  let best = null;
  for (let r = 0; r <= search && !best; r += step)
    for (let a = 0; a < 360 && !best; a += r ? Math.max(5, (step / r) * 57) : 360) {
      const px = x + r * Math.cos(a * DEG), pz = z + r * Math.sin(a * DEG);
      const g = open(px, pz);
      if (g !== null && g - lowest < 0.5) best = { x: px, z: pz, y: g };
    }
  if (!best) return null;
  const target = new THREE.Vector3(best.x, best.y + eye, best.z);
  // the direction with the longest clear eye-level line (camera stands there, looks back)
  let bestAz = 200, bestFree = -1;
  for (let az = 0; az < 360; az += 15) {
    let free = 0;
    for (let d = 1; d <= dist; d += 1) {
      const o = offset(az, 0, d);
      const s = city.isSolid(target.x + o.x, target.y, target.z + o.z);
      if (s !== false) break;
      free = d;
    }
    if (free > bestFree) { bestFree = free; bestAz = az; }
  }
  const camDist = Math.max(6, Math.min(dist, bestFree - 1));
  return { target, cam: target.clone().add(offset(bestAz, 6, camDist)) };
}

function featureHead(f) {
  if (!f) return '<b>No feature</b>';
  const title = f.name || (f.address ? `${f.kind} at ${f.address}` : `${f.kind} ${f.bagId || '#' + f.id}`);
  const sub = [f.kind, f.address, f.year].filter((x) => x).map(escapeHtml).join(' · ');
  return `<b>${escapeHtml(title)}</b><span>${sub}</span>`;
}

/** site: { source } (src/source.js); initHooks(ctx) -> [{ update?(dt, now) }] from main.js. */
export async function cityMain(site, { initHooks = async () => [] } = {}) {
  const t0 = performance.now();
  const opts = parseHash();
  const src = site.source;
  const still = /[?&]shot=1/.test(location.search);
  // ?film=1 (tools/film.mjs): no render loop; the tool steps frames with a fixed dt and moves the camera
  const film = /[?&]film=1/.test(location.search);
  const cover = loadingScreen();
  const boot = { index: false, silhouette: false, frames: 0, since: 0 };
  cover.update(loadState(boot).frac, loadState(boot).msg);
  const [index, farIndex, palette, catalogue, extras] = await Promise.all([
    src.json('index.json'), src.json('far/index.json'), src.json('palette.json'), src.json('brick_catalogue.json'),
    src.json('models.json').catch(() => ({ models: {} })),
  ]);
  boot.index = true;
  cover.update(loadState(boot).frac, loadState(boot).msg);
  const meta = { manifest: { chunkStuds: index.chunkStuds, studM: index.studM, plateM: index.plateM }, palette, catalogue };
  const features = new Map();
  src.json('features.json').then((f) => { for (const e of f.features || []) features.set(e.id, e); }).catch(() => {});

  const canvas = document.getElementById('view');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const stage = new Stage(canvas, W(), H());
  const mats = new MaterialSet();
  const box = cityBox(index);
  const approxGround = groundGrid(farIndex, index);
  const centre = box.getCenter(new THREE.Vector3());
  const cityRadius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  // the baseplate lies just under the lowest brick (river bed), so it never covers a street
  stage.setBounds(box, index.studM, { groundSize: 40000, groundY: box.min.y - 0.3 });
  stage.initPost();

  let mode = opts.quality;
  const size = { chunks: index.chunks.length, bricks: Infinity };
  const gpu = gpuInfo(stage.renderer);
  const gpuTier = autoTierFor(gpu.cls);
  let tierName = initialTier(mode, size, gpuTier), governor = new FrameGovernor(tierName);
  if (gpu.cls === 'software' && !still && !film) {
    showNotice('Your browser is drawing without the graphics card (hardware acceleration is off), so the city will be slow. '
      + 'Turn on "Use graphics acceleration when available" in the browser settings and restart it.');
  }
  const inflate = (b) => readBody(b, 0, b.byteLength, 1);
  const far = new FarRegions(farIndex, { palette: new Map(palette.entries.map((e) => [e.idx, e])), mats,
    fetchBytes: (p, signal) => src.bytes(p, signal), decode: (b) => decodeBxf(b, inflate), covered: () => false });
  const threads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  const pool = new PreparePool(meta, { size: opts.worker && src.kind === 'http' ? threads : 0 });
  const loader = new CityLoader(index, { source: src, pool });
  const view = new CityView({ meta, index, mats, loader, far });
  stage.scene.add(view.group);
  const city = loader.query;
  city.approxGround = approxGround;
  city.box = box;
  city.focus = (x, z) => loader.focus(x, z, x === null ? null : approxGround(x, z) + 2);

  let ui = null, viewScale = -1;
  /**
   * Street level sees less (buildings block the view, haze): stream radius and baked-level
   * distances shrink to 60 % with the camera near the ground, full size from ~100 m up.
   */
  function applyRadii(heightAboveGround) {
    const f = Math.round(THREE.MathUtils.clamp((heightAboveGround + 40) / 140, 0.6, 1) * 20) / 20;
    if (f === viewScale) return;
    viewScale = f;
    const tier = TIERS[tierName];
    loader.setRadius(opts.stream ? tier.streamRadius * f : 0);
    far.setShowDist(opts.farLevel ? [[0, 0], [Infinity, 0], [Infinity, Infinity]][opts.farLevel - 1] : tier.farDist.map((d) => d * f));
  }
  function applyTier(name) {
    tierName = name;
    const tier = TIERS[name];
    stage.setQuality(tier);
    view.setTier(tier);
    viewScale = -1; // re-apply the height-scaled radii below
    ui?.tier(mode, name);
  }
  function setMode(m) { mode = m; governor = new FrameGovernor(initialTier(m, size, gpuTier)); applyTier(initialTier(m, size, gpuTier)); }
  applyTier(tierName);

  const controls = new MapControls(stage.camera, canvas);
  const cam = new CityCamera(stage.camera, controls, { box, groundAt: (x, z, fromY) => {
    const g = city.groundHeight(x, z, fromY);
    return typeof g === 'number' ? g : approxGround(x, z);
  } });
  const presets = cityPresets(index, box, approxGround);
  let streetWanted = null; // street view: re-aim once the area is streamed in (needs the query API)
  function applyView(o) {
    let p = presets[o.view] || presets.city;
    streetWanted = o.view === 'street' ? { target: p.target.clone(), zoom: o.zoom } : null;
    if (o.at) {
      const t = new THREE.Vector3(o.at[0], 0, -o.at[1]);
      t.y = approxGround(t.x, t.z);
      p = { target: t, cam: t.clone().add(offset(206, 30, o.dist || 120)), fov: 40 };
    }
    stage.camera.fov = p.fov;
    stage.camera.position.copy(p.cam).sub(p.target).multiplyScalar(o.zoom).add(p.target);
    controls.target.copy(p.target);
    stage.camera.lookAt(p.target);
    stage.camera.updateProjectionMatrix();
    controls.update();
    cam.update();
  }
  function applyTime(h) { const n = stage.setTime(h); mats.setNight(n); }
  ui = bindUI({ time: opts.time, tilt: opts.tilt, ao: opts.ao, anim: opts.anim, quality: mode,
    onTime: applyTime, onTilt: (on) => stage.post.setTiltShift(on), onAO: (on) => stage.post.setAO(on),
    onAnim: () => {}, onQuality: setMode });
  ui.tier(mode, tierName);
  ui.views(['city', 'hero', 'street', 'map', ...Object.keys(presets).filter((k) => !['city', 'hero', 'street', 'map'].includes(k)), 'gallery']);
  applyView(opts);
  applyTime(opts.time);
  stage.post.setTiltShift(opts.tilt);
  stage.post.setAO(opts.ao);
  window.addEventListener('hashchange', () => {
    const o = parseHash();
    if (o.view === 'gallery') { location.reload(); return; }
    applyView(o); applyTime(o.time); ui.set(o);
    stage.post.setTiltShift(o.tilt); stage.post.setAO(o.ao);
    if (o.quality !== mode) setMode(o.quality);
  });
  window.addEventListener('resize', () => stage.resize(W(), H()));

  // click -> brick (streamed items only; the baked far look has no bricks)
  const ray = new THREE.Raycaster();
  const sel = new THREE.Box3Helper(new THREE.Box3(), 0xffe066);
  sel.visible = false;
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
    const hit = view.pick(ray.ray);
    if (!hit) { ui.info(''); sel.visible = false; return; }
    const w = hit.target.world, n = hit.n, t = w.typeOf(n), rot = w.rot(n), [ei, ej] = w.extentOf(n);
    const S = w.studM, P = w.plateM;
    sel.box.min.set(w.I[n] * S, w.K[n] * P, -(w.J[n] + ej) * S);
    sel.box.max.set((w.I[n] + ei) * S, (w.K[n] + t.h) * P, -w.J[n] * S);
    if (sel.parent) sel.parent.remove(sel);
    hit.target.parent.add(sel);
    sel.visible = true;
    const col = w.palette.get(w.color[n]), f = features.get(w.feature[n]);
    const where = w.island ? `island ${w.island.id} (${w.island.yawDeg.toFixed(1)}°) · i${w.I[n]} j${w.J[n]} K${w.K[n]}` : `I${w.I[n]} J${w.J[n]} K${w.K[n]}`;
    ui.info(`${featureHead(f)}<small>${escapeHtml(t.name)} · ${escapeHtml(col?.name ?? '?')} · ${where} · faces ${FACING_NAMES[rot]} (rot ${rot})</small>`);
  });

  const r = stage.renderer;
  r.info.autoReset = false;
  const clock = new THREE.Clock();
  const meter = new FpsMeter(1000);
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), tmpBox = new THREE.Box3();
  const inView = (b) => frustum.intersectsBox(tmpBox.set(b.min, b.max));
  const shadowBox = new THREE.Box3();
  let frames = 0, lastStats = 0, firstFrame = null, readyAt = null, settleFrames = 0;
  const hooks = [];
  document.addEventListener('visibilitychange', () => { meter.last = null; governor.reset(); });
  const times = { start: t0 };
  window.__bloxTimes = times;

  function frame(now, fixedDt) {
    const dt = fixedDt ?? Math.min(clock.getDelta(), 0.1);
    const ms = meter.tick(now);
    controls.update();
    const dist = cam.update();
    for (const h of hooks) h.update?.(dt, now);
    stage.camera.updateMatrixWorld();
    pv.multiplyMatrices(stage.camera.projectionMatrix, stage.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    applyRadii(stage.camera.position.y - approxGround(stage.camera.position.x, stage.camera.position.z));
    if (far.silhouetteReady()) loader.update(stage.camera.position, inView); // silhouette first
    if (times.silhouette === undefined && far.silhouetteReady()) times.silhouette = performance.now() - t0;
    if (streetWanted && loader.settled()) {
      const spot = findStreetSpot(city, streetWanted.target.x, streetWanted.target.z);
      if (spot) {
        controls.target.copy(spot.target);
        stage.camera.position.copy(spot.cam).sub(spot.target).multiplyScalar(streetWanted.zoom).add(spot.target);
        controls.update();
        cam.update();
      }
      streetWanted = null;
      return film ? undefined : requestAnimationFrame(frame);
    }
    const ready = still && !streetWanted && far.silhouetteReady() && loader.settled() && far.settled();
    view.update(stage.camera, { all: ready });
    // view-dependent look: haze, shadow box and AO follow the zoom
    const t = controls.target;
    const zoomed = THREE.MathUtils.clamp(dist, 10, 4000);
    // the baseplate beyond the city fades into the horizon haze, the city itself stays clear
    // (street level: haze from ~200 m, gone at ~1.1 km; whole city: the far edge is lightly hazed)
    stage.scene.fog.near = zoomed + 200;
    stage.scene.fog.far = stage.scene.fog.near + 900 + cityRadius * 2.4 * zoomT(zoomed);
    const sr = THREE.MathUtils.clamp(dist * 1.1, 45, Math.max(45, TIERS[tierName].shadowRange ?? 1600));
    shadowBox.min.set(t.x - sr, t.y - 10, t.z - sr); shadowBox.max.set(t.x + sr, t.y + Math.min(140, sr), t.z + sr);
    stage.setShadowFocus(shadowBox);
    stage.post.setAOInRange(dist < TIERS[tierName].aoDist);
    if (mats.waterUniforms) mats.update(now / 1000);
    const draw = far.silhouetteReady() && (!still || ready);
    if (draw) {
      r.info.reset();
      stage.render(controls.target);
      if (firstFrame === null) { firstFrame = performance.now(); times.firstFrame = firstFrame - t0; }
      if (mode === 'auto' && !still && ms > 0) { const next = governor.sample(ms); if (next) applyTier(next); }
    }
    if (now - lastStats > 250 || still) {
      lastStats = now;
      const vs = view.stats(), ls = loader.stats();
      ui.stats({ text: `${ls.loaded}/${ls.items} streamed (${ls.inflight} loading, ${ls.mib.toFixed(1)} MiB) · ${vs.near} near · `
        + `${vs.studs.toLocaleString()} studs · far l1/l2/l3 ${vs.l1 ?? 0}/${vs.l2 ?? 0}/${vs.l3 ?? 0} · ${r.info.render.calls} draws · `
        + `${(r.info.render.triangles / 1e6).toFixed(2)} M tris · ${meter.label()}` });
    }
    if (!cover.done) {
      if (!boot.silhouette && far.silhouetteReady()) { boot.silhouette = true; boot.since = now; }
      if (draw) boot.frames++;
      const ls = loader.stats();
      const st = loadState({ ...boot, loaded: ls.loaded, inflight: ls.inflight, pending: ls.pending,
        settled: loader.settled(), frames: boot.frames, streamMs: boot.silhouette ? now - boot.since : 0 });
      cover.update(st.frac, st.msg);
      if (st.done) { cover.hide(); times.cover = performance.now() - t0; }
    }
    if (draw && (!still || ready)) settleFrames++;
    if (settleFrames === 4) { window.__bloxReady = true; readyAt = performance.now(); times.ready = readyAt - t0; }
    if (still && settleFrames >= 4) return;
    if (!film) requestAnimationFrame(frame);
  }
  const built = { bricks: 0, get studs() { return view.studsShown; } };
  window.__blox = { stage, controls, presets, built, city, loader, view, far, pool, cam,
    lod: { stats: () => ({ ...view.stats(), stream: loader.stats(), threaded: pool.threaded }) },
    quality: { describe: () => `${mode}:${tierName}` } };
  window.__bloxCapture = () => {
    const ts = performance.now();
    stage.render(controls.target);
    return { url: canvas.toDataURL('image/png'), ms: performance.now() - ts };
  };
  // hooks get an empty World for palette/catalogue/feature lookups (no bricks: ask `city`)
  const metaWorld = new World({ ...meta, features: { features: [] } });
  metaWorld.features = features;
  metaWorld.finish();
  const ctx = { stage, camera: stage.camera, controls, city, models: extras.models || {}, ui, world: metaWorld, islands: [],
    lod: null, box, demo: null, quality: () => tierName, still, features };
  hooks.push(...(await initHooks(ctx)).filter(Boolean));
  if (!film) { requestAnimationFrame(frame); return; }
  controls.enableDamping = false;
  let filmNow = performance.now();
  window.__bloxFilm = {
    /** Advance one frame by dt seconds (life, water, streaming) and draw it. */
    step(dt) { filmNow += dt * 1000; frame(filmNow, dt); },
    /** Move the camera; three.js coords. */
    pose(cam, target, fov) {
      stage.camera.position.set(...cam); controls.target.set(...target);
      if (fov) { stage.camera.fov = fov; stage.camera.updateProjectionMatrix(); }
      stage.camera.lookAt(controls.target);
    },
    time(h) { applyTime(h); },
    settled: () => far.silhouetteReady() && loader.settled() && far.settled(),
    presets: () => Object.fromEntries(Object.entries(presets).map(([k, p]) => [k, { cam: p.cam.toArray(), target: p.target.toArray(), fov: p.fov }])),
  };
  window.__bloxReady = true;
}

export { tiltFor };
