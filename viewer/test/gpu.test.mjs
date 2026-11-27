import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuClass, autoTierFor } from '../src/gpu.js';

test('GPU class from real-world WebGL renderer strings', () => {
  const cases = {
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)': 'software',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)': 'software',
    'llvmpipe (LLVM 15.0.7, 256 bits)': 'software',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)': 'integrated',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)': 'integrated',
    'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)': 'integrated',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)': 'discrete',
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)': 'discrete',
    'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)': 'discrete',
    'Adreno (TM) 740': 'mobile',
    'Mali-G78 MC14': 'mobile',
    'Apple GPU': 'mobile',
    '': 'unknown',
  };
  for (const [s, cls] of Object.entries(cases)) assert.equal(gpuClass(s), cls, s);
});

test('start tiers: software lite, integrated low, others medium', () => {
  assert.equal(autoTierFor('software'), 'lite');
  assert.equal(autoTierFor('integrated'), 'low');
  for (const c of ['mobile', 'discrete', 'unknown']) assert.equal(autoTierFor(c), 'medium');
});
