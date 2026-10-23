// Checks src/rotation.js against the shared vectors in contract/test_vectors/rotation.json,
// plus the three.js placement (src/placement.js) so the rendered geometry agrees with the grid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { FACING, facingToRot, rotatedExtent, footprintCell, frontDir } from '../src/rotation.js';
import { brickMatrix, gridToThree } from '../src/placement.js';

const vectors = JSON.parse(await readFile(new URL('../../contract/test_vectors/rotation.json', import.meta.url)));

test('facing letters map to rot', () => {
  for (const [f, rot] of Object.entries(vectors.facing)) {
    assert.equal(facingToRot(f), rot);
    assert.equal(FACING[f], rot);
  }
  assert.throws(() => facingToRot('X'));
});

test('front direction per rot', () => {
  for (const [rot, dir] of Object.entries(vectors.front_dir)) assert.deepEqual(frontDir(+rot), dir);
});

test(`extent and footprint cells (${vectors.cases.length} cases)`, () => {
  for (const c of vectors.cases) {
    assert.deepEqual(rotatedExtent(c.w, c.d, c.rot), c.extent, JSON.stringify(c));
    for (const [a, b, di, dj] of c.cells) assert.deepEqual(footprintCell(c.w, c.d, c.rot, a, b), [di, dj]);
  }
});

test('three.js brick matrix puts every local cell centre on its footprint cell', () => {
  const S = 0.5, P = 0.2;
  for (const c of vectors.cases) {
    const m = brickMatrix(10, 20, 3, c.w, c.d, c.rot, S, P);
    for (const [a, b, di, dj] of c.cells) {
      // local frame: +x = +i, -z = +j, centred on the unrotated footprint
      const local = new THREE.Vector3((a + 0.5 - c.w / 2) * S, 0, -(b + 0.5 - c.d / 2) * S);
      const got = local.applyMatrix4(m);
      const want = gridToThree(10 + di + 0.5, 20 + dj + 0.5, 3, S, P);
      assert.ok(got.distanceTo(want) < 1e-9, `${JSON.stringify(c)} cell ${a},${b}`);
    }
  }
});

test('front of a rotated piece points along frontDir', () => {
  for (let rot = 0; rot < 4; rot++) {
    const m = brickMatrix(0, 0, 0, 1, 1, rot, 1, 1);
    const front = new THREE.Vector3(0, 0, -1).transformDirection(m); // local front = -z = +j
    const [di, dj] = frontDir(rot);
    assert.ok(Math.abs(front.x - di) < 1e-9 && Math.abs(-front.z - dj) < 1e-9, `rot ${rot}`);
  }
});
