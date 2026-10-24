// Look-v2 pieces (src/details-look.js, CONTRACT 2.1 ids 48-56): every catalogue piece gets near
// geometry inside its box (small overhangs allowed where the contract says so) and cheap far
// polygons; panes of the new windows and lamp lanterns are a separate glass part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detailGeometry } from '../src/details.js';
import { LOOK_PIECES } from '../src/details-look.js';
import { farPiece } from '../src/farmesh.js';

const cat = JSON.parse(readFileSync(new URL('../../contract/brick_catalogue.json', import.meta.url), 'utf8'));
const S = 0.5, P = 0.2;
const OVERHANG = { chain_1x4: 0.16, lamp_double_1x3: 0.0, bollard_1x1: 0.0 }; // chain reaches into the bollards' eyes

test('every look-v2 piece is in the catalogue and has a builder', () => {
  const names = new Set(cat.types.map((t) => t.name));
  for (const n of LOOK_PIECES) assert.ok(names.has(n), n);
  for (const t of cat.types.filter((t) => t.id >= 48)) assert.ok(LOOK_PIECES.includes(t.name), t.name);
});

test('look-v2 near geometry stays in its box (front at -z) and windows have glass', () => {
  for (const t of cat.types.filter((t) => LOOK_PIECES.includes(t.name))) {
    const g = detailGeometry(t, S, P);
    assert.ok(g && g.body.attributes.position.count > 0, t.name);
    g.body.computeBoundingBox();
    const b = g.body.boundingBox, W = t.w * S, D = t.d * S, H = t.h * P, e = 0.02 + (OVERHANG[t.name] ?? 0);
    assert.ok(b.min.x >= -W / 2 - e && b.max.x <= W / 2 + e, `${t.name} x ${b.min.x}..${b.max.x}`);
    assert.ok(b.min.y >= -1e-6 && b.max.y <= H + 0.02, `${t.name} y`);
    assert.ok(b.min.z >= -D / 2 - 0.02 && b.max.z <= D / 2 + 0.02, `${t.name} z`);
    if (t.kind === 'window' || t.name === 'lamp_double_1x3') assert.ok(g.glass, `${t.name} glass`);
  }
});

test('look-v2 far templates are small sets of polygons inside the box', () => {
  for (const t of cat.types.filter((t) => LOOK_PIECES.includes(t.name))) {
    const polys = farPiece(t, S, P);
    assert.ok(polys.length >= 4 && polys.length <= 40, `${t.name} ${polys.length}`);
    const W = t.w * S, D = t.d * S, H = t.h * P;
    for (const p of polys) for (const [x, y, z] of p.pts) {
      assert.ok(Math.abs(x) <= W / 2 + 0.13 && y >= -1e-6 && y <= H + 1e-6 && Math.abs(z) <= D / 2 + 0.01, t.name);
    }
  }
});
