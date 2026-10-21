// Entry point: pick the world (embedded data or the piece gallery), build the brick
// meshes, stage, camera presets, locomotion demo, picking and the render loop.
//
// URL hash: #view=hero|map|facade|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47&quality=auto&zoom=0.5
// (zoom scales the preset's camera distance: < 1 moves in)
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { loadWorld } from './world.js';
import { MaterialSet } from './materials.js';
import { worldContext } from './bricks.js';
import { ChunkLOD } from './lod.js';
import { TIERS, MODES, initialTier, useLod, FrameGovernor, FpsMeter } from './quality.js';
import { Stage } from './scene.js';
import { makePresets } from './presets.js';
import { galleryWorld, parseIds } from './gallery.js';
import { setupDemo } from './demo.js';
import { pickNearest } from './picking.js';
import { loadIslands, islandWorldBox, worldToLocalThree } from './island.js';
import { FACING_NAMES } from './rotation.js';
import { bindUI, escapeHtml } from './ui.js';

function parseHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    view: p.get('view') || 'hero',
    time: p.has('t') ? +p.get('t') : 16.5,
    tilt: p.has('tilt') ? p.get('tilt') !== '0' : p.get('view') !== 'gallery',
    ao: p.get('ao') !== '0',
    anim: p.get('anim') !== '0',
    ids: p.get('ids'),
    quality: MODES.includes(p.get('quality')) ? p.get('quality') : 'auto',
    zoom: p.has('zoom') ? Math.max(0.05, +p.get('zoom') || 1) : 1,
  };
}

function worldBox(world) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const S = world.studM, P = world.plateM;
  return new THREE.Box3(new THREE.Vector3(I0 * S, K0 * P, -J1 * S), new THREE.Vector3(I1 * S, K1 * P, -J0 * S));
}

/** Feature title for the info panel: its name, else kind + address or BAG id. */
function featureHead(f) {
  if (!f) return '<b>No feature</b>';
  const title = f.name || (f.address ? `${f.kind} at ${f.address}` : `${f.kind} ${f.bagId || '#' + f.id}`);
  const sub = [f.kind, f.address, f.year].filter((x) => x).map(escapeHtml).join(' · ');
  return `<b>${escapeHtml(title)}</b><span>${sub}</span>`;
}

/**
 * Click -> brick under the cursor (grid raymarch over the chunks and every island, ray moved
 * into island space; nearest hit wins) -> info panel + highlight box (in the hit's own frame).
 */
function bindPicking(canvas, stage, world, islands, lod, ui) {
  const ray = new THREE.Raycaster();
  const sel = new THREE.Box3Helper(new THREE.Box3(), 0xffe066);
  sel.visible = false;
  stage.scene.add(sel);
  const targets = [{ world, parent: stage.scene },
    ...islands.map((w, q) => ({ world: w, parent: lod.sources[q + 1].parent, toLocal: (p, dir) => worldToLocalThree(w.island, p, dir) }))];
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
    const hit = pickNearest(targets, ray.ray.origin, ray.ray.direction);
    if (!hit) { ui.info(''); sel.visible = false; return; }
    const w = hit.target.world, n = hit.n, t = w.typeOf(n), rot = w.rot(n), [ei, ej] = w.extentOf(n);
    const col = w.palette.get(w.color[n]), f = w.features.get(w.feature[n]);
    const S = w.studM, P = w.plateM;
    sel.box.min.set(w.I[n] * S, w.K[n] * P, -(w.J[n] + ej) * S);
    sel.box.max.set((w.I[n] + ei) * S, (w.K[n] + t.h) * P, -w.J[n] * S);
    if (sel.parent !== hit.target.parent) hit.target.parent.add(sel);
    sel.visible = true;
    const where = w.island ? `island ${w.island.id} (${w.island.yawDeg.toFixed(1)}°) · i${w.I[n]} j${w.J[n]} K${w.K[n]}`
      : `I${w.I[n]} J${w.J[n]} K${w.K[n]}`;
    ui.info(`${featureHead(f)}<small>${escapeHtml(t.name)} · ${escapeHtml(col?.name ?? '?')} · ${where} · faces ${FACING_NAMES[rot]} (rot ${rot})</small>`);
  });
}

