import test from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_FX, titlePalette, startTitleFx } from '../src/titlefx.js';

test('every look has three inks and a leak colour in 0..1', () => {
  for (const look of ['classic', 'verse', 'manga']) {
    const p = titlePalette(look);
    assert.equal(p.colors.length, 3, look);
    for (const c of [...p.colors, p.leak]) for (const v of c) assert.ok(v >= 0 && v <= 1, look);
  }
  assert.equal(titlePalette('nope'), TITLE_FX.classic);
});

test('no canvas, no window or no WebGL: a no-op handle, never a throw', () => {
  assert.doesNotThrow(() => startTitleFx(null).stop());
  assert.doesNotThrow(() => startTitleFx({ getContext: () => null }, 'verse', {}).stop());
  assert.doesNotThrow(() => startTitleFx({ getContext: () => { throw new Error('blocked'); } }, 'manga', {}).stop());
});
