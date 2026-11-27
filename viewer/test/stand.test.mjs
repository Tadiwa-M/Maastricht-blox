// The manga look's Stand (src/player/stand.js): shows when wanted, a rush throws punches for its length.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Stand, STAND } from '../src/player/stand.js';

test('the Stand fades in when wanted, and a rush lands punches in front of the player for its length', () => {
  const s = new Stand(new THREE.Scene());
  for (let k = 0; k < 30; k++) s.update(1 / 30, [0, 0, 0], 0, true);
  assert.ok(s.group.visible && s.k > 0.9);
  const hits = [];
  assert.equal(s.rush(), true); assert.equal(s.rush(), false, 'one rush at a time');
  for (let t = 0; t < STAND.rushS + 0.2; t += 1 / 60) s.update(1 / 60, [0, 0, 0], 0, false, (p) => hits.push(p));
  assert.ok(hits.length >= 12, `${hits.length} punches`);
  assert.ok(hits.every((p) => p[2] < -1), 'in front (north, -z) of a player facing north');
  for (let k = 0; k < 120; k++) s.update(1 / 30, [0, 0, 0], 0, false);
  assert.equal(s.group.visible, false, 'gone again');
});
