// Entry point: load window.BLOX_WORLD, build the brick scene, controls, presets and UI.
import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { loadWorld } from './world.js';
import { MaterialSet } from './materials.js';
import { buildBrickMeshes } from './bricks.js';
import { Stage } from './scene.js';
import { makePresets } from './presets.js';
import { bindUI, escapeHtml } from './ui.js';

function parseHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    view: p.get('view') || 'hero',
    time: p.has('t') ? +p.get('t') : 16.5,
    tilt: p.get('tilt') !== '0',
    ao: p.get('ao') !== '0',
  };
}

function worldBox(world) {
  const { I0, J0, K0, I1, J1, K1 } = world.bounds;
  const S = world.studM, P = world.plateM;
  return new THREE.Box3(new THREE.Vector3(I0 * S, K0 * P, -J1 * S), new THREE.Vector3(I1 * S, K1 * P, -J0 * S));
}

async function main() {
  const data = window.BLOX_WORLD;
  if (!data) throw new Error('window.BLOX_WORLD missing: build dist/world.js first');
  const world = await loadWorld(data);
  const canvas = document.getElementById('view');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const stage = new Stage(canvas, W(), H());
  const mats = new MaterialSet();
  const built = buildBrickMeshes(world, mats);
  stage.scene.add(built.group);
  const box = worldBox(world);
  stage.setBounds(box, world.groundK * world.plateM);
  stage.initPost(W(), H());

  const opts = parseHash();
  const controls = new MapControls(stage.camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 2;
  controls.maxDistance = 600;
  const presets = makePresets(world, box);

  function applyView(name) {
    const p = presets[name] || presets.hero;
    stage.camera.fov = p.fov;
    stage.camera.position.copy(p.cam);
    controls.target.copy(p.target);
    stage.camera.lookAt(p.target);
    stage.camera.updateProjectionMatrix();
    controls.update();
  }
  function applyTime(h) { mats.setNight(stage.setTime(h)); }

  const ui = bindUI({
    time: opts.time, tilt: opts.tilt, ao: opts.ao,
    onTime: applyTime,
    onTilt: (on) => stage.setTiltShift(on),
    onAO: (on) => { stage.gtao.enabled = on; },
  });
  applyView(opts.view);
  applyTime(opts.time);
  stage.setTiltShift(opts.tilt);
  stage.gtao.enabled = opts.ao;
  window.addEventListener('hashchange', () => {
    const o = parseHash();
    applyView(o.view); applyTime(o.time); ui.setTime(o.time);
    stage.setTiltShift(o.tilt); stage.gtao.enabled = o.ao;
    document.getElementById('tilt').checked = o.tilt;
  });
  window.addEventListener('resize', () => stage.resize(W(), H()));

  // picking: InstancedMesh instanceId -> brick index -> featureId
  const ray = new THREE.Raycaster();
  const sel = new THREE.Box3Helper(new THREE.Box3(), 0xffe066);
  sel.visible = false;
  stage.scene.add(sel);
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const ndc = new THREE.Vector2((e.clientX / W()) * 2 - 1, -(e.clientY / H()) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObjects(built.meshes, false)[0];
    if (!hit) { ui.info(''); sel.visible = false; return; }
    const n = hit.object.userData.owner[hit.instanceId];
    const t = world.types.get(world.type[n]);
    const col = world.palette.get(world.color[n]);
    const f = world.features.get(world.feature[n]);
    const S = world.studM, P = world.plateM;
    const ext = (world.rotFlags[n] & 1) ? [t.d, t.w] : [t.w, t.d];
    sel.box.min.set(world.I[n] * S, world.K[n] * P, -(world.J[n] + ext[1]) * S);
    sel.box.max.set((world.I[n] + ext[0]) * S, (world.K[n] + t.h) * P, -world.J[n] * S);
    sel.visible = true;
    const head = f ? `<b>${escapeHtml(f.name)}</b><span>${escapeHtml(f.kind)}${f.address ? ' · ' + escapeHtml(f.address) : ''}</span>`
      : '<b>No feature</b>';
    ui.info(`${head}<small>${escapeHtml(t.name)} · ${escapeHtml(col?.name ?? '?')} · I${world.I[n]} J${world.J[n]} K${world.K[n]} rot${world.rotFlags[n] & 3}</small>`);
  });

  const r = stage.renderer;
  r.info.autoReset = false;
  let frames = 0, last = performance.now(), fps = 0, acc = 0;
  function frame() {
    controls.update();
    r.info.reset();
    stage.render();
    const now = performance.now();
    acc++;
    if (now - last > 500) { fps = Math.round((acc * 1000) / (now - last)); acc = 0; last = now; }
    ui.stats({ bricks: built.bricks, studs: built.studs, calls: r.info.render.calls, fps });
    if (++frames === 4) window.__bloxReady = true;
    requestAnimationFrame(frame);
  }
  window.__blox = { world, stage, controls, presets, built };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  document.getElementById('info').hidden = false;
  document.getElementById('info').textContent = `Error: ${err.message}`;
  window.__bloxError = String(err.stack || err);
});
