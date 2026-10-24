// The weekly market on the Markt (life/streets.json `market`: square polygon + days/hours;
// Maastricht: Wednesday and Friday 08:00-13:00). Rows of striped stalls laid out along the
// square's long side, back to back in pairs with aisles between; a vendor behind each counter
// and people browsing in front. Stall frames stand an hour before (setup) and after (packing);
// delivery vans park along the square's edge (all on market days, a couple otherwise).
import { MODE } from '../figure/rig.js';
import { makeVariant } from '../figure/variants.js';
import { STALL } from '../figure/props.js';
import { inPoly, marketState } from './density.js';
import { rng } from './walkgraph.js';

const AISLE = 4.5;

/** Long-side direction of a polygon [x, z, ...] (unit [dx, dz]). */
function mainAxis(poly) {
  let best = 0, dir = [1, 0];
  const n = poly.length / 2;
  for (let q = 0; q < n; q++) {
    const a = q, b = (q + 1) % n;
    const dx = poly[2 * b] - poly[2 * a], dz = poly[2 * b + 1] - poly[2 * a + 1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; dir = [dx / L, dz / L]; }
  }
  return dir;
}

/**
 * Stall layout (pure): [{ x, z, yaw (deg: the customers' side faces the aisle), colour }], plus
 * .vans: [{ x, z, yaw }] delivery vans parked at the head of each pair of rows.
 * keep(x, z) -> bool filters spots (flat ground, walkable). max: most stalls.
 */
