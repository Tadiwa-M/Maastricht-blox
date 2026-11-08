import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CTF, newGame, join, disconnect, remove, start, move, tick, nextDeadline, expired, publicState, segDist,
  inArena, cleanName, cleanLook, rebalance, carried, teamCounts } from '../src/ctf.js';
import { makeCode, parseCode, CODE_LETTERS } from '../src/rooms.js';

const B = CTF.bases.blue.at, Y = CTF.bases.yellow.at;
const at = ([x, z], dx = 0, dz = 0) => ({ p: [x + dx, 50, z + dz], r: 0, s: 4 });
const kinds = (res) => res.events.map((e) => e.k);

/** A started 2v2: ids 1, 3 blue; 2, 4 yellow. Everyone near their own base. */
function match(now = 1000, n = 4) {
  const g = newGame('ABCD', 0);
  for (let q = 1; q <= n; q++) join(g, { pid: `player-${q}xx`, name: `P${q}` }, now);
  assert.ok(start(g, 1, now).ok);
  for (const p of Object.values(g.players)) move(g, p.id, at(CTF.bases[p.team].at, -8 * p.id), now); // 8 m apart, west
  return g;
}

/** Walk player id along to `to` in steps (as 10 Hz updates would). */
function walk(g, id, to, now, steps = 1) {
  let res = { events: [] };
  const from = g.players[id].at;
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    const r = move(g, id, { p: [from[0] + (to[0] - from[0]) * k, 50, from[1] + (to[1] - from[1]) * k] }, now + s * 100);
    res = { events: [...res.events, ...r.events] };
  }
  return res;
}

test('names, looks, codes: cleaned', () => {
  assert.equal(cleanName('  <b>Anna</b>  the great!!'), 'bAnnab the g');
  assert.equal(cleanName(''), 'Player');
  assert.equal(cleanLook('a0123456789ab'), 'a0123456789ab');
  assert.equal(cleanLook('A"><script>'), '');
  assert.equal(makeCode(() => 0), 'AAAA');
  assert.ok([...makeCode()].every((c) => CODE_LETTERS.includes(c)));
  assert.equal(parseCode(' abcd '), 'ABCD');
  assert.equal(parseCode('ABIO'), null); // no I or O
  assert.equal(parseCode('ABC'), null);
});

test('arena: a capsule round the line Markt-Vrijthof', () => {
  assert.equal(segDist([0, 5], [0, 0], [10, 0]), 5);
  assert.equal(segDist([13, 4], [0, 0], [10, 0]), 5);
  assert.ok(inArena([(B[0] + Y[0]) / 2, (B[1] + Y[1]) / 2]));
  assert.ok(!inArena([B[0] + CTF.arenaR + 5, B[1]]));
});

test('join: teams auto-balanced, host is the first, full at 8, rejoin keeps the place', () => {
  const g = newGame('ABCD', 0);
  const ids = [];
  for (let q = 0; q < 8; q++) ids.push(join(g, { pid: `pid-${q}-abcdef`, name: `N${q}` }, 0).id);
  assert.deepEqual(teamCounts(g), { blue: 4, yellow: 4 });
  assert.equal(g.host, ids[0]);
  assert.equal(join(g, { pid: 'pid-9-abcdef' }, 0).error, 'full');
  assert.equal(join(g, { pid: 'x' }, 0).error, 'bad player id');
  disconnect(g, ids[0], 10);
  const back = join(g, { pid: 'pid-0-abcdef', name: 'Again' }, 20);
  assert.deepEqual([back.ok, back.id, back.rejoin, g.players[back.id].name], [true, ids[0], true, 'Again']);
  remove(g, ids[0], 30);
  assert.equal(g.host, ids[1]); // the next one hosts
  assert.ok(!publicState(g, 0).players.some((p) => 'pid' in p)); // pids stay secret
});

test('start: host only, 2+ players, teams rebalanced', () => {
  const g = newGame('ABCD', 0);
  const a = join(g, { pid: 'aaaaaaaa' }, 0).id;
  assert.equal(start(g, a, 0).error, 'needs 2 players');
  const b = join(g, { pid: 'bbbbbbbb' }, 0).id;
  assert.equal(start(g, b, 0).error, 'only the host can start');
  g.players[b].team = 'blue';
  const c = join(g, { pid: 'cccccccc' }, 0).id; // yellow (fewer)
  g.players[c].team = 'blue';
  rebalance(g);
  assert.deepEqual(teamCounts(g), { blue: 2, yellow: 1 });
  const r = start(g, a, 5000);
  assert.deepEqual([r.ok, g.phase, g.round, g.endsAt, kinds(r)], [true, 'play', 1, 5000 + CTF.matchS * 1000, ['start']]);
});

test('pick up the enemy flag, carry it home while yours is home: a capture', () => {
  const g = match();
  let r = walk(g, 1, Y, 2000, 40); // blue 1 runs to the Vrijthof (~8 m steps: running, not teleporting)
  assert.deepEqual(kinds(r), ['pickup']);
  assert.equal(carried(g, 1), 'yellow');
  r = walk(g, 1, B, 6000, 40);
  assert.deepEqual(kinds(r), ['capture']);
  assert.deepEqual(g.score, { blue: 1, yellow: 0 });
  assert.equal(g.flags.yellow.st, 'home');
});

