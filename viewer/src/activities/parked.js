// The parked bikes the player can take. Life keeps them as `window.__bloxLife.parked`
// ({ bikes, racks } from life/cyclists.js parkedBikes) when it shares them; then a taken bike
// leaves its rack (marked `gone`, moved off the map) and is put back wherever the player leaves
// it, drawn by life as before. Without that, the same rows are rebuilt here from
// life/streets.json (same seed, so the same bikes) and the bikes the player leaves are drawn by
// the activities themselves.
import { lifeBase } from '../life/data.js';
import { parkedBikes } from '../life/cyclists.js';

async function streetsDoc(ctx) {
  const embedded = typeof window !== 'undefined' ? window.BLOX_WORLD?.life : null;
  if (embedded) return embedded.streets || null;
  if (typeof fetch === 'undefined') return null;
  try {
    const base = lifeBase(ctx);
    const index = await (await fetch(`${base}index.json`)).json();
    const f = index.files?.streets;
    return f ? await (await fetch(base + f)).json() : null;
  } catch { return null; }
}

/** -> { bikes, shared } : shared = life draws them (moving an entry moves the drawn bike). */
export async function parkedSource(ctx, life) {
  if (life?.parked?.bikes) return { bikes: life.parked.bikes, shared: true };
  const streets = await streetsDoc(ctx);
  const box = ctx.box || null;
  const rect = box ? [box.min.x, -box.max.z, box.max.x, -box.min.z] : null;
  const spots = (streets?.bikes || []).filter(([x, z]) => !rect || (x > rect[0] && x < rect[2] && z > rect[1] && z < rect[3]));
  return { bikes: parkedBikes(spots).bikes, shared: false };
}
