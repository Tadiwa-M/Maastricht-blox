// Motion-captured gait for the figure rig: samples the stride-cycle tables in gait-data.js
// (pipeline/src/blox_pipeline/tools/gait.py, from the CMU Graphics Lab Motion Capture Database)
// at a phase and speed. Pure; used by rig.js for every walking figure (player and crowds).
//
// Two gaits drive everything: walk (1.3 m/s) and run (the jog and run tables averaged, 3.3 m/s).
// Between them the curves blend by speed. Slower than a walk the swings shrink toward the mean
// pose (an amble); faster than the run they grow a little (a sprint). The brick-game feel layer
// (FEEL) exaggerates on top: a bit more arm swing and bounce than a real person, as toys move.

import DATA from './gait-data.js';
import { BODY } from './parts.js';

export const GAIT_KEYS = ['hip0', 'hip1', 'knee0', 'knee1', 'ankle0', 'ankle1', 'sh0', 'sh1', 'abd0', 'abd1',
  'elbow0', 'elbow1', 'lean', 'bob', 'pelvisYaw', 'chestYaw', 'pelvisRoll'];

/** Brick-game exaggeration over the captured motion (1 = as captured). */
export const FEEL = { arms: 1.25, bounce: 1.3, hips: 0.5, lean: 0.7, legs: [1.06, 1.22] }; // legs: thigh swing gain at a walk / a run (longer steps, calmer cadence); // hips: the captured twist and drop read oddly on a blocky hip piece

const N = DATA.samples;
const LEG = BODY.thigh + BODY.shin; // metres at scale 1

function table(g) {
  const curves = {};
  for (const k of GAIT_KEYS) curves[k] = Float32Array.from(g.curves[k]);
  const mean = {};
  for (const k of GAIT_KEYS) mean[k] = curves[k].reduce((a, b) => a + b, 0) / N;
  return { speed: g.speed, stride: g.stride * LEG, curves, mean };
}

function average(a, b) {
  const curves = {}, mean = {};
  for (const k of GAIT_KEYS) {
    curves[k] = a.curves[k].map((x, i) => (x + b.curves[k][i]) / 2);
    mean[k] = (a.mean[k] + b.mean[k]) / 2;
  }
  return { speed: (a.speed + b.speed) / 2, stride: (a.stride + b.stride) / 2, curves, mean };
}

export const WALK = table(DATA.gaits.walk);
export const RUN = DATA.gaits.jog ? average(table(DATA.gaits.jog), table(DATA.gaits.run)) : table(DATA.gaits.run);

/** Metres per step at a speed (scale 1) as captured: interpolated between the gaits, extrapolated beyond. */
export function capturedStride(speed) {
  const u = (speed - WALK.speed) / (RUN.speed - WALK.speed);
  const s = WALK.stride + (RUN.stride - WALK.stride) * u;
  return Math.max(0.45, Math.min(1.7, s));
}

// Feet that don't skate: the stride is measured on the posed legs, not assumed. While a foot is
// on the ground it must stand still in the world, so the body has to advance exactly as fast as
// that foot moves back under the hip. For a table of speeds, the backward travel of the
// planted ankle per radian of phase (forward kinematics of the same angles the rig draws) gives
// the metres per step that pin the stance foot (the median: least total slide); strideAt() interpolates it. A run's flight phase
// needs no special case: only the planted part of the cycle is measured.
const STRIDE_SPEEDS = [0.2, 0.45, 0.7, 1.0, 1.3, 1.7, 2.2, 2.8, 3.3, 4.0, 4.8, 5.6, 6.5];
let STRIDES = null;

function measureStride(speed) {
  const T = BODY.thigh, S = BODY.shin, M = 64, J = {};
  const fwd = new Float64Array(M + 1), low = new Float64Array(M + 1);
  let floor = Infinity;
  for (let i = 0; i <= M; i++) {
    gaitPose((i / M) * 2 * Math.PI, speed, J);
    const a = J.hip[0], b = a + J.knee[0];
    fwd[i] = T * Math.sin(a) + S * Math.sin(b) + BODY.hipX * Math.sin(J.pelvisYaw); // the pelvis twist carries the hip joint
    low[i] = J.bob - T * Math.cos(a) - S * Math.cos(b);
    floor = Math.min(floor, low[i]);
  }
  let top = -Infinity;
  for (let i = 0; i < M; i++) top = Math.max(top, low[i]);
  const near = floor + 0.15 * (top - floor), h = M / 2; // the other foot is half a cycle away
  const steps = []; // backward travel of the planted ankle per sample
  for (let i = 0; i < M; i++) { // planted: the lower foot, near the ground
    if (low[i] > near || low[i + 1] > near || low[i] > low[(i + h) % M]) continue;
    steps.push(fwd[i] - fwd[i + 1]);
  }
  if (steps.length < 3) return capturedStride(speed);
  // least total slide = the median planted speed (a mean would chase the heel strike and toe-off)
  steps.sort((p, q) => p - q);
  return Math.max(0.15, steps[steps.length >> 1] * (M / 2));
}

