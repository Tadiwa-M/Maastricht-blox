// The rig's manga proportions and stand poses (src/figure/rig.js).
import test from 'node:test';
import assert from 'node:assert/strict';

test('manga proportions: longer legs keep the feet on the ground; a stand pose twists the body', async () => {
  const { setProportions, PROPORTION, IDLE, MODE: M2, captureParts: cap } = await import('../src/figure/rig.js');
  const { STYLES, STAND_POSES } = await import('../src/figure/lookstyle.js');
  const { makeVariant } = await import('../src/figure/variants.js');
  const v = makeVariant(5, { kind: 'adult' });
  const lowest = (parts) => Math.min(...parts.filter((p) => p.key === 'shoe').map((p) => p.mat[13]));
  const plain = lowest(cap(v, { x: 0, y: 0, z: 0, mode: M2.IDLE, t: 0 }));
  setProportions({ shoulder: 1.3, chest: 1.24, waist: 0.86, leg: 1.12, head: 0.86, arm: 1.07, style: STYLES.manga });
  const hero = lowest(cap(v, { x: 0, y: 0, z: 0, mode: M2.IDLE, t: 0 }));
  assert.ok(Math.abs(hero - plain) < 0.05, `feet ${plain} -> ${hero}`);
  const posed = cap(v, { x: 0, y: 0, z: 0, mode: M2.IDLE, idle: IDLE.POSE, idleK: 1, poseKind: 1, t: 0 });
  assert.ok(posed.length > 10 && STAND_POSES.length >= 3);
  const hand = (parts) => parts.filter((p) => p.key === 'hand').map((p) => [p.mat[12], p.mat[13]]);
  assert.notDeepEqual(hand(posed), hand(cap(v, { x: 0, y: 0, z: 0, mode: M2.IDLE, t: 0 })), 'the pose moves the hands');
  setProportions({ shoulder: 1, chest: 1, waist: 1, leg: 1, head: 1, arm: 1, style: null });
  assert.equal(PROPORTION.leg, 1);
});
