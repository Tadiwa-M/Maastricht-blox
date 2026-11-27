// Places to plan to and from: shops, cafés, pubs, landmarks, streets, addresses (from the world's
// features.json) and bus stops (from the timetable), with a forgiving search: case, accents and
// punctuation don't matter, a query matches word starts ("miss" finds "Missouri"), and stations,
// landmarks and stops rank a little higher. Pure; tested in test/plan-places.test.mjs.
//
// The site build writes world/places.json from features.json (build.mjs) so the phone page loads
// a few hundred KB instead of the whole feature file.

const KEEP = new Set(['poi', 'landmark', 'station', 'street', 'park']);
const BOOST = { station: 0.6, landmark: 0.5, stop: 0.4, poi: 0.2, park: 0.2, street: 0.1, address: 0 };

/** Compact places from features.json entries: [[name, kind, x, z, sub]] (Unity metres). */
export function placesFromFeatures(features, studM = 0.5) {
  const out = [], seen = new Set();
  for (const f of features) {
    const c = f.centroid;
    if (!c) continue;
    const x = Math.round(c[0] * studM), z = Math.round(c[1] * studM);
    if (f.name && KEEP.has(f.kind)) {
      const sub = f.kind === 'poi' ? poiType(f.tags) : f.kind === 'street' ? 'street' : f.kind;
      const k = `${f.name}|${sub}|${Math.round(x / 50)}|${Math.round(z / 50)}`; // one entry per name nearby
      if (!seen.has(k)) { seen.add(k); out.push([f.name, f.kind, x, z, sub]); }
    }
    if (f.address) out.push([f.address, 'address', x, z, f.name || '']);
  }
  return out;
}

function poiType(tags = {}) {
  for (const k of ['amenity', 'shop', 'tourism', 'leisure', 'historic']) if (tags?.[k]) return String(tags[k]).replace(/_/g, ' ');
  return 'place';
}

/** Lower case, no accents, letters and digits only (single spaces). */
export function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export class PlaceIndex {
  /** places: [[name, kind, x, z, sub]]; stops: timetable stops [{ name, x, y }] (grouped by name). */
  constructor(places = [], stops = []) {
    const byName = new Map();
    for (const s of stops) {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(s);
    }
    this.items = [];
    for (const [name, ss] of byName) {
      this.items.push({ name, kind: 'stop', sub: 'bus stop', x: avg(ss, 'x'), z: avg(ss, 'y') });
    }
    for (const [name, kind, x, z, sub] of places) this.items.push({ name, kind, sub: sub || kind, x, z });
    for (const it of this.items) { it.n = norm(it.name); it.words = it.n.split(' '); }
  }

  /** The best `n` places for a query: [{ name, kind, sub, x, z }]. */
  search(q, n = 8) {
    const qn = norm(q);
    if (!qn) return [];
    const qw = qn.split(' ');
    const scored = [];
    for (const it of this.items) {
      let s = 0;
      if (it.n === qn) s = 4;
      else if (it.n.startsWith(qn)) s = 3;
      else if (qw.every((w) => it.words.some((x) => x.startsWith(w)))) s = 2;
      else if (it.n.includes(qn)) s = 1;
      if (!s) continue;
      scored.push([s + (BOOST[it.kind] || 0) - it.n.length * 0.002, it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = [], seen = new Set();
    for (const [, it] of scored) {
      const k = `${it.n}|${it.kind}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      if (out.length >= n) break;
    }
    return out;
  }
}

function avg(list, k) { return list.reduce((a, s) => a + s[k], 0) / list.length; }
