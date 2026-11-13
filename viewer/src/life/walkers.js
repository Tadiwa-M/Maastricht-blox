// Pedestrians: people on the walk graph around the camera, drawn as smooth toy figures
// (src/figure/: one shared FigureCrowd, ~25 draw calls for everyone).
// A crowd should not look like noise, so people walk in groups (1-4 side by side, the group
// at its slowest member's pace), at their own pace (kids quick, older people slow), and
// sometimes stop to chat or look around. Groups that end up far from the camera target are
// recycled to a busy node near it (spawn weights: walkways.json, boosted by density.js and the
// daily routines, routines.js). Some groups head somewhere (a goal from routines.js goalPlan:
// students to the university in the morning, commuters to the station). In the rain people keep
// to the walls and shelter there; they react to the player (reactions.js, react()).
//
// People should behave like people: they see each other coming and curve round early
// (walkgraph.js steer), never give way into a wall (fitShift), change pace over a few steps
// rather than in one frame (Walker ease), walk with their own stride and arm swing (variants.js
// gait, the stride matched to the speed so feet don't skate), ease between walking and standing,
// do something when they stand (phone, telling a story, looking around: rig.js IDLE), keep a
// loose formation with their friends, and turn their heads to what is going on: the player
// passing, the friend beside them, whatever made a noise.
import { MODE, IDLE } from '../figure/rig.js';
import { strideAt } from '../figure/gait.js';
import { makeVariant } from '../figure/variants.js';
import { Walker, steer, separate, rng, turnToward } from './walkgraph.js';
import { crowdFactor as dayCrowd, FIGURES_BY_TIER } from './density.js';
import { pickGoal } from './routines.js';
import { REACT, dodgeSide, yawTo } from './reactions.js';

export const WALKERS_BY_TIER = FIGURES_BY_TIER;
/** Share of the crowd out at an hour (weekday curve; density.js has the day-aware one). */
export const crowdFactor = (hours, day = 2) => Math.min(1, dayCrowd(hours, day));

const GROUP_SIZES = [[1, 0.5], [2, 0.34], [3, 0.12], [4, 0.04]];
const SIDE = 0.62; // metres between people walking side by side
const FILE = 0.75; // metres between people walking one behind the other (narrow pavements)
const NOTICE_M = 6; // the player this close gets a glance from some people
const HEAD_MAX = 1.15; // rad the head turns from the body
const LOOK_M = 2.5; // a walker checks this far ahead for a vehicle coming across
const VEHICLE_AHEAD_M = 7; // a vehicle's path ahead that people don't step into
const WAIT_MAX_S = 8; // after that they go anyway (a parked car in the way)
const WET = 0.25; // rain above this: people keep to the walls
const HUG_PROBES = [0.7, 1.3, 1.9, 2.5, 3.1]; // metres to each side of the path felt for a wall
const GOAL_MAX_S = 300; // a group gives up on its goal after this (and wanders)

/**
 * Is (px, pz) on the path of vehicle f within `ahead` m (its footprint grown, extended forward)?
 * A vehicle that knows its speed (f.v, m/s) only claims the road it covers in ~2.5 s.
 */
export function inVehiclePath(f, px, pz, ahead = VEHICLE_AHEAD_M, margin = 0.6) {
  if (Number.isFinite(f.v)) ahead = Math.min(ahead, f.v * 2.5);
  const r = (f.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r);
  const dx = px - f.x, dz = pz - f.z;
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  return along >= -f.halfL - margin && along <= f.halfL + ahead && Math.abs(across) <= f.halfW + margin;
}

/**
 * Step out of the way of vehicles: a walker inside a vehicle's footprint (+ margin) is moved
 * sideways to the nearer long side. vehicles: [{ x, z, yaw, halfW, halfL }] (Unity metres).
 * Returns how many walkers were moved.
 */
export function clearVehicles(walkers, vehicles, margin = 0.8) {
  let moved = 0;
  for (const v of vehicles) {
    const r = (v.yaw * Math.PI) / 180, fx = Math.sin(r), fz = Math.cos(r); // forward; right = (fz, -fx)
    const hw = v.halfW + margin, hl = v.halfL + margin;
    for (const w of walkers) {
      const dx = w.x - v.x, dz = w.z - v.z;
      if (dx * dx + dz * dz > (hl + hw) * (hl + hw)) continue;
      const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
      if (Math.abs(along) > hl || Math.abs(across) > hw) continue;
      const push = (across >= 0 ? hw : -hw) - across;
      w.x += fz * push; w.z -= fx * push;
      moved++;
    }
  }
  return moved;
}

