// Motion-captured gait (src/figure/gait.js + gait-data.js from pipeline tools/gait.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../src/figure/gait-data.js';
import { gaitPose, strideAt, WALK, RUN, GAIT_KEYS } from '../src/figure/gait.js';

const TAU = Math.PI * 2;
const range = (speed, key, q) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 64; i++) { const p = gaitPose((i / 64) * TAU, speed); const v = q === undefined ? p[key] : p[key][q]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return [lo, hi];
};

test('data: walk, jog and run tables, every curve complete, credited', () => {
  for (const g of ['walk', 'jog', 'run']) for (const k of GAIT_KEYS) assert.equal(DATA.gaits[g].curves[k].length, DATA.samples, `${g}.${k}`);
  assert.match(DATA.source, /CMU/);
  assert.ok(WALK.speed > 1 && WALK.speed < 1.6 && RUN.speed > 2.8);
});

test('human ranges: knees bend about 65 deg walking and 100 deg running; thighs swing forward more than back', () => {
  const [kw] = range(WALK.speed, 'knee', 0), [kr] = range(RUN.speed, 'knee', 0);
  assert.ok(kw < -0.9 && kw > -1.4, `walk knee ${kw}`);
  assert.ok(kr < -1.5 && kr > -2.1, `run knee ${kr}`);
  const [hlo, hhi] = range(WALK.speed, 'hip', 0);
  assert.ok(hhi > 0.4 && hlo < -0.15 && hhi > -hlo);
});

test('phase convention: left thigh peaks at pi/2, right half a cycle later', () => {
  let best = 0, bi = 0, bestR = 0, bir = 0;
  for (let i = 0; i < 64; i++) {
    const p = gaitPose((i / 64) * TAU, WALK.speed);
    if (p.hip[0] > best) { best = p.hip[0]; bi = i; }
    if (p.hip[1] > bestR) { bestR = p.hip[1]; bir = i; }
  }
  assert.ok(Math.abs(bi - 16) <= 2, `left peak at ${bi}/64`);
  assert.ok(Math.abs(((bir - bi + 64) % 64) - 32) <= 3, `right peak ${bir}/64`);
});

test('the hips swing with the legs and the body bounces twice per cycle', () => {
  const p = gaitPose(Math.PI / 2, WALK.speed); // left leg forward
  assert.ok(p.pelvisYaw < 0, 'left hip forward');
  const [b0, b1] = range(WALK.speed, 'bob');
  assert.ok(b1 - b0 > 0.02 && b1 - b0 < 0.12, `bounce ${b1 - b0} m`);
});

test('speed blends walk to run, ambles below a walk, sprints beyond the run', () => {
  const swing = (s) => { const [a, b] = range(s, 'hip', 0); return b - a; };
  assert.ok(swing(0.5) < swing(WALK.speed));
  assert.ok(swing(RUN.speed) > swing(WALK.speed));
  assert.ok(swing(5) > swing(RUN.speed));
  assert.ok(gaitPose(1, RUN.speed).elbow[0] > 1.2, 'elbows bent when running');
  assert.ok(strideAt(WALK.speed) > 0.6 && strideAt(WALK.speed) < 0.8, `walk stride ${strideAt(WALK.speed)}`);
  assert.ok(strideAt(RUN.speed) > strideAt(WALK.speed));
});
