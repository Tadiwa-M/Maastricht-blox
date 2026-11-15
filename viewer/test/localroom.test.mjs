// The local games (src/mp/localroom.js, bots.js): run on a fake clock and an open plain (no walls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalRoom, RAID } from '../src/mp/localroom.js';
import { Bot, ctfGoal, hitChance, BOT } from '../src/mp/bots.js';

const nav = { path: null, height: () => 50, los: () => true, spawnNear: (at, r) => [at[0] + r, at[1]] };
const who = () => ({ pid: 'humanplayer01', name: 'Me', look: '' });

function room(mode) {
  let now = 1_000_000;
  const msgs = [];
  const r = new LocalRoom({ mode, who, nav, onMessage: (m) => msgs.push(m), clock: () => now, auto: false, rand: (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })() });
  const run = (seconds) => { for (let k = 0; k < seconds * 10; k++) { now += 100; r.step(0.1); } };
  return { r, msgs, run, at: () => now };
}

test('bots: 4 against 4, the match starts at once on the Markt and the Vrijthof, and bots go for the flag', async () => {
  const { r, run } = room('bots');
  const ps = Object.values(r.g.players);
  assert.equal(ps.length, 8);
  assert.equal(ps.filter((p) => p.team === 'blue').length, 4);
  assert.equal(r.g.phase, 'play');
  assert.equal(r.g.bases.blue.name, 'Markt');
  const attackers = [...r.bots.values()].filter((b) => b.role === 'attack');
  assert.ok(attackers.length >= 2);
  run(60);
  const moved = [...r.bots.values()].filter((b) => Math.hypot(b.at[0] - r.g.bases.blue.at[0], b.at[1] - r.g.bases.blue.at[1]) > 20 && Math.hypot(b.at[0] - r.g.bases.yellow.at[0], b.at[1] - r.g.bases.yellow.at[1]) > 20);
  const shots = [];
  run(120);
  // in three minutes on an open plain something happens: knock-outs or a flag taken
  const any = Object.values(r.g.players).some((p) => p.kills > 0 || p.caps > 0) || ['blue', 'yellow'].some((t) => r.g.flags[t].st !== 'home') || r.g.score.blue + r.g.score.yellow > 0;
  assert.ok(any || moved.length > 0, 'the bots did something');
  void shots;
});

test('my messages go through the same rules, and the client hears a welcome first', async () => {
  const { r, msgs } = room('bots');
  await new Promise((res) => setTimeout(res, 0));
  assert.equal(msgs[0].t, 'welcome');
  assert.equal(msgs[0].you, r.me);
  assert.equal(msgs[0].mode, 'bots');
  const base = r.g.bases.blue.at;
  r.send(JSON.stringify({ t: 'p', p: [base[0], 50, base[1]], r: 0, s: 0 })); // as the client sends it (protocol.js posMessage)
  assert.deepEqual(r.g.players[r.me].at, base);
});

test('raid: waves come out of the Helpoort, knocked-out raiders crumble, and surviving every wave is dawn', async () => {
  const { r, run, at } = room('raid');
  assert.equal(r.g.bases.yellow.name, 'Helpoort');
  assert.equal(r.g.phase, 'play');
  run(RAID.breakS[0] + 1);
  const raiders = () => Object.values(r.g.players).filter((p) => p.raider);
  assert.equal(raiders().length, RAID.size(1));
  // knock them all out by hand (the room's shoot rule), then they crumble and the next wave comes
  for (let w = 1; w <= RAID.waves; w++) {
    for (const q of raiders()) { q.hp = 1; r.g.players[r.me].at = [q.at[0] - 3, q.at[1]]; r.g.players[r.me].t = at(); r.g.players[r.me].shotAt = 0; r.g.players[r.me].safe = 0; r.g.players[r.me].down = 0;
      r.send({ t: 'shot', w: 'rifle', o: [q.at[0] - 3, 51, q.at[1]], e: [q.at[0], 51, q.at[1]], hit: q.id, head: false }); }
    run(RAID.removeS + 0.5);
    assert.equal(raiders().length, 0, `wave ${w} gone`);
    if (w < RAID.waves) { run(RAID.breakS[1] + 0.5); assert.equal(r.raid.wave, w + 1); }
  }
  run(1);
  assert.equal(r.g.phase, 'over');
  assert.equal(r.g.winner, 'blue');
  assert.equal(r.raid.kills, Array.from({ length: RAID.waves }, (_, k) => RAID.size(k + 1)).reduce((a, b) => a + b, 0));
});

test('bot brain: a carrier runs home, a defender stays by its base, hits get rarer with distance', () => {
  const g = { bases: { blue: { at: [0, 0] }, yellow: { at: [300, 0] } }, flags: { blue: { st: 'home', at: [0, 0] }, yellow: { st: 'carried', at: [300, 0], by: 1 } },
    players: { 1: { id: 1, team: 'blue', at: [200, 0], down: 0 }, 2: { id: 2, team: 'blue', at: [5, 5], down: 0 } } };
  assert.deepEqual(ctfGoal(g, g.players[1], { role: 'attack' }, 0), [0, 0]);
  const goal = ctfGoal(g, g.players[2], { role: 'defend' }, 0, () => 0.5);
  assert.ok(Math.hypot(goal[0], goal[1]) <= 16);
  assert.ok(hitChance(2) > hitChance(BOT.sight - 1));
  const b = new Bot(1);
  assert.ok(b);
});

test('raid: raiders go for a person standing by the banner and hurt them', () => {
  const { r, run, at } = room('raid');
  const me = r.g.players[r.me], base = r.g.bases.blue.at;
  const stand = () => { me.at = [base[0] + 4, base[1]]; me.y = 50; me.t = at(); };
  stand();
  let hurt = false;
  for (let k = 0; k < 900 && !hurt; k++) { stand(); run(0.1); hurt = me.hp < 100 || me.deaths > 0; }
  assert.ok(hurt, 'a raider got to me and swiped');
});
