import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { blockMeshes, showBlock } from '../src/farregion.js';

const sx = 4, sy = 0.6;
function fakeRegion(key, gi0, gj0, gk0, quads) {
  const n = quads * 4;
  const position = new Uint16Array(n * 3).map((_, q) => (q * 7) % 50);
  const index = new Uint16Array(quads * 6).map((_, q) => q % n);
  const arrays = { position, normal: new Int8Array(n * 3), color: new Uint16Array(n * 3), extra: new Uint8Array(n * 4), index };
  return { reg: { key }, arrays: { families: new Map([['opaque', { arrays }]]), position: [gi0 * sx, gk0 * sy, -gj0 * sx], scale: [sx, sy, -sx] } };
}
const mats = { cityFar: () => new THREE.MeshBasicMaterial() };
const world = (obj, p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(obj.matrixWorld);

test('a merged block puts every vertex where its own region mesh would', () => {
  const items = [fakeRegion('0,0', 0, 0, 3, 5), fakeRegion('1,0', 64, 0, 1, 3), fakeRegion('0,1', 0, 64, 7, 4)];
  const built = blockMeshes(items, mats);
  const { mesh, ranges } = built.parts[0];
  const pos = mesh.geometry.attributes.position.array;
  let v = 0;
  for (const it of items) {
    const g = new THREE.Group();
    g.position.fromArray(it.arrays.position); g.scale.fromArray(it.arrays.scale); g.updateMatrixWorld(true);
    const a = it.arrays.families.get('opaque').arrays;
    for (let q = 0; q < a.position.length / 3; q++, v++) {
      const want = world(g, [a.position[q * 3], a.position[q * 3 + 1], a.position[q * 3 + 2]]);
      const got = world(built.group, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
      assert.ok(want.distanceTo(got) < 1e-6, `${it.reg.key} vertex ${q}`);
    }
    assert.equal(ranges.get(it.reg.key).count, a.index.length);
  }
  const idx = mesh.geometry.index.array, r1 = ranges.get('1,0');
  assert.equal(idx[r1.start], items[1].arrays.families.get('opaque').arrays.index[0] + 20); // after region 0's 20 vertices
});

test('showBlock draws contiguous visible regions as one group', () => {
  const items = [fakeRegion('a', 0, 0, 0, 2), fakeRegion('b', 64, 0, 0, 2), fakeRegion('c', 128, 0, 0, 2)];
  const built = blockMeshes(items, mats);
  assert.deepEqual(showBlock(built, new Set(['a', 'b', 'c'])), { triangles: 12, groups: 1 });
  assert.deepEqual(showBlock(built, new Set(['a', 'c'])), { triangles: 8, groups: 2 });
  assert.deepEqual(showBlock(built, new Set()), { triangles: 0, groups: 0 });
  assert.equal(built.parts[0].mesh.visible, false);
});