async function main() {
  const data = window.BLOX_WORLD;
  if (!data) throw new Error('window.BLOX_WORLD missing: build dist/world.js first');
  const opts = parseHash();
  const isGallery = opts.view === 'gallery';
  let world, labels = null, islands = [];
  if (isGallery) ({ world, labels } = galleryWorld(data.contract || data, parseIds(opts.ids)));
  else { world = await loadWorld(data); islands = await loadIslands(data); }

  const canvas = document.getElementById('view');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const stage = new Stage(canvas, W(), H());
  const mats = new MaterialSet();
  const totalBricks = islands.reduce((a, w) => a + w.count, world.count);
  const lod = new ChunkLOD(world, mats, worldContext(world, mats),
    islands.map((w) => ({ world: w, ctx: worldContext(w, mats) })));
  stage.scene.add(lod.group);
  // the gallery is one small scene: always the full look
  const size = isGallery ? { chunks: 1, bricks: 0 } : { chunks: lod.chunks.length, bricks: totalBricks };
  let mode = opts.quality, tierName = initialTier(mode, size), governor = new FrameGovernor(tierName);
  if (labels) stage.overlay.add(labels);
  const box = worldBox(world);
  for (const w of islands) box.union(islandWorldBox(w));
  stage.setBounds(box, world.studM);
  stage.initPost();
  function applyTier(name) {
    tierName = name;
    const tier = TIERS[name];
    stage.setQuality(tier);
    lod.setTier({ ...tier, lod: useLod(name, size) });
    ui?.tier(mode, name);
  }
  function setMode(m) {
    mode = m;
    governor = new FrameGovernor(initialTier(m, size));
    applyTier(initialTier(m, size));
  }
  let ui = null;
  applyTier(tierName);
  const demo = isGallery ? null : setupDemo(world, box, data.models);
  if (demo) stage.scene.add(demo.group);

  const controls = new MapControls(stage.camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 600;
  const presets = makePresets(world, box, W() / H(), islands);
  let animate = opts.anim;

  function applyView(name, zoom = 1) {
    const p = presets[name] || presets.hero;
    stage.camera.fov = p.fov;
    stage.camera.position.copy(p.cam).sub(p.target).multiplyScalar(zoom).add(p.target);
    controls.target.copy(p.target);
    stage.camera.lookAt(p.target);
    stage.camera.updateProjectionMatrix();
    controls.update();
  }
  function applyTime(h) { const n = stage.setTime(h); mats.setNight(n); demo?.mats.setNight(n); }

  ui = bindUI({
    time: opts.time, tilt: opts.tilt, ao: opts.ao, anim: animate, quality: mode,
    onTime: applyTime,
    onTilt: (on) => stage.post.setTiltShift(on),
    onAO: (on) => stage.post.setAO(on),
    onAnim: (on) => { animate = on; },
    onQuality: setMode,
  });
  ui.tier(mode, tierName);
  applyView(opts.view, opts.zoom);
  applyTime(opts.time);
  stage.post.setTiltShift(opts.tilt);
  stage.post.setAO(opts.ao);
  window.addEventListener('hashchange', () => {
    const o = parseHash();
    if ((o.view === 'gallery') !== isGallery || o.ids !== opts.ids) { location.reload(); return; }
    applyView(o.view, o.zoom); applyTime(o.time); ui.set(o);
    stage.post.setTiltShift(o.tilt); stage.post.setAO(o.ao); animate = o.anim;
    if (o.quality !== mode) setMode(o.quality);
  });
  window.addEventListener('resize', () => stage.resize(W(), H()));
  bindPicking(canvas, stage, world, islands, lod, ui);

  const r = stage.renderer;
  r.info.autoReset = false;
  const still = /[?&]shot=1/.test(location.search);
  const clock = new THREE.Clock();
  // fps = real intervals between animation frames (the old readout rounded to whole fps,
  // so anything slower than 2 s per frame showed "0 fps")
  const meter = new FpsMeter(1000);
  let frames = 0, t = 0, lastStats = 0;
  if (still) lod.settle(stage.camera); else lod.update(stage.camera, { all: true });
  // a hidden tab gets no frames: do not count the gap as one very slow frame
  document.addEventListener('visibilitychange', () => { meter.last = null; governor.reset(); });
  function frame(now) {
    const dt = Math.min(clock.getDelta(), 0.1);
    const ms = meter.tick(now);
    controls.update();
    lod.update(stage.camera);
    if (animate && !still) {
      t += dt;
      demo?.update(dt);
      mats.update(t);
    }
    r.info.reset();
    stage.render(controls.target);
    if (mode === 'auto' && !still && ms > 0) {
      const next = governor.sample(ms);
      if (next) applyTier(next);
    }
    if (now - lastStats > 250 || still) {
      lastStats = now;
      const ls = lod.stats();
      ui.stats({ bricks: totalBricks, studs: ls.studs, near: ls.near, chunks: ls.chunks, calls: r.info.render.calls,
        triangles: r.info.render.triangles, fps: meter.label(), actors: demo?.actors.length || 0 });
    }
    if (++frames === 4) window.__bloxReady = true;
    if (still && frames >= 4) return; // screenshot mode: freeze so capture is cheap
    requestAnimationFrame(frame);
  }
  const built = { bricks: totalBricks, get studs() { return lod.studsShown; } };
  window.__blox = { world, islands, stage, controls, presets, built, demo, lod,
    quality: { describe: () => `${mode}:${tierName}` } };
  // screenshot hook: render synchronously and read the canvas back (cheaper than a
  // compositor capture under software GL)
  window.__bloxCapture = () => {
    const t0 = performance.now();
    stage.render(controls.target);
    const url = canvas.toDataURL('image/png');
    return { url, ms: performance.now() - t0 };
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  document.getElementById('info').hidden = false;
  document.getElementById('info').textContent = `Error: ${err.message}`;
  window.__bloxError = String(err.stack || err);
});
