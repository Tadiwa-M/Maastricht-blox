// The smooth toy figure (src/figure/): deterministic variants, human proportions, poses,
// and the draw-call budget of instanced crowds, bikes, cars and props.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makeVariant, sheetVariants } from '../src/figure/variants.js';
import { HAIR_STYLES, TOP_STYLES, BODY, FIGURE_PARTS } from '../src/figure/parts.js';
import { jointAngles, poseFigure, legIK, MODE, SEAT_H } from '../src/figure/rig.js';
import { FigureCrowd } from '../src/figure/crowd.js';
import { VehicleFleet, CAR_TYPES } from '../src/figure/vehicles.js';
import { PropSet } from '../src/figure/props.js';

const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === '_c' ? undefined : x)));

test('variants are deterministic and varied', () => {
  assert.deepEqual(strip(makeVariant(42)), strip(makeVariant(42)));
  assert.notDeepEqual(strip(makeVariant(42)), strip(makeVariant(43)));
  const many = Array.from({ length: 600 }, (_, q) => makeVariant(q + 1));
  for (const s of HAIR_STYLES) assert.ok(many.some((v) => v.hair === s), `hair ${s}`);
  for (const s of TOP_STYLES) assert.ok(many.some((v) => v.top === s), `top ${s}`);
  for (const k of ['adult', 'kid', 'older']) assert.ok(many.some((v) => v.kind === k), k);
  assert.ok(many.some((v) => v.acc === 'backpack') && many.some((v) => v.acc === 'bag'));
  const kids = many.filter((v) => v.kind === 'kid'), old = many.filter((v) => v.kind === 'older');
  assert.ok(Math.max(...old.map((v) => v.speed)) < Math.min(...many.filter((v) => v.kind === 'adult').map((v) => v.speed)) + 0.3);
  assert.ok(old.every((v) => v.stoop >= 0.12), 'older people stoop');
  const sheet = sheetVariants(12);
  assert.equal(sheet.length, 12);
  for (const s of HAIR_STYLES) assert.ok(sheet.some((v) => v.hair === s), `sheet has ${s}`);
  void kids;
});

/** Height of a posed figure: top of its bounding box in world metres. */
function height(v, mode = MODE.IDLE) {
  const box = new THREE.Box3(), P = FIGURE_PARTS();
  const geo = (key) => (key.startsWith('hair:') ? P.hair[key.slice(5)] : key.startsWith('top:') ? P.top[key.slice(4)] : key.startsWith('acc:') ? P.acc[key.slice(4)] : P[key]);
  poseFigure(v, { x: 0, y: 0, z: 0, rotY: 0, mode, t: 0 }, (key, m) => {
    if (key.startsWith('acc:umbrella')) return;
    const g = geo(key); g.computeBoundingBox();
    box.union(g.boundingBox.clone().applyMatrix4(new THREE.Matrix4().fromArray(m)));
  });
  return box;
}

test('human scale: adults 1.70-1.90 m, kids ~1.2 m, slim shoulders, feet on the ground', () => {
  for (let s = 1; s < 60; s++) {
    const v = makeVariant(s);
    const b = height(v);
    if (v.kind === 'kid') assert.ok(b.max.y > 1.05 && b.max.y < 1.35, `kid ${b.max.y}`);
    else assert.ok(b.max.y > 1.68 && b.max.y < 1.95, `${v.kind} ${v.hair} ${b.max.y}`);
    assert.ok(Math.abs(b.min.y) < 0.03, `feet at ${b.min.y}`);
  }
  const a = makeVariant(2, { kind: 'adult' });
  a.acc = 'none';
  const xs = [];
  poseFigure(a, { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE }, (key, m) => { if (key === 'upperArm') xs.push(m[12]); });
  const w = Math.abs(xs[0] - xs[1]) + 2 * 0.053; // across the shoulder balls
  assert.ok(w > 0.4 && w < 0.5, `shoulder width ${w}`);
  const full = height(a);
  assert.ok(full.max.x - full.min.x < 0.62, 'arms hang close to the body');
});

