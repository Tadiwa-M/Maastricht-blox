// Crowd density by quality tier (src/life/density.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('every quality tier keeps the same crowd density near you; only the radius changes', async () => {
  const { FIGURES_BY_TIER, CARS_BY_TIER, CYCLISTS_BY_TIER, LIFE_RADIUS_BY_TIER } = await import('../src/life/density.js');
  for (const table of [FIGURES_BY_TIER, CARS_BY_TIER, CYCLISTS_BY_TIER]) {
    const dens = Object.keys(LIFE_RADIUS_BY_TIER).map((t) => table[t] / (Math.PI * LIFE_RADIUS_BY_TIER[t] ** 2));
    for (const d of dens) assert.ok(Math.abs(d / dens[0] - 1) < 0.1, `densities ${dens.map((x) => x.toExponential(2))}`);
  }
});
