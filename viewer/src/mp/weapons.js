// The two guns of capture the flag and the maths of a shot: fire rate, magazine, reload, spread
// that opens while you spray or run and closes when you aim, recoil, and what a ray hits (a head,
// a body, a wall). Pure (no three.js, no DOM), tested in test/mp.combat.test.mjs. The room
// (relay/src/ctf.js shoot) decides the damage; these numbers only drive the feel.

export const WEAPONS = {
  // an automatic: easy to hit with up close, zooms a little
  rifle: { name: 'Rifle', auto: true, intervalS: 0.1, mag: 30, reserve: 120, reloadS: 1.7, fov: 38, sens: 0.6, scope: false,
    spreadHip: 0.02, spreadAim: 0.002, bloom: 0.006, bloomMax: 0.04, kick: [0.011, 0.005],
    // feel: share of the kick that recovers, camera shake (rad), muzzle flash size, how far the gun jumps back
    feel: { recover: 0.55, shake: 0.0035, flash: 1, back: 0.05 } },
  // a bolt action with a scope: two body hits or one to the head, slow between shots
  scout: { name: 'Scout', auto: false, intervalS: 1.0, mag: 5, reserve: 20, reloadS: 2.3, fov: 13, sens: 0.22, scope: true,
    spreadHip: 0.06, spreadAim: 0, bloom: 0, bloomMax: 0, kick: [0.045, 0.01],
    feel: { recover: 0.8, shake: 0.01, flash: 1.6, back: 0.14 } },
  // eight pellets in a wide cone: deadly within a few metres, useless across a square
  shotgun: { name: 'Shotgun', auto: false, intervalS: 0.75, mag: 6, reserve: 30, reloadS: 2.2, fov: 46, sens: 0.75, scope: false, pellets: 8, pelletSpread: 0.055, rangeM: 45,
    spreadHip: 0.012, spreadAim: 0.006, bloom: 0, bloomMax: 0, kick: [0.06, 0.012],
    feel: { recover: 0.75, shake: 0.022, flash: 2.4, back: 0.22 } },
  // always with you: one stab knocks out anyone within reach
  // close quarters: very fast, light kick, the spread opens quickly at range
  smg: { name: 'SMG', auto: true, intervalS: 0.067, mag: 32, reserve: 160, reloadS: 1.5, fov: 44, sens: 0.7, scope: false,
    spreadHip: 0.026, spreadAim: 0.008, bloom: 0.005, bloomMax: 0.05, kick: [0.007, 0.006],
    feel: { recover: 0.6, shake: 0.0025, flash: 0.8, back: 0.035 } },
  // the sidearm: quick to draw, semi-automatic
  pistol: { name: 'Pistol', auto: false, intervalS: 0.16, mag: 12, reserve: 60, reloadS: 1.2, fov: 46, sens: 0.75, scope: false,
    spreadHip: 0.018, spreadAim: 0.004, bloom: 0.004, bloomMax: 0.02, kick: [0.018, 0.006],
    feel: { recover: 0.75, shake: 0.004, flash: 0.9, back: 0.06 } },
  // a big magazine and a long reload; heavy to aim
  lmg: { name: 'LMG', auto: true, intervalS: 0.09, mag: 75, reserve: 150, reloadS: 3.6, fov: 40, sens: 0.5, scope: false,
    spreadHip: 0.03, spreadAim: 0.004, bloom: 0.004, bloomMax: 0.05, kick: [0.012, 0.007],
    feel: { recover: 0.5, shake: 0.005, flash: 1.2, back: 0.06 } },
  knife: { name: 'Knife', melee: true, auto: false, intervalS: 0.55, mag: Infinity, reloadS: 0, fov: 55, sens: 1, scope: false, reachM: 2.3, arc: 0.5,
    spreadHip: 0, spreadAim: 0, bloom: 0, bloomMax: 0, kick: [0, 0],
    feel: { recover: 0, shake: 0.004, flash: 0, back: 0 } },
};
export const PRIMARIES = ['rifle', 'smg', 'shotgun', 'lmg']; // the loadout's first slot (chosen in the Play panel)
export const PICKUPS = ['scout', 'shotgun', 'lmg', 'smg', 'rifle']; // weapons found lying about (pickupSpots)
export const SUPPLIES = ['ammo', 'med']; // an ammo box (every reserve full) and a medkit (the room heals)
export const LOADOUT_KEY = 'blox.loadout';
/** The saved primary weapon (a valid one, else the rifle). */
export function savedPrimary(store = (() => { try { return localStorage; } catch { return null; } })()) {
  let w = null; try { w = store?.getItem(LOADOUT_KEY); } catch { /* blocked */ }
  return PRIMARIES.includes(w) ? w : 'rifle';
}
// health comes back like Call of Duty: after REGEN.delay seconds without a hit, REGEN.rate per second
export const REGEN = { delay: 5, rate: 25 };
export const PICKUP_R = 1.8, PICKUP_BACK_S = 20;
export const BODY = { head: [1.5, 0.25], torso: [[1.12, 0.33], [0.78, 0.34], [0.42, 0.33]] }; // [height above the feet, radius] m