/** Group size from a random number (weights GROUP_SIZES). */
export function groupSize(u) {
  for (const [n, p] of GROUP_SIZES) { if (u < p) return n; u -= p; }
  return 1;
}

/** In the rain a share of the grown-ups walk under an umbrella (instead of their bag). */
function umbrella(m, share) {
  m.v.acc = share > 0 && m.v.kind !== 'kid' && m.u < share ? 'umbrella' : m.v.baseAcc;
}

export class Pedestrians {
  /**
   * graph: WalkGraph. ground(x, z) -> y (Unity metres). cap: most people.
   * room(x, z, y) -> false where a person standing at height y would be inside a wall (life/index.js).
   */
  constructor({ graph, ground, room = () => true, cap = FIGURES_BY_TIER.high, seed = 7 }) {
    Object.assign(this, { graph, ground, room, cap });
    this.rand = rng(seed);
    this.groups = [];
    this.people = 0; // people in active groups
    this.count = 0; // = people (old name)
    this.radius = 120;
    this.nextId = 1;
    this.t = 0;
    this.rain = 0; // share of grown-ups with an umbrella
    this.wet = 0; // the rain itself, 0..1
    this.plan = null; // routines.js goalPlan: where new groups head (null: everyone wanders)
    this.dressFor = null; // (variant) => variant: outfits for the day (outfits.js), or null
  }

  /** (Re)place group g on a node near (x, z), at least rMin away; new people each time. */
  spawn(g, x, z, rMin) {
    const n = this.graph.spawnNear(x, z, this.radius, this.rand, rMin);
    if (n < 0) return false;
    const r = this.rand;
    const size = g.size || groupSize(r());
    const members = [];
    let speed = 9;
    const family = size >= 3 && r() < 0.4;
    for (let q = 0; q < size; q++) {
      const kind = family ? (q < 2 ? 'adult' : 'kid') : undefined; // a family: two adults and kids
      const v = makeVariant(this.nextId++ * 31 + 7, kind ? { kind } : {});
      if (this.dressFor) this.dressFor(v);
      v.baseAcc = v.acc;
      members.push({ v, phase: r() * Math.PI * 2, off: (q - (size - 1) / 2) * SIDE, back: (r() - 0.5) * 0.35, yaw: null, look: 0, u: r() });
      if (this.rain > 0) umbrella(members[members.length - 1], this.rain);
      speed = Math.min(speed, v.speed);
    }
    const lateral = (r() - 0.5) * 1.4;
    const walker = new Walker(this.graph, n, r, { speed, lateral, ease: true });
    walker.pace = 1; // met already walking
    walker.baseLateral = lateral;
    const goal = this.plan ? pickGoal(this.plan, r(), r()) : null;
    if (goal) walker.goal = goal; // (same pace: brisker groups only pile up behind slower ones)
    walker.place();
    Object.assign(g, { walker, members, size, pause: 0, nextPause: 15 + r() * 60, chat: r() < 0.6, file: 0, fileGoal: 0, roomT: r() * 0.3, wait: 0,
      pace: walker.speed, goalT: 0, look: null, lookT: 0, flee: 0, shelter: null, wall: 0 });
    walker.hw = ((size - 1) / 2) * SIDE;
    return true;
  }

  /** Rain: 0 (dry) .. 1 (pouring); share of grown-ups with an umbrella. */
  setRain(rain) {
    this.wet = Math.max(0, Math.min(1, rain));
    const share = this.wet * 0.75;
    if (share === this.rain) return;
    this.rain = share;
    for (const g of this.groups) for (const m of g.members || []) umbrella(m, share);
  }

  /** Number of people wanted near target ([x, z] Unity metres). */
  setCount(n, target) {
    n = Math.min(n, this.cap);
    let people = 0, k = 0;
    for (; k < this.groups.length && people < n; k++) people += this.groups[k].size;
    while (people < n) {
      const g = { size: 0 };
      if (!this.spawn(g, target[0], target[1], 0)) break;
      this.groups.push(g);
      people += g.size; k++;
    }
    this.active = k;
    this.people = this.count = people;
  }

