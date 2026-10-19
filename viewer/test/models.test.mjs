// Brick models (src/models.js): every contract/models/*.json must load in the viewer.
// Checks that each named part becomes a hinge group, that the model's bounding box matches
// its declared size, and that the model stands on its pivot (ground centre) facing -z.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildModel } from '../src/models.js';
import { MaterialSet } from '../src/materials.js';

const contract = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contract');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const palette = new Map(readJson(join(contract, 'palette.json')).entries.map((e) => [e.idx, e]));
const types = new Map(readJson(join(contract, 'brick_catalogue.json')).types.map((t) => [t.id, t]));
const files = readdirSync(join(contract, 'models')).filter((f) => f.endsWith('.json'));

test('contract has brick models', () => assert.ok(files.length >= 3));

for (const f of files) {
  test(`model ${f} builds with its parts and size`, () => {
    const model = readJson(join(contract, 'models', f));
    const obj = buildModel(model, { palette, types, mats: new MaterialSet() });
    assert.deepEqual(Object.keys(obj.userData.parts).sort(), Object.keys(model.parts || {}).sort());
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const [w, d, h] = model.size, [px, py, pz] = model.pivot;
    const eps = 0.06; // studs poke out above the box; allow small bevel/stud slack
    assert.ok(Math.abs(box.min.x - -px * 0.5) < eps, `${f} min x ${box.min.x}`);
    assert.ok(Math.abs(box.max.x - (w - px) * 0.5) < eps, `${f} max x ${box.max.x}`);
    // +j (model forward) is -z in three.js
    assert.ok(Math.abs(box.max.z - py * 0.5) < eps, `${f} max z ${box.max.z}`);
    assert.ok(Math.abs(box.min.z - -(d - py) * 0.5) < eps, `${f} min z ${box.min.z}`);
    assert.ok(Math.abs(box.min.y - -pz * 0.2) < eps, `${f} min y ${box.min.y}`);
    assert.ok(box.max.y <= (h - pz) * 0.2 + 0.2, `${f} max y ${box.max.y}`);
  });
}
