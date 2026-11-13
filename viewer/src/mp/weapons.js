// The two guns of capture the flag and the maths of a shot: fire rate, magazine, reload, spread
// that opens while you spray or run and closes when you aim, recoil, and what a ray hits (a head,
// a body, a wall). Pure (no three.js, no DOM), tested in test/mp.combat.test.mjs. The room
// (relay/src/ctf.js shoot) decides the damage; these numbers only drive the feel.

export const WEAPONS = {
  // an automatic: easy to hit with up close, zooms a little
  rifle: { name: 'Rifle', auto: true, intervalS: 0.1, mag: 30, reloadS: 1.7, fov: 38, sens: 0.6, scope: false,
    spreadHip: 0.02, spreadAim: 0.002, bloom: 0.006, bloomMax: 0.04, kick: [0.011, 0.005] },
  // a bolt action with a scope: two body hits or one to the head, slow between shots
  scout: { name: 'Scout', auto: false, intervalS: 1.0, mag: 5, reloadS: 2.3, fov: 13, sens: 0.22, scope: true,
    spreadHip: 0.06, spreadAim: 0, bloom: 0, bloomMax: 0, kick: [0.045, 0.01] },
  // eight pellets in a wide cone: deadly within a few metres, useless across a square
  shotgun: { name: 'Shotgun', auto: false, intervalS: 0.75, mag: 6, reloadS: 2.2, fov: 46, sens: 0.75, scope: false, pellets: 8, pelletSpread: 0.055, rangeM: 45,
    spreadHip: 0.012, spreadAim: 0.006, bloom: 0, bloomMax: 0, kick: [0.06, 0.012] },
  // always with you: one stab knocks out anyone within reach
  knife: { name: 'Knife', melee: true, auto: false, intervalS: 0.55, mag: Infinity, reloadS: 0, fov: 55, sens: 1, scope: false, reachM: 2.3, arc: 0.5,
    spreadHip: 0, spreadAim: 0, bloom: 0, bloomMax: 0, kick: [0, 0] },
};
export const PICKUPS = ['scout', 'shotgun']; // found in the arena (pickupSpots); the rifle and the knife you always have
export const PICKUP_R = 1.8, PICKUP_BACK_S = 20;
export const BODY = { head: [1.5, 0.25], torso: [[1.12, 0.33], [0.78, 0.34], [0.42, 0.33]] }; // [height above the feet, radius] m

/**
 * One player's weapons: three slots (rifle, whatever was picked up, knife).
 * step(dt, { fire, reload, swap, slot }) -> { shot, empty, reloaded, swapped }.
 */
export class Gun {
  constructor() { this.reset(); }
  reset() {
    this.slots = ['rifle', null, 'knife']; this.w = 'rifle';
    this.ammo = Object.fromEntries(Object.entries(WEAPONS).map(([k, d]) => [k, d.mag]));
    this.cool = 0; this.reload = 0; this.bloom = 0; this.held = false;
  }
  get def() { return WEAPONS[this.w]; }
  get reloading() { return this.reload > 0; }
  /** 0..1 through the reload. */
  get reloadProgress() { return this.reload > 0 ? 1 - this.reload / this.def.reloadS : 0; }

  /** A weapon found in the arena: into the middle slot with a full magazine, and in the hands. */
  give(w) {
    if (!PICKUPS.includes(w)) return false;
    this.slots[1] = w; this.ammo[w] = WEAPONS[w].mag;
    this.select(w);
    return true;
  }
  select(w) { this.w = w; this.reload = 0; this.cool = Math.max(this.cool, 0.35); this.bloom = 0; }

  step(dt, { fire = false, reload = false, swap = false, slot = null } = {}) {
    const out = { shot: false, empty: false, reloaded: false, swapped: false };
    this.cool = Math.max(0, this.cool - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.09);
    const have = this.slots.filter(Boolean);
    const to = slot !== null ? this.slots[slot] : swap ? have[(have.indexOf(this.w) + 1) % have.length] : null;
    if (to && to !== this.w) { this.select(to); this.held = fire; out.swapped = true; return out; }
    const d = this.def;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) { this.reload = 0; this.ammo[this.w] = d.mag; out.reloaded = true; }
      this.held = fire;
      return out;
    }
    if (!d.melee && ((reload && this.ammo[this.w] < d.mag) || (fire && this.ammo[this.w] === 0 && !this.held))) {
      this.reload = d.reloadS; out.empty = this.ammo[this.w] === 0; this.held = fire;
      return out;
    }
    const pull = fire && (d.auto || !this.held);
    this.held = fire;
    if (pull && this.cool <= 0 && this.ammo[this.w] > 0) {
      if (!d.melee) this.ammo[this.w]--;
      this.cool = d.intervalS;
      this.bloom = Math.min(d.bloomMax, this.bloom + d.bloom);
      out.shot = true;
      if (this.ammo[this.w] === 0) this.reload = d.reloadS; // reload by itself after the last round
    }
    return out;
  }

  /** Cone half-angle (radians) of the next shot: aim 0..1, speed m/s, in the air? */
  spread(aim, speed = 0, air = false) {
    const d = this.def;
    const base = d.spreadHip + (d.spreadAim - d.spreadHip) * aim;
    return base * (1 + Math.min(1, speed / 5) * 0.8 * (1 - aim * 0.5)) * (air ? 2.5 : 1) + this.bloom * (1 - aim * 0.6);
  }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const L = Math.hypot(...v) || 1; return [v[0] / L, v[1] / L, v[2] / L]; };