  /**
   * dt: real seconds. target: [x, z] Unity metres (camera focus). radius: living area.
   * vehicles: footprints to keep clear (clearVehicles).
   */
  update(dt, target, radius = this.radius, vehicles = []) {
    this.radius = radius;
    this.t += dt;
    this.dt = dt;
    const active = this.groups.slice(0, this.active ?? 0);
    const ws = active.map((g) => g.walker);
    steer(ws); // see each other coming: curve round early
    for (const g of active) this.fitShift(g, dt); // ...but never into a wall
    separate(ws); // personal space: never through another group
    const r = this.rand;
    for (const g of active) {
      const k = g.walker;
      if (Math.hypot(k.x - target[0], k.z - target[1]) > radius * 1.25) this.spawn(g, target[0], target[1], radius * 0.5);
      this.fitRoom(g, dt);
      this.mind(g, dt);
      // a bus or car coming across: wait at the kerb (don't walk into it), but not forever
      const ax = k.x + (k.dirX ?? 0) * LOOK_M, az = k.z + (k.dirZ ?? 1) * LOOK_M;
      if (g.pause <= 0 && vehicles.length && g.wait < WAIT_MAX_S && vehicles.some((f) => inVehiclePath(f, ax, az) && !inVehiclePath(f, k.x, k.z, 0, 0.3))) {
        g.wait += dt;
        k.stopped = true;
        k.slow = 0;
        k.pace = Math.max(0, k.pace - 6 * dt); // a kerb stop is a firm one (twice the usual braking)
        g.travelled = k.step(dt);
        clearVehicles([k], vehicles, g.size > 1 ? 1.9 : 0.9);
        continue;
      }
      k.stopped = g.pause > 0;
      if (g.wait > 0) g.wait = Math.max(0, g.wait - dt * 0.5);
      if (g.pause > 0) {
        g.pause -= dt;
        k.slow = 0;
        g.travelled = k.step(dt);
      } else {
        g.nextPause -= dt;
        if (g.nextPause <= 0) { // stop for a chat / to look around, then walk on
          g.pause = (g.size > 1 && g.chat ? 4 : 2) + r() * 8;
          g.nextPause = 25 + r() * 70;
          if (this.wet > 0.5 && g.wall) { // pouring: wait it out against the wall, facing the street
            g.pause += 6 + 14 * this.wet;
            g.shelter = (k.yaw + (g.wall > 0 ? -90 : 90) + 360) % 360;
          }
        }
        g.travelled = k.step(dt);
      }
      // the whole group stands around its leader: keep the leader that much further clear
      if (vehicles.length) clearVehicles([k], vehicles, g.size > 1 ? 1.9 : 0.9);
    }
  }

  /**
   * Narrow pavements: a group whose people would stand in a wall falls into single file (and
   * spreads out again where there is room); a leader against a wall drifts to the path's middle.
   * Checked a few times a second per group.
   */
  fitRoom(g, dt) {
    g.roomT -= dt;
    if (g.roomT <= 0) {
      g.roomT = 0.3;
      const k = g.walker, y = this.ground(k.x, k.z);
      g.y = y;
      if (!this.room(k.x, k.z, y)) { k.baseLateral *= 0.5; if (Math.abs(k.baseLateral) < 0.1) k.baseLateral = 0; }
      if (g.size > 1) {
        const side = g.members.some((m) => { const p = this.memberAt(g, m, 0); return !this.room(p.x, p.z, y); });
        g.fileGoal = side ? 1 : (g.fileGoal && g.members.some((m) => { const p = this.memberAt(g, m, 1, 0); return !this.room(p.x, p.z, y); }) ? 1 : 0);
      }
    }
    if (this.wet > WET) this.hugWall(g, dt);
    else if (g.wall) { g.wall = 0; g.walker.baseLateral = g.dryLateral ?? g.walker.baseLateral; }
    g.file += (g.fileGoal - g.file) * Math.min(1, dt * 2.5);
    g.walker.hw = ((g.size - 1) / 2) * SIDE * (1 - g.file);
  }