test('poses: walk swings legs, sitting puts the seat at chair height, cycling reaches the pedals', () => {
  const v = makeVariant(5, { kind: 'adult' });
  const a = jointAngles(v, { mode: MODE.WALK, phase: Math.PI / 2, speed: 1.3 });
  assert.ok(a.hip[0] > 0.3 && a.hip[1] < -0.3, 'legs opposite');
  assert.ok(a.sh[0] < 0 && a.sh[1] > 0, 'arms opposite the legs');
  const s = jointAngles(v, { mode: MODE.SIT });
  assert.ok(Math.abs(s.pelvisY * v.scale - (SEAT_H + 0.075 * v.scale)) < 0.01);
  assert.ok(s.hip[0] > 1.3 && s.knee[0] < -1.3);
  const [hip, knee] = legIK(0.1, 0.7);
  const ax = Math.sin(hip) * BODY.thigh + Math.sin(hip + knee) * BODY.shin, ay = Math.cos(hip) * BODY.thigh + Math.cos(hip + knee) * BODY.shin;
  assert.ok(Math.abs(ax - 0.1) < 1e-6 && Math.abs(ay - 0.7) < 1e-6, 'IK reaches the target');
  const c = jointAngles(v, { mode: MODE.CYCLE, phase: 0 });
  assert.ok(c.lean > 0.3 && c.sh[0] > 0.8);
});

test('draw calls and triangles: 1000 instanced figures (two LODs) + bikes + cars + props stay under budget', () => {
  const crowd = new FigureCrowd(1000);
  const fill = (eye) => {
    crowd.begin(eye);
    for (let q = 0; q < 1000; q++) {
      const v = makeVariant(q + 1);
      crowd.add(v, { x: (q % 40) * 2, y: 0, z: Math.floor(q / 40) * 2, rotY: q, mode: q % 5, phase: q, speed: 1.2, t: q });
    }
    crowd.end();
  };
  const tris = () => [...crowd.meshes.values()].reduce((a, e) => a + e.mesh.count * e.mesh.geometry.index.count / 3, 0);
  fill({ x: 40, y: 300, z: 25 }); // overview: everyone far away
  assert.equal(crowd.count, 1000);
  const far = crowd.drawCalls();
  assert.ok(far < 16, `far: ${far} draw calls`);
  assert.ok(tris() < 1.8e6, `far: ${tris()} triangles`);
  fill({ x: 40, y: 1.7, z: 25 }); // street level inside the crowd: the nearest 160 in detail
  const calls = crowd.drawCalls();
  assert.ok(calls <= 38, `street: ${calls} draw calls`);
  assert.equal(crowd.hi, 160);
  assert.ok(tris() < 2.4e6, `street: ${tris()} triangles`);
  const instances = [...crowd.meshes.values()].reduce((a, e) => a + e.mesh.count, 0);
  assert.ok(instances >= 10 * 1000, `${instances} part instances`);
  assert.ok([...crowd.meshes.values()].every((e) => e.mesh.isInstancedMesh));
  const fleet = new VehicleFleet({ bikes: 200, cars: 100 });
  fleet.begin();
  for (let q = 0; q < 200; q++) fleet.addBike(q, 0, 0, q, { colour: '#22385A', spin: q });
  for (let q = 0; q < 100; q++) fleet.addCar(Object.keys(CAR_TYPES)[q % 3], q * 6, 0, 10, 0, { colour: '#A33A2B' });
  fleet.end();
  assert.ok(fleet.drawCalls() <= 9);
  assert.equal(fleet.meshes.get('carWheel').mesh.count, 400);
  const props = new PropSet({});
  props.begin();
  for (let q = 0; q < 50; q++) { props.add('table', q, 0, 0, 0); props.add('chair', q, 0, 1, 0); props.add('stall', q * 4, 0, 9, 0, { colour: q }); }
  props.end();
  assert.ok(calls + fleet.drawCalls() + props.drawCalls() < 60, 'all of city life < 60 draw calls');
  // per-instance colour = the variant's clothing colour (linear)
  crowd.begin(null); const v = makeVariant(9); crowd.add(v, { x: 0, y: 0, z: 0, rotY: 0 }); crowd.end();
  const top = crowd.meshes.get(`top:${v.top}`);
  const c = new THREE.Color(v.colours.top);
  assert.deepEqual([...top.c.slice(0, 3)].map((x) => +x.toFixed(4)), [c.r, c.g, c.b].map((x) => +x.toFixed(4)));
});
