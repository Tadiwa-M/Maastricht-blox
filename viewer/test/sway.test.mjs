// Leaves in the wind (src/materials.js addSway, src/bricks.js): which bricks move, and how much.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BrickBatcher, isLeaf } from '../src/bricks.js';
import { MaterialSet, swayAmp, SWAY } from '../src/materials.js';

test('only the leaf colours sway', () => {
  assert.ok(isLeaf({ name: 'leaf', material: 'solid' }) && isLeaf({ name: 'leaf_light', material: 'solid' }));
  for (const name of ['grass', 'grass_dark', 'trunk', 'dark_green', 'brick_red']) assert.ok(!isLeaf({ name, material: 'solid' }), name);
  assert.ok(!isLeaf(null));
});

test('more wind, more drift, up to a cap; still air still breathes', () => {
  assert.ok(swayAmp(0) > 0 && swayAmp(0) < 0.02);
  assert.ok(swayAmp(30) > swayAmp(10));
  assert.equal(swayAmp(500), SWAY.max);
  assert.equal(swayAmp(undefined), SWAY.calm);
});

test('leaf bricks and their studs carry the sway flag; other bricks share no mesh with them', () => {
  const mats = new MaterialSet();
  const batch = new BrickBatcher(mats, 0.5, 0.2, true);
  const t = { name: 'brick_1x1', w: 1, d: 1, h: 3, kind: 'brick' };
  const leaf = { idx: 28, name: 'leaf', srgb: '#4C7F34', material: 'solid' }, wall = { idx: 4, name: 'brick_red', srgb: '#A33A2B', material: 'solid' };
  batch.addBrick({ I: 0, J: 0, K: 20, t, rot: 0, entry: leaf });
  batch.addBrick({ I: 1, J: 0, K: 20, t, rot: 0, entry: leaf });
  batch.addBrick({ I: 5, J: 0, K: 0, t, rot: 0, entry: wall });
  batch.addStud(0.5, 0.5, 23, leaf, new THREE.Color('#4C7F34'));
  const { meshes } = batch.build();
  const swaying = meshes.filter((m) => m.geometry.getAttribute('aSway'));
  assert.equal(swaying.length, 2, 'the leaf bricks and the leaf stud');
  for (const m of swaying) assert.ok([...m.geometry.getAttribute('aSway').array].every((v) => v === 1));
  const still = meshes.filter((m) => !m.geometry.getAttribute('aSway'));
  assert.equal(still.length, 1);
  assert.equal(still[0].count, 1, 'the wall brick alone');
});