  /**
   * Giving way must not walk anyone into a wall: where the side a group wants to move to (steer's
   * w.shift) has no room, the shift is halved until it fits, and with no room at all the group
   * eases off and lets the other pass. Checked a few times a second, only for groups giving way.
   */
  fitShift(g, dt) {
    const k = g.walker, sh = k.shift || 0;
    if (Math.abs(sh) < 0.2) { g.shiftCap = null; return; }
    const sign = Math.sign(sh), base = k.baseLateral ?? 0;
    g.shiftT = (g.shiftT ?? 0) - dt;
    if (g.shiftT <= 0 || g.shiftCap == null || sign !== g.shiftSign) {
      g.shiftT = 0.25; g.shiftSign = sign;
      const rx = k.dirZ ?? 1, rz = -(k.dirX ?? 0), y = g.y ?? this.ground(k.x, k.z);
      let cap = Math.abs(sh);
      for (let q = 0; q < 3; q++) {
        const reach = base + sign * cap - k.lateral + sign * ((k.hw || 0) + 0.3);
        const px = k.x + rx * reach, pz = k.z + rz * reach, gy = this.ground(px, pz);
        if (this.room(px, pz, y) && Number.isFinite(gy) && Math.abs(gy - y) < 0.5) break; // room, and the same street level (not a stoop or a roof)
        cap = q === 2 ? 0 : cap * 0.5;
      }
      g.shiftCap = cap;
    }
    if (Math.abs(sh) > g.shiftCap) {
      k.lateralGoal = Math.max(-2.5, Math.min(2.5, base + sign * g.shiftCap));
      if (g.shiftCap < 0.2) k.slow = Math.min(k.slow, 0.5);
    }
  }

  /**
   * Rain: keep to the wall (under the eaves, awnings and arcades). About once a second the group
   * feels 0.7-3.1 m to each side of its path for a wall and moves its lateral place to just clear
   * of the nearer one (g.wall: -1 left, 1 right, 0 none).
   */
  hugWall(g, dt) {
    g.hugT = (g.hugT ?? 0) - dt;
    if (g.hugT > 0) return;
    g.hugT = 1 + (g.members[0].u ?? 0.5) * 0.5;
    const k = g.walker, rx = k.dirZ ?? 1, rz = -(k.dirX ?? 0), y = g.y ?? this.ground(k.x, k.z);
    const cx = k.x - rx * k.lateral, cz = k.z - rz * k.lateral; // the path itself
    let side = 0, clear = 0; // clear: the last free probe before the wall
    for (let q = 0; q < HUG_PROBES.length && !side; q++) {
      const d = HUG_PROBES[q];
      for (const s of [1, -1]) if (!side && !this.room(cx + rx * s * d, cz + rz * s * d, y)) { side = s; clear = q ? HUG_PROBES[q - 1] : 0; }
    }
    if (g.dryLateral === undefined || !g.wall) g.dryLateral = k.baseLateral;
    let want = side ? side * (clear - 0.3 - (k.hw || 0)) : 0;
    // only onto the same street level (not up a stoop, a step or an awning by the wall)
    const y0 = this.ground(cx, cz);
    for (let reach = Math.abs(want); ; reach -= 0.4) {
      if (reach < 0.15) { want = 0; break; }
      want = Math.sign(want) * reach;
      const gy = this.ground(cx + rx * want, cz + rz * want);
      if (Number.isFinite(gy) && Math.abs(gy - y0) < 0.25) break;
    }
    if (!side || Math.abs(want) < 0.15) { if (g.wall) { k.baseLateral = g.dryLateral; g.wall = 0; } return; }
    g.wall = side;
    k.baseLateral = Math.max(-2.5, Math.min(2.5, want));
  }

  /** Goals, looking, fleeing: the per-group state that reactions and routines set. */
  mind(g, dt) {
    const k = g.walker;
    if (k.goal) {
      g.goalT += dt;
      if (g.goalT > GOAL_MAX_S || Math.hypot(k.x - k.goal.x, k.z - k.goal.z) < k.goal.r) k.goal = null;
    }
    if (g.lookT > 0 && (g.lookT -= dt) <= 0) g.look = null;
    if (g.flee > 0) {
      g.flee -= dt;
      k.speed = g.flee > 0 ? g.pace * REACT.fleePace : g.pace;
    }
    if (g.pause <= 0) g.shelter = null;
  }