test('no capture while your own flag is away', () => {
  const g = match();
  g.players[2].at = [B[0] + 2, B[1]];
  assert.deepEqual(kinds(move(g, 2, at(B, 1), 2000)), ['pickup']); // yellow 2 takes blue's flag
  g.players[1].at = [Y[0] + 2, Y[1]];
  assert.deepEqual(kinds(move(g, 1, at(Y, 1), 2000)), ['pickup']); // blue 1 takes yellow's
  g.players[1].at = [B[0], B[1] + 5];
  move(g, 2, at(B, 0, -20), 2100); // yellow 2 leaves the Markt
  const r = move(g, 1, at(B, 0, 1), 2200);
  assert.deepEqual(kinds(r), []);
  assert.equal(g.score.blue, 0);
});

test('running into the carrier knocks them down; the flag drops, then goes home after 20 s', () => {
  const g = match();
  g.players[1].at = [Y[0] + 2, Y[1]];
  move(g, 1, at(Y, 1), 2000); // blue 1 carries yellow's flag
  move(g, 1, at(Y, 0, 25), 2100);
  let r = move(g, 2, at(Y, 0.5, 25.5), 2200); // yellow 2 runs into them
  assert.deepEqual(kinds(r), ['tag']);
  assert.deepEqual([r.events[0].id, r.events[0].by, r.events[0].team], [1, 2, 'yellow']);
  assert.equal(g.flags.yellow.st, 'dropped');
  assert.deepEqual(g.flags.yellow.at, [Y[0], Y[1] + 25]);
  r = move(g, 1, at(Y, 0, 25), 2300); // knocked down: can't pick it straight up again
  assert.deepEqual(kinds(r), []);
  r = move(g, 2, at(Y, 0, 60), 2400); // the tagger walks off (the drop lock was still on)
  assert.equal(nextDeadline(g), 2200 + CTF.returnS * 1000);
  assert.deepEqual(kinds(tick(g, 2200 + CTF.returnS * 1000)), ['return']);
  assert.equal(g.flags.yellow.st, 'home');
});

test('a teammate touching the dropped flag returns it; the carrier running into an enemy is knocked too', () => {
  const g = match();
  g.players[1].at = [Y[0] + 2, Y[1]];
  move(g, 1, at(Y, 1), 2000);
  move(g, 1, at(Y, 0, 25), 2100);
  move(g, 4, at(Y, 0, 50), 2100); // yellow 4 stands still at +50
  const r = move(g, 1, at(Y, 0.4, 49.5), 2200); // the carrier runs into them
  assert.deepEqual(kinds(r), ['tag']);
  assert.equal(r.events[0].id, 1);
  move(g, 4, at(Y, 0, 70), 2300);
  assert.deepEqual(kinds(move(g, 4, at(Y, 0.4, 49.5), 4000)), ['return']); // after the drop lock
  // the tagger standing still on the dropped flag returns it when the lock ends (via the timers)
  g.players[1].at = [Y[0] + 2, Y[1]];
  move(g, 1, at(Y, 1), 8000); // (no longer knocked down)
  move(g, 1, at(Y, 0, 25), 8100);
  move(g, 2, at(Y, 0.5, 25.5), 8200);
  assert.equal(g.flags.yellow.st, 'dropped');
  assert.deepEqual(kinds(tick(g, 8200 + CTF.dropLockS * 1000 - 1)), []);
  assert.deepEqual(kinds(tick(g, 8200 + CTF.dropLockS * 1000 + 100)), ['return']);
  // a blue teammate could have picked it up instead (it is their enemy flag)
});

test('a carrier leaving the arena or teleporting: the flag goes home', () => {
  const g = match();
  g.players[1].at = [Y[0] + 2, Y[1]];
  move(g, 1, at(Y, 1), 2000);
  let r = move(g, 1, at(B, 0, -2), 2100); // teleported to their own base: no capture
  assert.deepEqual(kinds(r), ['return']);
  assert.equal(g.score.blue, 0);
  walk(g, 1, Y, 3000, 40);
  assert.equal(carried(g, 1), 'yellow');
  r = walk(g, 1, [Y[0], Y[1] - CTF.arenaR - 15], 8000, 14); // runs out of the old town
  assert.deepEqual(kinds(r), ['return']);
  assert.equal(carried(g, 1), null);
});

test('first to 3 wins; or most captures when the clock runs out', () => {
  const g = match();
  for (let q = 0; q < 3; q++) {
    g.players[1].at = [Y[0] + 2, Y[1]];
    move(g, 1, at(Y, 1), 2000 + q);
    g.players[1].at = [B[0] + 5, B[1]];
    move(g, 1, at(B, 1), 2000 + q);
  }
  assert.deepEqual([g.phase, g.winner, g.score.blue], ['over', 'blue', 3]);
  assert.ok(start(g, 1, 10_000).ok); // rematch
  assert.deepEqual(g.score, { blue: 0, yellow: 0 });
  g.score.yellow = 1;
  assert.deepEqual(kinds(tick(g, g.endsAt)), ['over']);
  assert.equal(g.winner, 'yellow');
});

test('a dropped connection keeps its place 30 s, then leaves and drops the flag; empty rooms expire', () => {
  const g = match();
  g.players[2].at = [B[0] + 2, B[1]];
  move(g, 2, at(B, 1), 2000);
  move(g, 2, at(B, 0, -20), 2100);
  disconnect(g, 2, 3000);
  assert.equal(nextDeadline(g), 3000 + CTF.graceS * 1000);
  assert.deepEqual(kinds(tick(g, 3000 + CTF.graceS * 1000)), ['leave', 'drop']);
  assert.equal(g.flags.blue.st, 'dropped');
  const e = newGame('WXYZ', 0);
  assert.ok(!expired(e, 1000));
  assert.ok(expired(e, CTF.idleRoomS * 1000));
});
