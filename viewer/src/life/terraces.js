// Cafe terraces: tables, chairs and parasols on the pavement in front of cafes, bars and
// restaurants (life/streets.json `pois`: position + unit vector `f` toward the street, `d`
// metres to it), with people sitting at them (how many: density.js terraceFactor). Only the
// terraces near the camera are built; the set is rebuilt when the camera target moves.
import { MODE } from '../figure/rig.js';
import { makeVariant } from '../figure/variants.js';
import { rng } from './walkgraph.js';
import { terraceFactor } from './density.js';

const PARASOL = ['#F2F0EA', '#C8102E', '#2F5A3C', '#22385A', '#EFE3C2', '#D6A445'];
const FURNITURE = ['#5C6062', '#1E1F21', '#8F7A57', '#F2F0EA', '#6E4A33'];

/**
 * Layout of one terrace (pure): { tables: [{ x, z }], chairs: [{ x, z, yaw (deg, the sitter's
 * facing), u (0..1 stable random) }], parasol: colour or null, chairColour, tableColour }.
 */
export function terraceLayout(poi, seed = 1) {
  const r = rng(seed * 977 + 3);
  const [fx, fz] = poi.f;
  const ax = -fz, az = fx; // along the facade
  const dist = Math.max(2.2, Math.min(6, (poi.d ?? 8) - 5));
  const n = 2 + Math.floor(r() * 3), rows = (poi.d ?? 8) > 12 ? 2 : 1;
  const tables = [], chairs = [];
  for (let row = 0; row < rows; row++) {
    for (let q = 0; q < n; q++) {
      const a = (q - (n - 1) / 2) * 2.5 + (row ? 1.2 : 0), t = dist + row * 2.3;
      const x = poi.x + fx * t + ax * a, z = poi.z + fz * t + az * a;
      tables.push({ x, z });
      const four = r() < 0.35;
      const seats = four ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      for (const [sa, sf] of seats) {
        const cx = x + ax * sa * 0.6 + fx * sf * 0.6, cz = z + az * sa * 0.6 + fz * sf * 0.6;
        const yaw = ((Math.atan2(x - cx, z - cz) * 180) / Math.PI + 360) % 360;
        chairs.push({ x: cx, z: cz, yaw, u: r(), table: tables.length - 1 });
      }
    }
  }
  return { tables, chairs, parasol: r() < 0.7 ? PARASOL[Math.floor(r() * PARASOL.length)] : null,
    chairColour: FURNITURE[Math.floor(r() * FURNITURE.length)], tableColour: FURNITURE[Math.floor(r() * FURNITURE.length)] };
}

export class Terraces {
  /** pois: streets.json pois. ground(x, z) -> y. */
  constructor({ pois, ground, radius = 260 }) {
    this.pois = pois.map((p, q) => ({ ...p, id: q }));
    Object.assign(this, { ground, radius });
    this.active = []; // [{ poi, layout, ok: [table ok], sitters: [{ chair, v }] }]
    this.center = null;
    this.dirty = true;
    this.seated = 0;
  }

  /** Rebuild the set near target when it moved > 40 m. Returns true when props must be rebuilt. */
  refresh(target) {
    if (this.center && Math.hypot(target[0] - this.center[0], target[1] - this.center[1]) < 40 && !this.dirty) return false;
    this.center = [...target];
    this.dirty = false;
    this.active = [];
    for (const poi of this.pois) {
      if (Math.hypot(poi.x - target[0], poi.z - target[1]) > this.radius) continue;
      const layout = terraceLayout(poi, poi.id + 1);
      const street = this.ground(poi.x + poi.f[0] * (poi.d ?? 6), poi.z + poi.f[1] * (poi.d ?? 6));
      const ok = layout.tables.map((t) => Math.abs(this.ground(t.x, t.z) - street) < 0.6); // not inside a building / on a step
      if (!ok.some(Boolean)) continue;
      this.active.push({ poi, layout, ok });
    }
    return true;
  }

  /** Props: tables, chairs, parasols into a PropSet (three.js coordinates). */
  props(props) {
    for (const { layout, ok } of this.active) {
      layout.tables.forEach((t, q) => {
        if (!ok[q]) return;
        const y = this.ground(t.x, t.z);
        props.add('table', t.x, y, -t.z, 0, { colour: layout.tableColour });
        if (layout.parasol && q % 2 === 0) props.add('parasol', t.x, y, -t.z, 0, { colour: layout.parasol });
      });
      for (const c of layout.chairs) {
        if (!ok[c.table]) continue;
        props.add('chair', c.x, this.ground(c.x, c.z), -c.z, (-c.yaw * Math.PI) / 180, { colour: layout.chairColour });
      }
    }
  }

  /** Seated people into the crowd; share of chairs taken from the clock (and the rain). */
  draw(crowd, clock, t, rain = 0) {
    const share = terraceFactor(clock.hours, clock.day) * (1 - 0.85 * rain); // rain empties the terraces (bar the parasols)
    let n = 0;
    for (const { poi, layout, ok } of this.active) {
      layout.chairs.forEach((c, q) => {
        if (!ok[c.table] || c.u > share) return;
        const v = c.v || (c.v = makeVariant(poi.id * 37 + q * 5 + 1000));
        if (v.acc === 'umbrella') v.acc = 'none';
        crowd.add(v, { x: c.x, y: this.ground(c.x, c.z), z: -c.z, rotY: (-c.yaw * Math.PI) / 180, mode: MODE.SIT, t: t + q * 3.1 });
        n++;
      });
    }
    this.seated = n;
  }
}