/** Metres per step at a speed (scale 1) that keep the planted foot still (see above). */
export function strideAt(speed) {
  if (!STRIDES) STRIDES = STRIDE_SPEEDS.map(measureStride);
  const X = STRIDE_SPEEDS, n = X.length;
  if (!(speed > X[0])) return STRIDES[0];
  if (speed >= X[n - 1]) return capturedStride(speed);
  let q = 1;
  while (X[q] < speed) q++;
  const pinned = STRIDES[q - 1] + (STRIDES[q] - STRIDES[q - 1]) * ((speed - X[q - 1]) / (X[q] - X[q - 1]));
  // from a jog up the captured stride slides no more and keeps the calmer captured cadence
  const k = Math.max(0, Math.min(1, (speed - 1.0) / 1.5));
  return pinned + (capturedStride(speed) - pinned) * k;
}

function sample(c, f) {
  const i = Math.floor(f), t = f - i;
  const a = c[((i % N) + N) % N], b = c[(((i + 1) % N) + N) % N];
  return a + (b - a) * t;
}

/**
 * Captured joint angles at a phase (radians, 2pi per two steps; the left thigh peaks at pi/2) and
 * speed (m/s). Writes into out (pairs as [left, right]); returns out with scalar lean (rad),
 * bob (metres at scale 1), pelvisYaw, chestYaw, pelvisRoll.
 */
export function gaitPose(phase, speed, out = {}) {
  const f = (((phase / (2 * Math.PI)) % 1) + 1) % 1 * N;
  const u = Math.max(0, Math.min(1, (speed - WALK.speed) / (RUN.speed - WALK.speed)));
  // swing amplitude: an amble below walking pace, a sprint beyond the run
  const amp = speed < WALK.speed ? Math.max(0.4, (speed / WALK.speed) ** 0.6) : speed > RUN.speed ? 1 + Math.min(0.3, (speed - RUN.speed) * 0.12) : 1;
  const val = (k) => {
    const w = sample(WALK.curves[k], f), r = sample(RUN.curves[k], f);
    const m = WALK.mean[k] + (RUN.mean[k] - WALK.mean[k]) * u;
    return m + (w + (r - w) * u - m) * amp;
  };
  for (const k of ['hip', 'knee', 'ankle', 'sh', 'abd', 'elbow']) {
    const p = out[k] || (out[k] = [0, 0]);
    p[0] = val(`${k}0`); p[1] = val(`${k}1`);
  }
  // longer steps: the thighs swing a little wider about their mean, more so in a run
  const legs = FEEL.legs[0] + (FEEL.legs[1] - FEEL.legs[0]) * u;
  for (const q of [0, 1]) {
    const m = WALK.mean[`hip${q}`] + (RUN.mean[`hip${q}`] - WALK.mean[`hip${q}`]) * u;
    out.hip[q] = m + (out.hip[q] - m) * legs;
  }
  // feel layer: arms swing wider (about their mean), more bounce, hips sway a touch more
  for (const q of [0, 1]) {
    const m = WALK.mean[`sh${q}`] + (RUN.mean[`sh${q}`] - WALK.mean[`sh${q}`]) * u;
    out.sh[q] = m + (out.sh[q] - m) * FEEL.arms;
    out.abd[q] = Math.max(0.06, out.abd[q] + 0.04);
  }
  out.lean = val('lean') * FEEL.lean;
  out.bob = val('bob') * LEG * FEEL.bounce;
  out.pelvisYaw = val('pelvisYaw') * FEEL.hips;
  out.chestYaw = val('chestYaw');
  out.pelvisRoll = val('pelvisRoll') * FEEL.hips;
  return out;
}