  /**
   * React to the player (reactions.js PlayerWatch.sample result, or null): look at jumps and
   * landings, step aside from a runner, scatter after a knock-down. Cheap: only groups within
   * reach, through squared distances.
   */
  react(seen, dt) {
    this.player = seen ? [seen.x, seen.z] : null; // heads turn to the player passing (draw)
    if (!seen) return;
    const n = this.active ?? 0, o = REACT;
    for (const ev of seen.events) {
      const reach = ev.kind === 'knock' ? o.scatterM : o.lookM;
      for (let q = 0; q < n; q++) {
        const g = this.groups[q], k = g.walker, dx = k.x - ev.x, dz = k.z - ev.z, d2 = dx * dx + dz * dz;
        if (d2 > reach * reach || d2 < 0.04) continue;
        const u = g.members[0].u ?? 0.5;
        if (ev.kind === 'knock') {
          g.look = [ev.x, ev.z]; g.lookT = o.startleS + o.fleeS;
          g.pause = Math.max(g.pause, o.startleS * (0.6 + u)); g.flee = o.startleS + o.fleeS;
          if ((k.dirX ?? 0) * -dx + (k.dirZ ?? 1) * -dz > 0) { k.reverse(); for (const m of g.members) m.off = -m.off; } // walking towards it: turn round
        } else if (u < 0.75 && g.flee <= 0) { // most people look; not everyone
          const look = o.lookS[0] + (o.lookS[1] - o.lookS[0]) * u;
          g.look = [ev.x, ev.z]; g.lookT = look;
          g.pause = Math.max(g.pause, look);
        }
      }
    }
    if (seen.running) {
      const reach = o.dodgeM + 2;
      for (let q = 0; q < n; q++) {
        const g = this.groups[q], k = g.walker, dx = k.x - seen.x, dz = k.z - seen.z;
        if (dx * dx + dz * dz > reach * reach) continue;
        const side = dodgeSide(k.x, k.z, k.dirX ?? 0, k.dirZ ?? 1, seen.x, seen.z, seen.vx, seen.vz, o.dodgeM + (k.hw || 0));
        if (!side) continue;
        k.lateral = Math.max(-3, Math.min(3, k.lateral + side * o.dodgeRate * dt));
        if (g.pause > 0 && !g.look) { g.look = [seen.x, seen.z]; g.lookT = 1; }
      }
    }
  }

  /** Where member m stands: side by side (file 0) .. one behind the other (file 1). */
  memberAt(g, m, file = g.file, fileTo = file) {
    const k = g.walker, fx = k.dirX ?? 0, fz = k.dirZ ?? 1, rx = fz, rz = -fx;
    const rank = g.members.indexOf(m);
    let side = m.off * (1 - fileTo), back = m.back + rank * FILE * file;
    if (g.size > 1) { // a loose formation: friends drift a little ahead and behind each other
      const t = this.t, u = m.u ?? 0.5;
      back += 0.14 * Math.sin(t * 0.21 + u * 40) * (1 - file);
    }
    return { x: k.x + rx * side - fx * back, z: k.z + rz * side - fz * back };
  }

  /** Ground under a member: never a roof (a person in a wall stays at the leader's height). */
  memberY(g, x, z) {
    const y = this.ground(x, z), base = g.y ?? this.ground(g.walker.x, g.walker.z);
    return Number.isFinite(y) && y - base <= 1.2 ? y : base;
  }

  /** What member m does while the group stands (rig.js IDLE): picked once per stop. */
  pickAct(g, m) {
    if (g.look) return IDLE.NONE; // watching something
    if (g.wait > 0) return IDLE.LOOK; // at the kerb: looking for a gap
    const u = m.u ?? 0.5, hands = m.v.acc !== 'umbrella' && m.v.acc !== 'bag' && m.v.kind !== 'kid';
    m.acts = (m.acts || 0) + 1;
    const h = (u * 97.13 + m.acts * 0.618) % 1;
    if (g.size > 1 && g.chat && g.shelter == null) return h < 0.7 ? IDLE.TALK : hands && h < 0.85 ? IDLE.HIPS : IDLE.NONE;
    return hands && h < 0.4 ? IDLE.PHONE : h < 0.75 ? IDLE.LOOK : hands && h < 0.87 ? IDLE.HIPS : IDLE.NONE;
  }

