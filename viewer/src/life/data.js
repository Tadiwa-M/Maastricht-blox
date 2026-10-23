// Loading life data: life/index.json (+ transit, walkways, river) written by
// `blox life --out <world>`. Looked up, in order: window.BLOX_WORLD.life (embedded),
// the #life=<dir> URL parameter, ctx.lifeUrl, then "life/" next to the page.
// Missing data is fine: life falls back to what the world itself offers (fallback.js).

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** Base URL of the life directory (ends with '/'). */
export function lifeBase(ctx, hash = typeof location !== 'undefined' ? location.hash : '') {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  const base = p.get('life') || ctx.lifeUrl || 'life/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** { index, transit, walkways, river } (each may be null), or null when there is no export. */
export async function loadLifeData(ctx) {
  const embedded = typeof window !== 'undefined' ? window.BLOX_WORLD?.life : null;
  if (embedded) return { index: embedded.index || null, transit: embedded.transit || null,
    walkways: embedded.walkways || null, river: embedded.river || null };
  if (typeof fetch === 'undefined') return null;
  const base = lifeBase(ctx);
  let index;
  try { index = await fetchJson(`${base}index.json`); } catch { return null; }
  const out = { index, transit: null, walkways: null, river: null };
  await Promise.all(Object.entries(index.files || {}).map(async ([k, f]) => {
    try { out[k] = await fetchJson(base + f); } catch (e) { console.warn(`life: ${k}: ${e.message}`); }
  }));
  return out;
}
