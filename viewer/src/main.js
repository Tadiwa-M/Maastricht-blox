// Entry point: pick the world (embedded data or the piece gallery), build the brick
// meshes, stage, camera presets, locomotion demo, picking and the render loop.
//
// URL hash: #view=hero|map|facade|gallery&t=16.5&tilt=0&ao=0&anim=0&ids=38-47
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { loadWorld } from './world.js';
import { MaterialSet } from './materials.js';
import { buildWorldMeshes } from './bricks.js';
import { Stage } from './scene.js';
import { makePresets } from './presets.js';
import { galleryWorld, parseIds } from './gallery.js';
import { setupDemo } from './demo.js';
import { pickBrick } from './picking.js';
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
  };
}

function worldBox(world) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const S = world.studM, P = world.plateM;
  return new THREE.Box3(new THREE.Vector3(I0 * S, K0 * P, -J1 * S), new THREE.Vector3(I1 * S, K1 * P, -J0 * S));
}

/** Click -> brick under the cursor (grid raymarch) -> info panel + highlight box. */
function bindPicking(canvas, stage, world, ui) {
  const ray = new THREE.Raycaster();
  const sel = new THREE.Box3Helper(new THREE.Box3(), 0xffe066);
  sel.visible = false;
  stage.scene.add(sel);
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
    const hit = pickBrick(world, ray.ray.origin, ray.ray.direction);
    if (!hit) { ui.info(''); sel.visible = false; return; }
    const n = hit.n, t = world.typeOf(n), rot = world.rot(n), [ei, ej] = world.extentOf(n);
    const col = world.palette.get(world.color[n]), f = world.features.get(world.feature[n]);
    const S = world.studM, P = world.plateM;
    sel.box.min.set(world.I[n] * S, world.K[n] * P, -(world.J[n] + ej) * S);
    sel.box.max.set((world.I[n] + ei) * S, (world.K[n] + t.h) * P, -world.J[n] * S);
    sel.visible = true;
    const head = f ? `<b>${escapeHtml(f.name)}</b><span>${escapeHtml(f.kind)}${f.address ? ' · ' + escapeHtml(f.address) : ''}</span>`
      : '<b>No feature</b>';
    ui.info(`${head}<small>${escapeHtml(t.name)} · ${escapeHtml(col?.name ?? '?')} · I${world.I[n]} J${world.J[n]} K${world.K[n]} · faces ${FACING_NAMES[rot]} (rot ${rot})</small>`);
  });
}

async function main() {
  const data = window.BLOX_WORLD;
  if (!data) throw new Error('window.BLOX_WORLD missing: build dist/world.js first');
  const opts = parseHash();
  const isGallery = opts.view === 'gallery';
  let world, labels = null;
  if (isGallery) ({ world, labels } = galleryWorld(data.contract || data, parseIds(opts.ids)));
  else world = await loadWorld(data);

  const canvas = document.getElementById('view');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const stage = new Stage(canvas, W(), H());
  const mats = new MaterialSet();
  const built = buildWorldMeshes(world, mats);
  stage.scene.add(built.group);
  if (labels) stage.overlay.add(labels);
  const box = worldBox(world);
  stage.setBounds(box, world.studM);
  stage.initPost();
  const demo = isGallery ? null : setupDemo(world, box, data.models);
  if (demo) stage.scene.add(demo.group);

  const controls = new MapControls(stage.camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 600;
  const presets = makePresets(world, box, W() / H());
  let animate = opts.anim;

  function applyView(name) {
    const p = presets[name] || presets.hero;
    stage.camera.fov = p.fov;
    stage.camera.position.copy(p.cam);
    controls.target.copy(p.target);
    stage.camera.lookAt(p.target);
    stage.camera.updateProjectionMatrix();
    controls.update();
  }
  function applyTime(h) { const n = stage.setTime(h); mats.setNight(n); demo?.mats.setNight(n); }

  const ui = bindUI({
    time: opts.time, tilt: opts.tilt, ao: opts.ao, anim: animate,
    onTime: applyTime,
    onTilt: (on) => stage.post.setTiltShift(on),
    onAO: (on) => { stage.post.gtao.enabled = on; },
    onAnim: (on) => { animate = on; },
  });
  applyView(opts.view);
  applyTime(opts.time);
  stage.post.setTiltShift(opts.tilt);
  stage.post.gtao.enabled = opts.ao;
  window.addEventListener('hashchange', () => {
    const o = parseHash();
    if ((o.view === 'gallery') !== isGallery || o.ids !== opts.ids) { location.reload(); return; }
    applyView(o.view); applyTime(o.time); ui.set(o);
    stage.post.setTiltShift(o.tilt); stage.post.gtao.enabled = o.ao; animate = o.anim;
  });
  window.addEventListener('resize', () => stage.resize(W(), H()));
  bindPicking(canvas, stage, world, ui);

  const r = stage.renderer;
  r.info.autoReset = false;
  const still = /[?&]shot=1/.test(location.search);
  const clock = new THREE.Clock();
  let frames = 0, last = performance.now(), fps = 0, acc = 0, t = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    controls.update();
    if (animate && !still) {
      t += dt;
      demo?.update(dt);
      mats.update(t);
    }
    r.info.reset();
    stage.render(controls.target);
    const now = performance.now();
    acc++;
    if (now - last > 500) { fps = Math.round((acc * 1000) / (now - last)); acc = 0; last = now; }
    ui.stats({ bricks: built.bricks, studs: built.studs, calls: r.info.render.calls, fps,
      actors: demo?.actors.length || 0 });
    if (++frames === 4) window.__bloxReady = true;
    if (still && frames >= 4) return; // screenshot mode: freeze so capture is cheap
    requestAnimationFrame(frame);
  }
  window.__blox = { world, stage, controls, presets, built, demo };
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