  /**
   * Where member m's head turns (rad from the body, + = to the left as the rig's headYaw): to what
   * the group is looking at, to the player passing close (some people, a glance at a time), or
   * to the friend walking beside them now and then. Things behind are not looked at.
   */
  headTarget(g, m, x, z, walking, t) {
    const u = m.u ?? 0.5;
    let at = g.look;
    if (!at && this.player && u < 0.65 && ((t * 0.22 + u * 7) % 1) < 0.5) {
      const dx = this.player[0] - x, dz = this.player[1] - z;
      if (dx * dx + dz * dz < NOTICE_M * NOTICE_M) at = this.player;
    }
    if (at) {
      const d = ((yawTo(x, z, at[0], at[1]) - m.yaw + 540) % 360) - 180;
      if (Math.abs(d) < 115) return Math.max(-HEAD_MAX, Math.min(HEAD_MAX, (-d * Math.PI) / 180));
    }
    if (walking && g.size > 1 && m.off !== 0 && ((t * 0.13 + u * 3) % 1) < 0.3) return Math.sign(m.off) * 0.5; // to the friend alongside
    return 0;
  }

  /** Add every visible person to the crowd (FigureCrowd). Ground from this.ground. */
  draw(crowd) {
    const t = this.t, dt = Math.max(this.dt || 0, 1 / 120);
    for (let q = 0; q < (this.active ?? 0); q++) {
      const g = this.groups[q], k = g.walker;
      const pace = k.pace ?? 1, walking = pace > 0.04 && g.travelled > 0;
      const speed = k.speed * pace;
      for (const m of g.members) {
        const { x, z } = this.memberAt(g, m);
        let yaw = k.yaw;
        if (!walking) {
          if (g.pause > 0 && g.size > 1 && g.chat) yaw = (k.yaw + (m.off < 0 ? 70 : -70) + 360) % 360; // turn to each other
          if (g.pause > 0 && g.shelter !== null && g.shelter !== undefined) yaw = g.shelter; // sheltering: watching the rain
          if (g.look) yaw = yawTo(x, z, g.look[0], g.look[1]); // looking at the player
        }
        m.yaw = turnToward(m.yaw, yaw, (walking ? 360 : 200) * dt);
        // feet on the ground: the stride of the pace actually walked (figure/gait.js)
        if (walking) m.phase += (g.travelled / (strideAt(Math.max(speed, 0.25)) * m.v.scale)) * Math.PI;
        // walking <-> standing eases (the rig blends the two poses), so nobody snaps to attention
        m.blend = (m.blend ?? 1) + ((walking ? 1 : 0) - (m.blend ?? 1)) * Math.min(1, dt * 7);
        if (!walking && m.act == null) m.act = this.pickAct(g, m);
        m.actK = Math.max(0, Math.min(1, (m.actK || 0) + (walking ? -4 : 1.6) * dt));
        if (walking && m.actK === 0) m.act = null;
        m.look = (m.look || 0) + (this.headTarget(g, m, x, z, walking, t) - (m.look || 0)) * Math.min(1, dt * 5);
        const b = m.blend, pose = { x, y: this.memberY(g, x, z), z: -z, rotY: (-m.yaw * Math.PI) / 180,
          mode: b > 0.02 ? MODE.WALK : MODE.IDLE, phase: m.phase, speed: Math.max(speed, 0.5), t: t + (m.u ?? 0) * 50, look: m.look };
        if (b > 0.02 && b < 0.98) pose.blend = b;
        if (b < 0.98 && m.act) { pose.idle = m.act; pose.idleK = m.actK; }
        crowd.add(m.v, pose);
      }
    }
  }

  /** Every person's position [{ x, z, y, g }] (Unity metres; g: group index) for the audit. */
  members() {
    const out = [];
    for (let q = 0; q < (this.active ?? 0); q++) {
      const g = this.groups[q];
      for (const m of g.members) {
        const { x, z } = this.memberAt(g, m);
        out.push({ x, z, y: this.memberY(g, x, z), g: q });
      }
    }
    return out;
  }

  /** Walker positions (for vehicles clearing, tests). */
  positions() { return this.groups.slice(0, this.active ?? 0).map((g) => g.walker); }
}
