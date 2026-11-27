// Bus liveries by operator (GTFS agency_id, exported per route by `blox life`). Liveries are
// not palette colours on purpose: a bus has to look like the real thing (Maastricht's city
// buses are Arriva's, and they are blue), and movers may use colours outside the palette
// (docs/guide/05-movers-and-models.md, "Colours of movers"). The route colour stays on the
// number signs. Values are close to the operators' liveries, not official brand colours.

export const LIVERIES = {
  ARR: { body: '#0B5FA5', name: 'Arriva (Limburg)' }, // Maastricht city + regional lines: blue
  ARRIVA: { body: '#0B5FA5', name: 'Arriva' },
  QBUZZ: { body: '#E2001A', name: 'Qbuzz' },
  KEOLIS: { body: '#1E2F5A', name: 'Keolis' },
  FLIXBUS: { body: '#73D700', name: 'FlixBus' },
};
export const DEFAULT_BUS = LIVERIES.ARR.body; // in Maastricht an unknown bus is most likely Arriva

/** Body colour ('#rrggbb') for a route ({ agency, colour, mode }). */
export function liveryFor(route) {
  const key = String(route?.agency || '').toUpperCase().replace(/[^A-Z]/g, '');
  return (LIVERIES[key] || LIVERIES[key.slice(0, 3)])?.body || DEFAULT_BUS;
}
