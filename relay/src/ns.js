// NS Reisinformatie API (needs a free key from apiportal.ns.nl: product "Ns-App") -> departures
// with live delays for the Maastricht stations. Pure parts are exported for test/ns.test.mjs.

export const NS_DEPARTURES = 'https://gateway.apiportal.ns.nl/reisinformatie-api/api/v2/departures';
export const STATIONS = { MT: 'Maastricht', MTR: 'Maastricht Randwyck', MTN: 'Maastricht Noord' };

/** "MT,MTR" -> known station codes only. */
export function stationCodes(param) {
  const want = String(param || 'MT,MTR').toUpperCase().split(',').map((s) => s.trim());
  return [...new Set(want.filter((c) => c in STATIONS))];
}

/** NS departures payload -> [{ train, direction, planned, actual, delay (s), track, cancelled }]. */
export function departures(doc) {
  return (doc?.payload?.departures || []).map((d) => {
    const planned = Date.parse(d.plannedDateTime), actual = Date.parse(d.actualDateTime || d.plannedDateTime);
    return { train: d.product?.number || d.name || '', direction: d.direction || '', planned: d.plannedDateTime,
      actual: d.actualDateTime || d.plannedDateTime, delay: Number.isFinite(actual - planned) ? Math.round((actual - planned) / 1000) : 0,
      track: d.actualTrack || d.plannedTrack || '', cancelled: !!d.cancelled, operator: d.product?.operatorName || '' };
  });
}
