// Far-LOD mesh builder (src/farmesh.js): hidden-face culling counts on tiny hand-made worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { occupancyGrid } from '../src/exterior.js';
import { buildFarGeometry, cellCodeOf, farPiece } from '../src/farmesh.js';

const meta = {
  palette: { entries: [
    { idx: 1, name: 'red', srgb: '#ff0000', material: 'solid' },
    { idx: 2, name: 'glass', srgb: '#223344', material: 'glass' },
    { idx: 3, name: 'water', srgb: '#2255aa', material: 'trans' },
  ] },
  catalogue: { types: [
    { id: 1, name: 'brick_1x1', kind: 'brick', w: 1, d: 1, h: 3, studs: 'all' },
    { id: 2, name: 'brick_1x2', kind: 'brick', w: 1, d: 2, h: 3, studs: 'all' },
    { id: 3, name: 'slope45_1x2', kind: 'slope', w: 1, d: 2, h: 3, studs: 'backRows', studRows: 1 },
    { id: 4, name: 'window_1x2x3', kind: 'window', w: 2, d: 1, h: 9, studs: 'all' },
  ] },
};
const classOf = (e) => (e?.material === 'trans' && /^water/.test(e.name) ? 'water' : e?.material || 'solid');

function far(records) {
  const w = World.fromRecords(meta, records);
  const codeOf = cellCodeOf(w, classOf);
  const grid = occupancyGrid(w, codeOf);
  const style = (n, part) => ({ key: part === 'glass' ? 'glass' : classOf(w.palette.get(w.color[n])), color: { r: 1, g: 0, b: 0 } });
  const all = Array.from({ length: w.count }, (_, n) => n);
  return buildFarGeometry(w, all, { code: grid.code, codeOf, style });
}

test('a lone brick: 5 faces (the bottom lies on the ground plane), 10 triangles', () => {
  const r = far([{ I: 0, J: 0, K: 0, type: 1, color: 1 }]);
  assert.equal(r.faces, 6);
  assert.equal(r.culled, 1);
  assert.equal(r.triangles, 10);
});

test('two touching bricks lose the shared faces', () => {
  const r = far([{ I: 0, J: 0, K: 0, type: 1, color: 1 }, { I: 1, J: 0, K: 0, type: 1, color: 1 }]);
  assert.equal(r.triangles, 2 * 4 * 2); // each keeps top + 3 sides
});

test('a solid 3x3x3 block keeps only its 45 outer faces (bottom on the ground)', () => {
  const recs = [];
  for (let I = 0; I < 3; I++) for (let J = 0; J < 3; J++) for (const K of [0, 3, 6]) recs.push({ I, J, K, type: 1, color: 1 });
  const r = far(recs);
  assert.equal(r.faces, 27 * 6);
  assert.equal(r.triangles, (9 * 4 + 9) * 2); // 4 walls of 9 + the roof
});

test('faces looking into closed interior air are culled', () => {
  // 3x3 floor, ring wall, 3x3 roof: the centre cell at K=3 is sealed air
  const recs = [];
  for (let I = 0; I < 3; I++) for (let J = 0; J < 3; J++) for (const K of [0, 6]) recs.push({ I, J, K, type: 1, color: 1 });
  for (let I = 0; I < 3; I++) for (let J = 0; J < 3; J++) if (I !== 1 || J !== 1) recs.push({ I, J, K: 3, type: 1, color: 1 });
  const r = far(recs);
  assert.equal(r.triangles, (9 * 4 + 9) * 2); // same as the solid block
});

test('stacked glass reads as one pane; an opaque face behind trans water is kept', () => {
  const glass = far([{ I: 0, J: 0, K: 0, type: 1, color: 2 }, { I: 0, J: 0, K: 3, type: 1, color: 2 }]);
  assert.equal(glass.triangles, (4 + 4 + 1) * 2);
  const water = far([{ I: 0, J: 0, K: 0, type: 1, color: 1 }, { I: 1, J: 0, K: 0, type: 1, color: 3 }]);
  // red's +x face is kept (water is see-through), water's -x face is hidden (red is opaque)
  assert.equal(water.triangles, (5 + 4) * 2);
  assert.equal(water.culled, 2 + 1);
});

test('slope: prism with 2 caps; caps against full bricks are culled', () => {
  const t = meta.catalogue.types[2];
  const polys = farPiece(t, 0.5, 0.2);
  assert.equal(polys.length, 2 + 5); // two caps + bottom, back, top, incline, lip
  const r = far([{ I: 0, J: 0, K: 0, type: 3, color: 1 }, { I: 1, J: 0, K: 0, type: 2, color: 1 }, { I: -1, J: 0, K: 0, type: 2, color: 1 }]);
  // slope keeps back, top, incline, lip (4 quads, caps and bottom culled); the bricks keep
  // their faces toward the slope (a slope does not hide a whole face): 5 faces each
  assert.equal(r.triangles, 4 * 2 + 2 * 5 * 2);
  assert.equal(r.culled, 3 + 2);
});

test('window: frame box + a glass quad in front, in its own material key', () => {
  const r = far([{ I: 0, J: 0, K: 0, type: 4, color: 1 }]);
  assert.deepEqual([...r.geometries.keys()].sort(), ['glass', 'solid']);
  assert.equal(r.geometries.get('glass').index.count, 6);
});