/**
 * One player's weapons: four slots (the loadout's primary, the pistol, whatever was picked up, the
 * knife); each gun has a magazine and reserve rounds (reload takes from the reserve).
 * step(dt, { fire, reload, swap, slot }) -> { shot, empty, reloaded, swapped }.
 */
export class Gun {
  constructor() { this.reset(); }
  reset(primary = this.primary || 'rifle') {
    this.primary = PRIMARIES.includes(primary) ? primary : 'rifle';
    this.slots = [this.primary, 'pistol', null, 'knife']; this.w = this.primary;
    this.ammo = Object.fromEntries(Object.entries(WEAPONS).map(([k, d]) => [k, d.mag]));
    this.spare = Object.fromEntries(Object.entries(WEAPONS).map(([k, d]) => [k, d.reserve ?? Infinity]));
    this.cool = 0; this.reload = 0; this.bloom = 0; this.held = false;
  }
  get def() { return WEAPONS[this.w]; }
  get reloading() { return this.reload > 0; }
  /** 0..1 through the reload. */
  get reloadProgress() { return this.reload > 0 ? 1 - this.reload / this.def.reloadS : 0; }

  /** Something found lying about: a weapon (the third slot, full, in the hands) or an ammo box (every reserve full). */
  give(w) {
    if (w === 'ammo') { for (const [k, d] of Object.entries(WEAPONS)) this.spare[k] = d.reserve ?? Infinity; return true; }
    if (w === 'med') return true; // (the room heals)
    if (!PICKUPS.includes(w)) return false;
    if (this.slots[0] === w) { this.ammo[w] = WEAPONS[w].mag; this.spare[w] = WEAPONS[w].reserve; this.select(w); return true; }
    this.slots[2] = w; this.ammo[w] = WEAPONS[w].mag; this.spare[w] = WEAPONS[w].reserve;
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
      if (this.reload <= 0) { // from the reserve
        this.reload = 0;
        const take = Math.min(d.mag - this.ammo[this.w], this.spare[this.w]);
        this.ammo[this.w] += take; this.spare[this.w] -= take; out.reloaded = true;
      }
      this.held = fire;
      return out;
    }
    if (!d.melee && this.spare[this.w] > 0 && ((reload && this.ammo[this.w] < d.mag) || (fire && this.ammo[this.w] === 0 && !this.held))) {
      this.reload = d.reloadS; out.empty = this.ammo[this.w] === 0; this.held = fire;
      return out;
    }
    const pull = fire && (d.auto || !this.held);
    this.held = fire;
    if (pull && this.cool <= 0 && this.ammo[this.w] === 0 && !d.melee) out.empty = true; // click: dry
    if (pull && this.cool <= 0 && this.ammo[this.w] > 0) {
      if (!d.melee) this.ammo[this.w]--;
      this.cool = d.intervalS;
      this.bloom = Math.min(d.bloomMax, this.bloom + d.bloom);
      out.shot = true;
      if (this.ammo[this.w] === 0 && this.spare[this.w] > 0) this.reload = d.reloadS; // reload by itself after the last round
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
  // weapons in mirrored pairs, then ammo boxes and medkits (fair for both sides)
  return [{ at: at(0.5, 38), w: 'scout' }, { at: at(0.5, -38), w: 'lmg' }, { at: at(0.22, -24), w: 'shotgun' }, { at: at(0.78, 24), w: 'shotgun' },
    { at: at(0.3, 12), w: 'ammo' }, { at: at(0.7, -12), w: 'ammo' }, { at: at(0.15, 30), w: 'med' }, { at: at(0.85, -30), w: 'med' },
    { at: at(0.38, -40), w: 'smg' }, { at: at(0.62, 40), w: 'smg' }];
}