export function stallLayout(market, { keep = () => true, max = 64, seed = 3 } = {}) {
  const poly = market.poly, [ux, uz] = mainAxis(poly), vx = -uz, vz = ux;
  let cx = 0, cz = 0;
  const n = poly.length / 2;
  for (let q = 0; q < n; q++) { cx += poly[2 * q] / n; cz += poly[2 * q + 1] / n; }
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let q = 0; q < n; q++) {
    const dx = poly[2 * q] - cx, dz = poly[2 * q + 1] - cz;
    uMin = Math.min(uMin, dx * ux + dz * uz); uMax = Math.max(uMax, dx * ux + dz * uz);
    vMin = Math.min(vMin, dx * vx + dz * vz); vMax = Math.max(vMax, dx * vx + dz * vz);
  }
  const r = rng(seed), out = [];
  out.vans = []; // delivery vans parked at the head of each pair of rows, along them
  const pitch = 2 * STALL.d + AISLE; // a back-to-back pair of rows + one aisle
  const inside = (x, z) => inPoly(poly, x, z);
  const VAN = 5.6; // van length + a gap
  for (let v = vMin + AISLE; v + 2 * STALL.d < vMax - 1; v += pitch) {
    const su = uMin + 2 + VAN / 2, sv = v + STALL.d, vx0 = cx + ux * su + vx * sv, vz0 = cz + uz * su + vz * sv;
    const vanOk = inside(vx0 - ux * 2.6, vz0 - uz * 2.6) && inside(vx0 + ux * 2.6, vz0 + uz * 2.6) && keep(vx0, vz0);
    if (vanOk) out.vans.push({ x: vx0, z: vz0, yaw: ((Math.atan2(ux, uz) * 180) / Math.PI + 360) % 360 });
    for (const [side, off] of [[-1, STALL.d / 2], [1, STALL.d * 1.5]]) { // row facing -v, row facing +v
      for (let u = uMin + 2 + (vanOk ? VAN : 0); u + STALL.w < uMax - 2; u += STALL.w + 0.2) {
        if (r() < 0.12) { u += 1.5; continue; } // gaps let people through
        const su = u + STALL.w / 2, sv = v + off;
        const x = cx + ux * su + vx * sv, z = cz + uz * su + vz * sv;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * a * STALL.w / 2 + vx * b * STALL.d / 2, z + uz * a * STALL.w / 2 + vz * b * STALL.d / 2]);
        if (!corners.every(([a, b]) => inside(a, b)) || !keep(x, z)) continue;
        const fx = vx * side, fz = vz * side; // customers' side
        out.push({ x, z, yaw: ((Math.atan2(fx, fz) * 180) / Math.PI + 360) % 360, colour: Math.floor(r() * 4), fx, fz });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * Parking spots for delivery vans on the square (pure): along the polygon's edge, inset
 * `inset` m, every ~`step` m, away from the stalls; [{ x, z, yaw }]. keep(x, z) filters.
 */
export function vanSpots(market, stalls, { inset = 4, step = 22, keep = () => true, max = 6 } = {}) {
  const poly = market.poly, n = poly.length / 2, out = [];
  let cx = 0, cz = 0;
  for (let q = 0; q < n; q++) { cx += poly[2 * q] / n; cz += poly[2 * q + 1] / n; }
  for (let q = 0; q < n && out.length < max; q++) {
    const ax = poly[2 * q], az = poly[2 * q + 1], bx = poly[2 * ((q + 1) % n)], bz = poly[2 * ((q + 1) % n) + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 8) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let nx = -uz, nz = ux; // inward normal
    if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
    for (let d = step / 2; d < L - 3 && out.length < max; d += step) {
      const x = ax + ux * d + nx * inset, z = az + uz * d + nz * inset;
      if (!inPoly(poly, x, z) || !keep(x, z) || stalls.some((st) => Math.hypot(st.x - x, st.z - z) < 5)) continue;
      out.push({ x, z, yaw: ((Math.atan2(ux, uz) * 180) / Math.PI + 360) % 360 }); // parked along the edge
    }
  }
  return out;
}

const VAN_COLOURS = ['#F2F0EA', '#F2F0EA', '#F2C230', '#F2F0EA', '#A7AAA8', '#F2F0EA']; // white vans and a yellow parcel van

export class Market {
  /** market: streets.json market. ground(x, z) -> y. keep(x, z): extra spot filter. */
  constructor({ market, ground, keep = () => true }) {
    Object.assign(this, { market, ground });
    const flat = ground(...centre(market.poly));
    this.stalls = stallLayout(market, { keep: (x, z) => Math.abs(ground(x, z) - flat) < 0.45 && keep(x, z) });
    this.vans = [...this.stalls.vans, ...vanSpots(market, this.stalls, { keep: (x, z) => Math.abs(ground(x, z) - flat) < 0.45 && keep(x, z) })]
      .map((v, q) => ({ ...v, colour: VAN_COLOURS[q % VAN_COLOURS.length] }));
    this.state = 'off';
    this.browsers = 0;
    const r = rng(17);
    this.people = this.stalls.map((s, q) => ({
      vendor: makeVariant(5000 + q * 3, { kind: 'adult' }),
      shoppers: Array.from({ length: 4 }, (_, k) => ({ v: makeVariant(6000 + q * 11 + k), u: r(), off: (r() - 0.5) * 2.4, back: 0.7 + r() * 0.6, look: (r() - 0.5) * 0.6 })),
    }));
  }

  /** Update for the clock; returns true when the stalls appear or disappear (rebuild props). */
  refresh(clock) {
    const s = marketState(this.market, clock.day, clock.sec);
    const had = this.state !== 'off', has = s !== 'off';
    this.state = s;
    return had !== has;
  }

  /** Stalls: full with awnings while open; bare frames and counters while setting up / packing. */
  props(props) {
    if (this.state === 'off') return;
    const full = this.state === 'open';
    for (const s of this.stalls) {
      const y = this.ground(s.x, s.z), rot = (-s.yaw * Math.PI) / 180;
      if (full) props.add('stall', s.x, y, -s.z, rot, { colour: s.colour });
      else props.add('stall:base', s.x, y, -s.z, rot);
    }
  }

  /** Parked delivery vans: all of them on market days (setup to packing), two on other days. */
  drawVans(fleet) {
    const n = this.state === 'off' ? Math.min(2, this.vans.length) : this.vans.length;
    for (let q = 0; q < n; q++) {
      const v = this.vans[q];
      fleet.addCar('van', v.x, this.ground(v.x, v.z), -v.z, (-v.yaw * Math.PI) / 180, { colour: v.colour });
    }
  }

  /** Vendors and browsing shoppers. Shoppers rotate in and out slowly (t: seconds). */
  draw(crowd, t) {
    this.browsers = 0;
    if (this.state === 'off') return;
    const open = this.state === 'open';
    this.stalls.forEach((s, q) => {
      const P = this.people[q], bx = s.fz, bz = -s.fx; // along the counter
      const vx = s.x - s.fx * 0.27, vz = s.z - s.fz * 0.27; // behind the counter, facing the customers
      crowd.add(P.vendor, { x: vx, y: this.ground(vx, vz), z: -vz, rotY: (-s.yaw * Math.PI) / 180, mode: MODE.IDLE, t: t + q });
      if (!open) return;
      P.shoppers.forEach((p, k) => {
        const phase = (t / 40 + p.u) % 1; // each shopper stays ~70 % of a 40 s cycle
        if (phase > 0.7 + 0.25 * Math.sin(q + k)) return;
        const drift = Math.sin(t * 0.05 + k) * 0.3;
        const x = s.x + s.fx * (STALL.d / 2 + p.back) + bx * (p.off + drift), z = s.z + s.fz * (STALL.d / 2 + p.back) + bz * (p.off + drift);
        crowd.add(p.v, { x, y: this.ground(x, z), z: -z, rotY: (-(s.yaw + 180) * Math.PI) / 180, mode: MODE.BROWSE, t: t + k * 2, look: p.look });
        this.browsers++;
      });
    });
  }
}

function centre(poly) {
  let x = 0, z = 0;
  const n = poly.length / 2;
  for (let q = 0; q < n; q++) { x += poly[2 * q] / n; z += poly[2 * q + 1] / n; }
  return [x, z];
}
