// Character creator data (src/figure/custom.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHOICES, defaultChoices, customVariant, stepChoice, randomChoices, encodeChoices, decodeChoices,
  loadChoices, saveChoices, STORAGE_KEY, visibleChoices } from '../src/figure/custom.js';
import { poseFigure, MODE } from '../src/figure/rig.js';

test('default choices reproduce a valid figure; every option fits one base-36 digit', () => {
  for (const c of CHOICES) assert.ok(c.values.length <= 36, c.key);
  const ch = defaultChoices();
  for (const c of CHOICES) assert.ok(ch[c.key] >= 0 && ch[c.key] < c.values.length, c.key);
  const v = customVariant(ch);
  let parts = 0;
  poseFigure(v, { x: 0, y: 0, z: 0, rotY: 0, mode: MODE.IDLE }, () => { parts++; });
  assert.ok(parts >= 14);
});

test('choices change the figure: hair, top, colours, size', () => {
  const ch = defaultChoices();
  const hatIdx = CHOICES.find((c) => c.key === 'hair').values.indexOf('cap');
  const v = customVariant({ ...ch, hair: hatIdx, top: CHOICES.find((c) => c.key === 'top').values.indexOf('dress'), height: 6 });
  assert.equal(v.hair, 'cap');
  assert.equal(v.colours.hairTint, v.colours.hat, 'headwear takes the hat colour');
  assert.equal(v.colours.bottom, v.colours.skin, 'a dress shows legs');
  assert.ok(v.scale > 1.05);
  assert.notEqual(customVariant(ch), customVariant(ch), 'a fresh object every time (the crowd caches per variant)');
});

test('stepping wraps; random choices are valid', () => {
  const ch = defaultChoices();
  const n = CHOICES.find((c) => c.key === 'hair').values.length;
  assert.equal(stepChoice({ ...ch, hair: n - 1 }, 'hair', 1).hair, 0);
  assert.equal(stepChoice({ ...ch, hair: 0 }, 'hair', -1).hair, n - 1);
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let q = 0; q < 50; q++) {
    const r = randomChoices(rand);
    for (const c of CHOICES) assert.ok(r[c.key] >= 0 && r[c.key] < c.values.length);
    assert.deepEqual(decodeChoices(encodeChoices(r)), r);
  }
});

test('link and storage: #look= wins, bad codes are ignored', () => {
  const ch = randomChoices(() => 0.7);
  const code = encodeChoices(ch);
  assert.equal(code.length, CHOICES.length + 1);
  assert.deepEqual(loadChoices(`#mode=walk&look=${code}`), ch);
  assert.equal(decodeChoices('zzzz'), null);
  assert.equal(decodeChoices(`b${code.slice(1)}`), null, 'unknown version');
  assert.equal(decodeChoices(`a${'z'.repeat(CHOICES.length)}`), null, 'out of range');
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadChoices('', store), null);
  saveChoices(ch, store);
  assert.equal(mem.get(STORAGE_KEY), code);
  assert.deepEqual(loadChoices('#mode=walk', store), ch);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadChoices('', broken), null);
  assert.equal(saveChoices(ch, broken), false);
});

test('rows that apply: hat colour only with headwear, no trousers under a dress, bag colour only when carrying', () => {
  const idx = (key, val) => CHOICES.find((c) => c.key === key).values.indexOf(val);
  const keys = (ch) => visibleChoices(ch).map((c) => c.key);
  const base = { ...defaultChoices(), hair: idx('hair', 'short'), top: idx('top', 'shirt'), acc: idx('acc', 'none') };
  assert.ok(!keys(base).includes('hatCol') && keys(base).includes('bottomCol') && !keys(base).includes('accCol'));
  const dressed = { ...base, hair: idx('hair', 'cap'), top: idx('top', 'dress'), acc: idx('acc', 'backpack') };
  assert.ok(keys(dressed).includes('hatCol') && !keys(dressed).includes('bottomCol') && keys(dressed).includes('accCol'));
});
