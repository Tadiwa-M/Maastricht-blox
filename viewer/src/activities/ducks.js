// A handful of ducks paddling on the water near the player (pure, tested in
// test/activities.test.mjs): the Maas banks, the Stadspark ponds, the Jeker, wherever the
// world has water. Simple boids: each duck wanders, keeps a little apart from the others and
// from the player, never leaves the water (it probes ahead and turns), and swims to bread that
// lands on the water, where it dabbles to eat it. Only ducks near the player exist: one far
// away is put back on water found near the player.
//
// Coordinates: three.js metres (x east, z = -north); heading h is compass radians (forward =
// (sin h, -cos h)), as the player. water(x, z) -> surface y or null.
import { rng } from '../life/walkgraph.js';

export const DUCK = {
  count: 7, near: 55, spawnR: 32, idle: 0.28, swim: 0.85, turn: 2.2, apart: 1.2, shy: 1.8,
  probe: 0.6, eatR: 0.35, smell: 30, crumbLife: 45, flight: 0.7,
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Ducks {
  constructor({ water, rand = rng(71), opts = {} }) {
    this.o = { ...DUCK, ...opts };
    this.rand = rand;
    this.cache = new Map(); // 0.5 m cells -> surface y | null (the world does not change)
    this.water = (x, z) => {
      const k = `${Math.floor(x * 2)},${Math.floor(z * 2)}`;
      if (this.cache.has(k)) return this.cache.get(k);
      if (this.cache.size > 20000) this.cache.clear();
      const y = water(x, z);
      this.cache.set(k, y);
      return y;
    };
    this.pool = []; // water points seen near the player: where ducks appear
    this.ducks = [];
    this.crumbs = []; // { x, z, y, t (s since thrown), from: [x, y, z] }
    this.wander = 0;
  }

  /** Look for water around the player (a few samples a call) and keep the ducks near them. */
  refresh(px, pz, samples = 10) {
    const o = this.o, r = this.rand;
    this.pool = this.pool.filter((p) => Math.hypot(p.x - px, p.z - pz) < o.near);
    for (let q = 0; q < samples && this.pool.length < 48; q++) {
      const a = r() * Math.PI * 2, d = 3 + r() * o.spawnR;
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const y = this.water(x, z);
      if (y !== null && this.water(x + 1, z) !== null && this.water(x - 1, z) !== null) this.pool.push({ x, z }); // not a one-cell puddle
    }
    for (let q = 0; q < o.count; q++) {
      const d = this.ducks[q];
      if (d && Math.hypot(d.x - px, d.z - pz) < o.near) continue;
      if (!this.pool.length) { if (d) d.away = true; continue; }
      const p = this.pool[Math.floor(r() * this.pool.length)];
      const y = this.water(p.x, p.z);
      if (y === null) continue;
      this.ducks[q] = { x: p.x, z: p.z, y, h: r() * Math.PI * 2, v: 0, eat: 0, seed: r() * 10, drake: q % 2 === 0, away: false };
    }
  }

  /** Ducks on the water near the player (the ones to draw). */
  visible() { return this.ducks.filter((d) => d && !d.away); }

  /** Throw bread from `from` ([x, y, z]) to the water around (x, z): n crumbs that land after a short flight. */
  feed(x, z, from, n = 6) {
    const r = this.rand;
    for (let q = 0; q < n; q++) {
      const cx = x + (r() - 0.5) * 1.6, cz = z + (r() - 0.5) * 1.6;
      const y = this.water(cx, cz);
      if (y === null) continue;
      this.crumbs.push({ x: cx, z: cz, y, t: -q * 0.05, from: [...from] });
    }
    // lure: make sure a few ducks are within reach of the bread (they swim over from further off)
    const near = this.visible().filter((d) => Math.hypot(d.x - x, d.z - z) < this.o.smell).length;
    if (near < 3) {
      const spots = this.pool.filter((p) => { const d = Math.hypot(p.x - x, p.z - z); return d > 8 && d < this.o.smell * 0.8; });
      for (const d of this.ducks) {
        if (!d || !spots.length || Math.hypot(d.x - x, d.z - z) < this.o.smell) continue;
        const p = spots[Math.floor(r() * spots.length)];
        Object.assign(d, { x: p.x, z: p.z, y: this.water(p.x, p.z) ?? d.y, away: false });
      }
    }
    return this.crumbs.length;
  }

  /** Crumbs on the water (landed), for the ducks to swim to. */
  landed() { return this.crumbs.filter((c) => c.t >= this.o.flight); }

  /** One step. px, pz: the player (ducks keep a little away from them unless there is bread). */
  update(dt, px, pz) {
    const o = this.o, r = this.rand;
    for (const c of this.crumbs) c.t += dt;
    this.crumbs = this.crumbs.filter((c) => c.t < o.crumbLife);
    const food = this.landed();
    const ducks = this.visible();
    for (const d of ducks) {
      d.eat = Math.max(0, d.eat - dt);
      // steering: wander, the nearest crumb, keep apart, keep off the player
      let sx = 0, sz = 0, want = o.idle;
      d.wander = (d.wander ?? r() * 6) + (r() - 0.5) * dt * 2;
      sx += Math.sin(d.wander) * 0.6; sz -= Math.cos(d.wander) * 0.6;
      let best = null, bd = o.smell;
      for (const c of food) { const k = Math.hypot(c.x - d.x, c.z - d.z); if (k < bd) { bd = k; best = c; } }
      if (best) {
        if (bd < o.eatR) { this.crumbs.splice(this.crumbs.indexOf(best), 1); d.eat = 0.9; }
        else { sx += ((best.x - d.x) / bd) * 3; sz += ((best.z - d.z) / bd) * 3; want = bd > 2 ? o.swim : o.swim * 0.5; }
      }
      for (const e of ducks) {
        if (e === d) continue;
        const k = Math.hypot(d.x - e.x, d.z - e.z);
        if (k > 0 && k < o.apart) { sx += ((d.x - e.x) / k) * (o.apart - k) * 3; sz += ((d.z - e.z) / k) * (o.apart - k) * 3; }
      }
      const kp = Math.hypot(d.x - px, d.z - pz);
      if (!best && kp > 0 && kp < o.shy) { sx += ((d.x - px) / kp) * 2; sz += ((d.z - pz) / kp) * 2; want = o.swim * 0.6; }
      if (d.eat > 0) want = 0;
      const goal = Math.atan2(sx, -sz);
      const dh = wrap(goal - d.h);
      d.h = wrap(d.h + Math.max(-o.turn * dt, Math.min(o.turn * dt, dh)));
      d.v += (want - d.v) * Math.min(1, dt * 2);
      // stay on the water: probe ahead, turn to the first open heading, else stop
      const ok = (h) => this.water(d.x + Math.sin(h) * o.probe, d.z - Math.cos(h) * o.probe) !== null;
      if (!ok(d.h)) {
        const turn = [0.6, -0.6, 1.2, -1.2, 2, -2, Math.PI].find((t) => ok(d.h + t));
        if (turn === undefined) d.v = 0; else d.h = wrap(d.h + turn);
      }
      const nx = d.x + Math.sin(d.h) * d.v * dt, nz = d.z - Math.cos(d.h) * d.v * dt;
      const y = this.water(nx, nz);
      if (y !== null) { d.x = nx; d.z = nz; d.y = y; }
    }
  }
}
