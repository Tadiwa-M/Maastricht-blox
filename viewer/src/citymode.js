// City mode: the streamed site build (build.mjs --site). The whole city is always on screen as
// baked far regions (src/farregion.js); chunks and islands stream in around the camera
// (src/loader.js, src/cityview.js); the camera is a map camera for a 2 km city (src/citycam.js).
//
// URL hash (as the diorama, plus): #view=city|hero|street|map|<place>&at=x,z&dist=m&worker=0
//   city   the whole city from the south-southwest     map    straight down on the whole city
//   hero   3/4 view over the Markt (or the data centre) street  street level on the Markt
//   <place> markt | vrijthof | brug | station | bonnefanten: a 3/4 view over that place
//   at=x,z (Unity metres east, north) + dist: look at any point; worker=0: prepare on the main thread
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { MaterialSet } from './materials.js';
import { TIERS, MODES, initialTier, FrameGovernor, FpsMeter } from './quality.js';
import { Stage } from './scene.js';
import { FarRegions } from './farregion.js';
import { decodeBxf } from './farbake.js';
import { readBody } from './bxc.js';
import { PreparePool } from './workers.js';
import { CityLoader } from './loader.js';
import { CityView } from './cityview.js';
import { CityCamera, tiltFor } from './citycam.js';
import { FACING_NAMES } from './rotation.js';
import { bindUI, escapeHtml } from './ui.js';

const DEG = Math.PI / 180;
// Places in chunk coordinates (as build.mjs --around): chunk = floor((RD - origin) / 32 m)
export const PLACES = { markt: [22, 47], vrijthof: [15, 38], brug: [32, 40], station: [53, 40], bonnefanten: [41, 18] };

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
  for (const [name, [cx, cy]] of Object.entries(PLACES)) if (have.has(`${cx},${cy}`)) places[name] = at((cx + 0.5) * CM, -(cy + 0.5) * CM);
  const focus = places.markt || at(c.x, c.z);
  const out = {
    city: (() => { const t = at(c.x, c.z); return { target: t, cam: t.clone().add(offset(200, 42, Math.max(150, r * 1.55))), fov: 40 }; })(),
    map: (() => { const t = at(c.x, c.z); return { target: t, cam: t.clone().add(offset(180, 89, Math.max(150, r * 2.3))), fov: 40 }; })(),
    hero: { target: focus, cam: focus.clone().add(offset(206, 24, Math.min(320, Math.max(90, r * 0.6)))), fov: 40 },
    street: { target: focus.clone().setY(focus.y + 2), cam: focus.clone().setY(focus.y + 2).add(offset(200, 8, 26)), fov: 50 },
  };
  for (const [name, t] of Object.entries(places)) out[name] = { target: t, cam: t.clone().add(offset(206, 30, 160)), fov: 40 };
  return out;
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
  const [index, farIndex, palette, catalogue, extras] = await Promise.all([
    src.json('index.json'), src.json('far/index.json'), src.json('palette.json'), src.json('brick_catalogue.json'),
    src.json('models.json').catch(() => ({ models: {} })),
  ]);
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
  stage.setBounds(box, index.studM, { groundSize: 40000, groundY: approxGround(centre.x, centre.z) - 3 });
  stage.initPost();

  let mode = opts.quality;
  const size = { chunks: index.chunks.length, bricks: Infinity };
  let tierName = initialTier(mode, size), governor = new FrameGovernor(tierName);
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

  let ui = null;
  function applyTier(name) {
    tierName = name;
    const tier = TIERS[name];
    stage.setQuality(tier);
    view.setTier(tier);
    loader.setRadius(tier.streamRadius);
    far.showDist = tier.farDist;
    ui?.tier(mode, name);
  }
  function setMode(m) { mode = m; governor = new FrameGovernor(initialTier(m, size)); applyTier(initialTier(m, size)); }
  applyTier(tierName);

  const controls = new MapControls(stage.camera, canvas);
  const cam = new CityCamera(stage.camera, controls, { box, groundAt: (x, z) => {
    const g = city.groundHeight(x, z);
    return typeof g === 'number' ? g : approxGround(x, z);
  } });
  const presets = cityPresets(index, box, approxGround);
  function applyView(o) {
    let p = presets[o.view] || presets.city;
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
  const still = /[?&]shot=1/.test(location.search);
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

  function frame(now) {
    const dt = Math.min(clock.getDelta(), 0.1);
    const ms = meter.tick(now);
    controls.update();
    const dist = cam.update();
    for (const h of hooks) h.update?.(dt, now);
    stage.camera.updateMatrixWorld();
    pv.multiplyMatrices(stage.camera.projectionMatrix, stage.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    loader.update(stage.camera.position, inView);
    if (times.silhouette === undefined && far.silhouetteReady()) times.silhouette = performance.now() - t0;
    const ready = still && far.silhouetteReady() && loader.settled() && far.settled();
    view.update(stage.camera, { all: ready });
    // view-dependent look: haze, shadow box and AO follow the zoom
    const t = controls.target;
    const zoomed = THREE.MathUtils.clamp(dist, 10, 4000);
    stage.scene.fog.near = zoomed * 0.9 + 140;
    stage.scene.fog.far = stage.scene.fog.near + 900 + zoomed * 2.2;
    const sr = THREE.MathUtils.clamp(dist * 1.1, 45, 1600);
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
    if (draw && (!still || ready)) settleFrames++;
    if (settleFrames === 4) { window.__bloxReady = true; readyAt = performance.now(); times.ready = readyAt - t0; }
    if (still && settleFrames >= 4) return;
    requestAnimationFrame(frame);
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
  const ctx = { stage, camera: stage.camera, controls, city, models: extras.models || {}, ui, world: null, islands: [], features };
  hooks.push(...(await initHooks(ctx)).filter(Boolean));
  requestAnimationFrame(frame);
}

export { tiltFor };
