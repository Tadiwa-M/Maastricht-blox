import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPACT, impactShake, ImpactSound } from '../src/mp/impact.js';

function fakeContext() {
  const log = { sources: 0 };
  const param = () => ({ setValueAtTime(x, t) { assert.ok(Number.isFinite(x) && t >= 0); }, exponentialRampToValueAtTime(x, t) { assert.ok(x > 0 && Number.isFinite(t), `ramp ${x}`); } });
  const node = (extra = {}) => ({ connect: (n) => n, ...extra });
  const src = () => { log.sources++; return node({ start() {}, stop() {} }); };
  return { log, ac: { sampleRate: 8000, currentTime: 1, destination: node(),
    createGain: () => node({ gain: param() }),
    createOscillator: () => ({ ...src(), frequency: param() }),
    createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }),
    createBufferSource: src,
    createBiquadFilter: () => node({ type: '', frequency: { value: 0 } }) } };
}

test('every impact has a shake and a voice with sane layers', () => {
  for (const [k, e] of Object.entries(IMPACT)) {
    assert.ok(e.shake > 0 && e.len > 0 && e.voice.length > 0, k);
    for (const v of e.voice) { assert.ok(['tone', 'noise'].includes(v.n) && v.len > 0 && v.gain > 0, k); if (v.n === 'tone') assert.ok(v.f0 > 0 && v.f1 > 0, k); }
  }
  assert.ok(IMPACT.down.shake > IMPACT.hurt.shake && IMPACT.hurt.shake > IMPACT.hit.shake, 'heavier events shake harder');
  assert.equal(impactShake('nope'), null);
});

test('every impact builds and plays; muted or unknown plays nothing', () => {
  for (const k of Object.keys(IMPACT)) {
    const { ac, log } = fakeContext();
    assert.equal(new ImpactSound(() => ac).play(k), true, k);
    assert.equal(log.sources, IMPACT[k].voice.length, k);
  }
  const { ac } = fakeContext(), s = new ImpactSound(() => ac);
  assert.equal(s.play('nope'), false);
  globalThis.window = { __bloxAudio: { prefs: { muted: true } } };
  assert.equal(s.play('hit'), false);
  delete globalThis.window;
});
