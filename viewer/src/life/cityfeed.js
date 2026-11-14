// The city right now, from the relay's /city (relay/src/city.js): the Maas (level at Sint
// Pieter in m NAP, inflow at the border in m3/s, water temperature) and the air at the two
// Maastricht stations. Polled every POLL_S; shown in the status line and on the pause page, and
// published as window.__bloxLife.city for whatever wants it next (river height, haze).
// Without a relay nothing is asked. The text is pure (test/life.cityfeed.test.mjs).

export const POLL_S = 600, STALE_S = 3 * 3600;
// the Maas at Sint Pieter: the weir pool is held near 44.1 m NAP; from about 1000 m3/s the
// river is high, from 1500 the quays in the centre start to flood
export const MAAS = { high: 1000, flood: 1500 };

/** 'normal' | 'high' | 'flood' from the inflow (m3/s), or null. */
export function maasState(inflow) {
  if (!Number.isFinite(inflow)) return null;
  return inflow >= MAAS.flood ? 'flood' : inflow >= MAAS.high ? 'high' : 'normal';
}

/** One line for people: "Maas 44.07 m · 48 m³/s · 10 °C · air moderate" (only what is known). */
export function cityText(c) {
  if (!c) return '';
  const w = c.water, parts = [];
  if (w) {
    const bits = [];
    if (Number.isFinite(w.levelM)) bits.push(`${w.levelM.toFixed(2)} m`);
    if (Number.isFinite(w.inflow)) bits.push(`${Math.round(w.inflow)} m³/s`);
    if (Number.isFinite(w.tempC)) bits.push(`${Math.round(w.tempC)} °C`);
    const st = maasState(w.inflow);
    if (bits.length) parts.push(`Maas ${bits.join(' · ')}${st && st !== 'normal' ? ` (${st === 'flood' ? 'flood level' : 'high water'})` : ''}`);
  }
  if (c.air?.label) parts.push(`air ${c.air.label}`);
  return parts.join(' · ');
}

export class CityFeed {
  constructor(relay, fetchImpl = (...a) => fetch(...a)) {
    this.url = `${String(relay || '').replace(/\/$/, '')}/city`;
    this.fetch = fetchImpl;
    this.now = null; this.at = 0;
  }

  /** One poll; a failure keeps the last answer for STALE_S, then forgets it. Never throws. */
  async poll(nowS = Date.now() / 1000) {
    try {
      const r = await this.fetch(this.url);
      if (!r.ok) throw new Error(`city ${r.status}`);
      const c = await r.json();
      if (!c || (!c.water && !c.air)) throw new Error('city: nothing known');
      this.now = c; this.at = nowS;
    } catch {
      if (nowS - this.at > STALE_S) this.now = null;
    }
    return this.now;
  }

  start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_S * 1000);
  }
}
