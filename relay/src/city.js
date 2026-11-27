// The city right now, for the digital-twin side of the game: the Maas (Rijkswaterstaat
// WaterWebservices, ddapi20: level at Sint Pieter, inflow at the border, water temperature at the
// Borgharen weir) and the air (Luchtmeetnet: the two Maastricht stations). Both are open data
// without keys, but neither can be read from a browser page, so the Worker fetches them and
// serves one small answer (GET /city, cached 5 min). Pure parts are tested in test/city.test.mjs.

export const RWS_LATEST = 'https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen';
export const WATER = { level: 'maastricht.sintpieter', inflow: 'eijsden.grens', temp: 'maastricht.borgharen.maas.boven' };
export const AIR_API = 'https://api.luchtmeetnet.nl/open_api';
export const AIR_STATIONS = { NL50007: 'Hoge Fronten', NL50010: 'A2 Philipsweg' };
export const CITY_CACHE_S = 300;
const FRESH_S = 6 * 3600; // older readings are left out (a series that stopped years ago is still "the latest")

/** The request for the latest water height (WATHTE), discharge (Q) and temperature (T) at our three points. */
export function waterRequest() {
  const q = (code) => ({ AquoMetadata: { Compartiment: { Code: 'OW' }, Grootheid: { Code: code } } });
  return { LocatieLijst: [...new Set(Object.values(WATER))].map((Code) => ({ Code })), AquoPlusWaarnemingMetadataLijst: [q('WATHTE'), q('Q'), q('T')] };
}

/**
 * RWS answer -> { levelM (m NAP), inflow (m3/s), tempC, at (unix s of the level) } with null for
 * what is missing. A location has several series per quantity (NAP and the Belgian TAW datum,
 * old ended ones): the newest fresh one counts, and for the level only NAP.
 */
export function parseWater(doc, nowS = Date.now() / 1000) {
  const pick = (loc, quantity, datum = null) => {
    let best = null;
    for (const o of doc?.WaarnemingenLijst || []) {
      const a = o?.AquoMetadata || {};
      if (o?.Locatie?.Code !== loc || a.Grootheid?.Code !== quantity) continue;
      if (datum && a.Hoedanigheid?.Code !== datum) continue;
      for (const m of o.MetingenLijst || []) {
        const v = m?.Meetwaarde?.Waarde_Numeriek, t = Date.parse(m?.Tijdstip) / 1000;
        if (!Number.isFinite(v) || Math.abs(v) >= 1e8 || !Number.isFinite(t) || nowS - t > FRESH_S) continue;
        if (!best || t > best.t) best = { v, t, unit: (a.Eenheid?.Code || '').toLowerCase() };
      }
    }
    return best;
  };
  const level = pick(WATER.level, 'WATHTE', 'NAP'), inflow = pick(WATER.inflow, 'Q'), temp = pick(WATER.temp, 'T');
  if (!level && !inflow && !temp) return null;
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    levelM: level ? Math.round(level.v * (level.unit === 'cm' ? 1 : 100)) / 100 : null,
    inflow: inflow && inflow.v >= 0 ? r1(inflow.v) : null, // a weir pool can read slightly negative: not a flow
    tempC: temp ? r1(temp.v) : null,
    at: Math.round((level || inflow || temp).t),
  };
}

/** Luchtmeetnet measurements page (newest first) -> { pm25, pm10, no2, o3 (ug/m3), at } or null. */
export function parseAir(doc, nowS = Date.now() / 1000) {
  const out = { pm25: null, pm10: null, no2: null, o3: null, at: 0 };
  const keys = { PM25: 'pm25', PM10: 'pm10', NO2: 'no2', O3: 'o3' };
  for (const m of doc?.data || []) {
    const k = keys[m?.formula], t = Date.parse(m?.timestamp_measured) / 1000;
    if (!k || out[k] !== null || !Number.isFinite(m.value) || m.value < 0 || !Number.isFinite(t) || nowS - t > FRESH_S) continue;
    out[k] = Math.round(m.value * 10) / 10;
    out.at = Math.max(out.at, Math.round(t));
  }
  return out.at ? out : null;
}

// hourly values, ug/m3: up to the first is good, up to the second moderate, above it poor
// (the "good" and "moderate" bands of the European air quality index)
const BANDS = { pm25: [10, 25], pm10: [20, 50], no2: [40, 120], o3: [50, 130] };

/** 'good' | 'moderate' | 'poor' for one reading: the worst of its pollutants; null without any. */
export function airLabel(a) {
  let worst = -1;
  for (const [k, [g, m]] of Object.entries(BANDS)) {
    if (!Number.isFinite(a?.[k])) continue;
    worst = Math.max(worst, a[k] <= g ? 0 : a[k] <= m ? 1 : 2);
  }
  return worst < 0 ? null : ['good', 'moderate', 'poor'][worst];
}

/** Fetch both; each part is null if its source failed (the other still answers). fetchImpl: fetch. */
export async function cityNow(fetchImpl = fetch, nowS = Date.now() / 1000) {
  const ua = { 'User-Agent': 'maastricht-blox-relay' };
  const getJson = async (url, init) => {
    const r = await fetchImpl(url, init);
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return r.json();
  };
  const [water, ...air] = await Promise.allSettled([
    getJson(RWS_LATEST, { method: 'POST', headers: { 'Content-Type': 'application/json', ...ua }, body: JSON.stringify(waterRequest()) }).then((d) => parseWater(d, nowS)),
    ...Object.keys(AIR_STATIONS).map((id) => getJson(`${AIR_API}/stations/${id}/measurements?page=1&order_by=timestamp_measured&order_direction=desc`, { headers: ua })
      .then((d) => { const a = parseAir(d, nowS); return a ? { station: AIR_STATIONS[id], ...a, label: airLabel(a) } : null; })),
  ]);
  const stations = air.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
  const rank = { good: 0, moderate: 1, poor: 2 };
  const worst = stations.map((s) => s.label).filter(Boolean).sort((a, b) => rank[b] - rank[a])[0] || null;
  return { at: Math.floor(nowS), water: water.status === 'fulfilled' ? water.value : null,
    air: stations.length ? { label: worst, stations } : null };
}