/** A direction inside a cone of half-angle `spread` round the unit vector `dir` (rand: 0..1). */
export function spreadDir(dir, spread, rand = Math.random) {
  if (spread <= 0) return [...dir];
  const up = Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const r = norm([dir[1] * up[2] - dir[2] * up[1], dir[2] * up[0] - dir[0] * up[2], dir[0] * up[1] - dir[1] * up[0]]);
  const u = [r[1] * dir[2] - r[2] * dir[1], r[2] * dir[0] - r[0] * dir[2], r[0] * dir[1] - r[1] * dir[0]];
  const a = rand() * Math.PI * 2, m = Math.tan(spread) * Math.sqrt(rand());
  return norm([0, 1, 2].map((k) => dir[k] + (r[k] * Math.cos(a) + u[k] * Math.sin(a)) * m));
}

/** Distance along the ray o + d*t to a sphere, or null. */
export function raySphere(o, d, c, r) {
  const m = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = dot(m, d), q = dot(m, m) - r * r;
  if (q > 0 && b > 0) return null;
  const disc = b * b - q;
  return disc < 0 ? null : Math.max(0, -b - Math.sqrt(disc));
}

/**
 * The nearest figure a ray hits: targets [{ id, pos: feet [x, y, z], scale? }] -> { id, head, t } | null.
 * A figure is a head sphere over three body spheres (BODY).
 */
export function hitTest(o, d, targets, maxT = Infinity) {
  let best = null;
  for (const tg of targets) {
    const s = tg.scale || 1, p = tg.pos;
    const parts = [[BODY.head, true], ...BODY.torso.map((b) => [b, false])];
    for (const [[h, r], head] of parts) {
      const t = raySphere(o, d, [p[0], p[1] + h * s, p[2]], r * s);
      if (t !== null && t <= maxT && (!best || t < best.t - 1e-6 || (head && Math.abs(t - best.t) < 0.05 && best.id === tg.id))) best = { id: tg.id, head, t };
    }
  }
  return best;
}

/** Distance to the first solid thing along a ray (city.isSolid, three.js metres), or maxT. */
export function wallT(city, o, d, maxT, step = 0.2, from = 0) {
  for (let t = from; t <= maxT; t += step) {
    if (city.isSolid(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) === true) return t;
  }
  return maxT;
}

/** Kill spots [east, north] -> canvas pixels for the after-match heat map (north up, both bases inside). */
export function heatProject(bases, arenaR, size) {
  const a = bases.blue.at, b = bases.yellow.at;
  const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  const half = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / 2 + arenaR;
  return (p) => [((p[0] - cx) / half + 1) * size / 2, (1 - (p[1] - cz) / half) * size / 2];
}

/** Who a knife reaches: the nearest target within `reach` metres and `arc` radians of the facing (unit, flat). */
export function meleeTarget(pos, fwd, targets, reach = WEAPONS.knife.reachM, arc = WEAPONS.knife.arc) {
  let best = null;
  for (const t of targets) {
    const dx = t.pos[0] - pos[0], dz = t.pos[2] - pos[2], d = Math.hypot(dx, dz);
    if (d > reach || Math.abs(t.pos[1] - pos[1]) > 2) continue;
    const L = Math.hypot(fwd[0], fwd[2]) || 1;
    if (d > 0.4 && Math.acos(Math.max(-1, Math.min(1, (dx * fwd[0] + dz * fwd[2]) / (d * L)))) > arc + 0.5 / d) continue;
    if (!best || d < best.d) best = { id: t.id, d };
  }
  return best;
}

/**
 * Where weapons lie in a round: four spots mirrored about the middle of the line between the
 * bases (so neither team is nearer), [{ at: [east, north], w }]. Same for every player of a room.
 */
export function pickupSpots(bases) {
  const a = bases.blue.at, b = bases.yellow.at, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const f = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-f[1], f[0]];
  const at = (t, side) => [Math.round(a[0] + f[0] * L * t + n[0] * side), Math.round(a[1] + f[1] * L * t + n[1] * side)];
  return [{ at: at(0.5, 38), w: 'scout' }, { at: at(0.5, -38), w: 'shotgun' }, { at: at(0.22, -24), w: 'shotgun' }, { at: at(0.78, 24), w: 'shotgun' }];
}
