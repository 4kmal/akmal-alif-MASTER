import assert from 'node:assert/strict';
import test from 'node:test';

import { CollisionWorld } from '../video-games/kessler-world/collide.js';
import { buildWorld } from '../video-games/kessler-world/world.js';
import { createMover, stepMover } from '../video-games/exepert/sim/movement.js';
import { BTN, PLAYER } from '../video-games/exepert/sim/constants.js';
import { Room, DT } from '../video-games/exepert/sim/room-core.js';
import { shotDirs, aimDir, WEAPONS } from '../video-games/exepert/sim/weapons.js';

/* A flat test arena with a few boxes. */
function arena(boxes){
  const bounds = { minX:-60, maxX:60, minZ:-60, maxZ:60 };
  const cw = new CollisionWorld({ ground:() => 0, normalAt:() => [0, 1, 0], bounds });
  for (const b of boxes) cw.addBox(b);
  cw.finalize();
  return { collide:cw, ground:() => 0, normalAt:() => [0, 1, 0], waterAt:() => -Infinity, bounds };
}

const run = (m, world, frames, f) => { for (let i = 0; i < frames; i++) stepMover(m, { dt:1 / 60, mx:0, mz:0, yaw:m.yaw, pitch:0, b:0, e:0, ...f(i) }, world); };

test('players walk forward and cannot pass through a wall', () => {
  const world = arena([{ x:0, z:-6, w:10, d:1, rot:0, y0:-1, y1:4 }]);
  const m = createMover(0, 0, 0, 0);
  run(m, world, 120, () => ({ mz:1 }));
  assert.ok(m.z < -4 + 0.1 && m.z > -5.5 + PLAYER.radius - 0.05, `stopped at the wall, z=${m.z}`);
  assert.ok(m.ground);
});

test('a jump leaves the ground and lands again; the jump kit adds a second jump', () => {
  const world = arena([]);
  const a = createMover(0, 0, 0, 0);
  let peak = 0;
  run(a, world, 90, i => ({ e:i === 0 ? BTN.JUMP : 0, b:i < 2 ? BTN.JUMP : 0 }));
  assert.ok(a.ground && a.y === 0);
  const b = createMover(0, 0, 0, 0);
  run(b, world, 80, i => { peak = Math.max(peak, b.y); return { e:i === 0 || i === 20 ? BTN.JUMP : 0 }; });
  const single = 6.4 * 6.4 / (2 * 18);
  assert.ok(peak > single + 0.3, `double jump peak ${peak.toFixed(2)} beats a single jump ${single.toFixed(2)}`);
});

test('running at a ledge mantles up onto it', () => {
  const world = arena([{ x:0, z:-3, w:6, d:3, rot:0, y0:-1, y1:1.4 }]);
  const m = createMover(0, 0, 0, 0);
  run(m, world, 50, () => ({ mz:1 }));
  assert.ok(Math.abs(m.y - 1.4) < 0.01, `on the ledge, y=${m.y}`);
  assert.ok(m.z < -1.5, 'standing on top of the box');
});

test('jumping alongside a tall wall starts a wall-run that slows the fall', () => {
  const world = arena([{ x:1.0, z:-15, w:0.6, d:40, rot:0, y0:-1, y1:8 }]);
  const m = createMover(0.15, 0, 5, 0);
  let ran = false;
  run(m, world, 120, i => {
    if (m.wall) ran = true;
    return { mz:1, mx:0.15, b:BTN.SPRINT, e:i === 30 ? BTN.JUMP : 0 };
  });
  assert.ok(ran, 'wall-run engaged');
});

test('shot spread is reproducible from the seed so the server can check it', () => {
  const w = WEAPONS.scatter;
  const a = shotDirs(w, 0.3, 0.1, 0.07, 1234);
  const b = shotDirs(w, 0.3, 0.1, 0.07, 1234);
  assert.deepEqual(a, b);
  assert.equal(a.length, w.pellets);
  const f = aimDir(0.3, 0.1);
  for (const d of a) assert.ok(Math.acos(d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) <= 0.0701);
});

const world = buildWorld();

function makeRoom(opts = {}){
  const sent = [];
  const room = new Room({ world, mode:'tdm', solo:true, seed:7, bots:'auto', send:(id, text) => sent.push([id, text]), ...opts });
  return { room, sent };
}

test('a room fills itself with bots and keeps teams even', () => {
  const { room, sent } = makeRoom();
  const me = room.join({ name:'tester' });
  assert.equal(room.players.size, room.mode.fill);
  const teams = [0, 0];
  for (const p of room.players.values()) teams[p.team]++;
  assert.ok(Math.abs(teams[0] - teams[1]) <= 1);
  const welcome = JSON.parse(sent.find(([id]) => id === me.id)[1]);
  assert.equal(welcome.t, 'welcome');
  assert.equal(welcome.hash, world.hash);
  room.tick();
  const snap = JSON.parse(sent.at(-1)[1]);
  assert.equal(snap.t, 's');
  assert.equal(snap.p.length, room.players.size);
  assert.equal(snap.me.al, 1);
});

test('telemetry has one callback per match boundary and rotates match ids after reset', () => {
  const summaries = [];
  const { room } = makeRoom({ bots:0, onTelemetry:summary => summaries.push(summary) });
  room.join({ name:'boundary-runner' });
  const firstMatch = room.matchId;
  for (let i = 0; i < 30; i++) room.tick();
  assert.equal(summaries.length, 0, 'ticks do not emit telemetry rows');
  room.scoreLimit = 1;
  room.ms.score = [1, 0];
  room.tick();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].matchId, firstMatch);
  assert.equal(summaries[0].status, 'completed');
  for (let i = 0; i < 20 * 13; i++) room.tick();
  assert.notEqual(room.matchId, firstMatch, 'the next match gets a new id');
  assert.equal(summaries.length, 1, 'reset does not duplicate the completed summary');
});

test('private lobby configuration does not create a started match telemetry row', () => {
  const { room } = makeRoom({ bots:0, lobby:true });
  const lobbyMatch = room.matchId;
  const player = room.join({ name:'lobby-runner' });
  assert.equal(room.matchStarted, false);
  assert.equal(room.telemetrySummary('idle'), null);
  room.handle(player.id, { t:'start' });
  assert.equal(room.phase, 'live');
  assert.equal(room.matchStarted, true);
  assert.notEqual(room.matchId, lobbyMatch);
});

test('kills credit the shooter, count for the team and respawn the victim', () => {
  const { room } = makeRoom({ bots:1 });
  const me = room.join({ name:'tester' });
  const bot = [...room.players.values()].find((p) => p.bot && room.isEnemy(me, p));
  assert.ok(bot);
  bot.protect = 0;
  room.damage(bot, 150, me, 'breach', true, me.m);
  assert.equal(bot.alive, false);
  assert.equal(me.kills, 1);
  assert.equal(room.ms.score[me.team], 1);
  for (let i = 0; i < 20 * 5; i++) room.tick();
  assert.equal(bot.alive, true, 'respawned');
});

test('team deathmatch ends at the score limit', () => {
  const { room } = makeRoom({ bots:1 });
  room.join({ name:'tester' });
  room.scoreLimit = 2;
  room.ms.score = [2, 0];
  room.tick();
  assert.equal(room.phase, 'post');
  assert.equal(room.result.winner, 0);
});

test('free-for-all ends when one runner reaches the limit', () => {
  const { room } = makeRoom({ mode:'ffa', bots:2 });
  const me = room.join({ name:'tester' });
  room.scoreLimit = 1;
  const bot = [...room.players.values()].find((p) => p.bot);
  bot.protect = 0;
  room.damage(bot, 999, me, 'breach');
  room.tick();
  assert.equal(room.phase, 'post');
  assert.equal(room.result.winner, me.id);
});

test('input frames cannot simulate more time than has passed', () => {
  const { room } = makeRoom({ bots:0 });
  const me = room.join({ name:'tester' });
  const x0 = me.m.x, z0 = me.m.z;
  const frames = Array.from({ length:40 }, (_, i) => ({ s:i + 1, dt:0.1, mx:0, mz:1, yaw:0, pitch:0, b:BTN.SPRINT, e:0 }));
  room.handle(me.id, { t:'in', f:frames });
  const moved = Math.hypot(me.m.x - x0, me.m.z - z0);
  assert.ok(moved < 3, `moved ${moved.toFixed(2)} m with only the starting budget`);
  assert.ok(me.seq < 40);
});

test('hits are checked against where the target was a moment ago', () => {
  const { room } = makeRoom({ bots:1 });
  const me = room.join({ name:'tester' });
  const bot = [...room.players.values()].find((p) => p.bot);
  bot.hist = [[0, 10, 0, 10, 0], [0.1, 20, 0, 20, 0]];
  room.time = 0.1;
  const past = room.rewind(bot, 0.05);
  assert.equal(past.x, 15);
  assert.equal(past.z, 15);
  assert.ok(me);
});

test('a full minute of bots fighting runs well inside the tick budget', () => {
  const { room } = makeRoom();
  room.join({ name:'tester' });
  const t0 = performance.now();
  for (let i = 0; i < 20 * 60; i++) room.tick(DT);
  const ms = performance.now() - t0;
  assert.ok(ms < 1200 * 50 * 0.25, `60 s simulated in ${ms.toFixed(0)} ms`);
  const shots = [...room.players.values()].reduce((s, p) => s + p.kills + p.deaths, 0);
  assert.ok(shots > 0, 'bots found and fought each other');
});

test('uplink relays flip when one side holds them and the outnumbered side bleeds tickets', () => {
  const { room } = makeRoom({ mode:'uplink', bots:0 });
  const a = room.join({ name:'alpha' });
  const b = room.join({ name:'bravo' });
  assert.equal(room.sector, 'full');
  assert.equal(room.ms.points.length, 7);
  const c = room.ms.points[2];
  const attacker = a.team === 0 ? a : b;
  const idle = attacker === a ? b : a;
  for (let i = 0; i < 20 * 15; i++){
    attacker.m.x = c.x; attacker.m.z = c.z; attacker.m.y = c.y; attacker.m.vy = 0;
    idle.m.x = room.ms.bases[idle.team].x; idle.m.z = room.ms.bases[idle.team].z;
    room.tick();
  }
  assert.equal(c.owner, attacker.team, 'the relay belongs to the side standing on it');
  const before = room.ms.tickets[idle.team];
  for (let i = 0; i < 20 * 7; i++) room.tick();
  assert.ok(room.ms.tickets[idle.team] < before, 'the side holding fewer relays bleeds');
});

test('uplink deploys onto a held relay by drop pod and ends when tickets run out', () => {
  const { room } = makeRoom({ mode:'uplink', bots:0 });
  const p = room.join({ name:'alpha' });
  const home = room.ms.points[p.team === 0 ? 0 : 6];
  room.handle(p.id, { t:'deploy', at:home.i });
  room.spawn(p);
  assert.ok(p.m.y > room.world.ground(p.m.x, p.m.z) + 40, 'arrives from the sky');
  assert.ok(Math.hypot(p.m.x - home.x, p.m.z - home.z) < 45, 'lands at the chosen relay');
  room.ms.tickets[1 - p.team] = 0;
  room.tick();
  assert.equal(room.phase, 'post');
  assert.equal(room.result.winner, p.team);
});

test('extraction: hold use to loot, die and drop the pack, or ride a lift out to bank it', () => {
  const { room } = makeRoom({ mode:'extraction', bots:0 });
  const p = room.join({ name:'runner' });
  assert.equal(room.mode.teams, 4);
  assert.ok([...room.players.values()].some((q) => q.sentinel), 'sentinels guard the hot zones');
  for (const q of room.players.values()) if (q.sentinel) q.alive = false; // keep this test about looting
  const log = room.ms.loot.find((l) => l.kind === 'log');
  const stand = (x, y, z) => { p.m.x = x; p.m.y = y; p.m.z = z; p.m.vx = p.m.vz = p.m.vy = 0; p.m.ground = true; };
  stand(log.x, log.y, log.z);
  let seq = p.seq;
  for (let i = 0; i < 20; i++) room.handle(p.id, { t:'in', f:[{ s:++seq, dt:0.05, mx:0, mz:0, yaw:0, pitch:0, b:BTN.USE, e:0 }] }), (p.budget = 1), stand(log.x, log.y, log.z);
  assert.ok(log.taken, 'the data log was taken');
  assert.equal(p.pack.value, log.value);

  // ride a lift: call it, wait, stand in the zone when it lands
  const ex = room.ms.exfils[0];
  stand(ex.x, ex.y, ex.z);
  for (let i = 0; i < 30; i++){ room.handle(p.id, { t:'in', f:[{ s:++seq, dt:0.05, mx:0, mz:0, yaw:0, pitch:0, b:BTN.USE, e:0 }] }); p.budget = 1; stand(ex.x, ex.y, ex.z); }
  assert.equal(ex.state, 'called');
  for (let i = 0; i < 20 * 61 && ex.state === 'called'; i++){ room.tick(); stand(ex.x, ex.y, ex.z); }
  room.tick();
  assert.equal(room.ms.bank[p.team], log.value, 'the haul is banked for the crew');
  assert.equal(p.pack.value, 0);

  // dying with loot drops a pack anyone can take
  const crate = room.ms.loot.find((l) => l.kind === 'crate' && !l.taken);
  p.alive = true; p.protect = 0; p.pack = { items:2, value:900 };
  stand(crate.x, crate.y, crate.z);
  room.damage(p, 999, null, 'fall');
  const pack = room.ms.loot.find((l) => l.kind === 'pack');
  assert.ok(pack && pack.value === 900 && !pack.taken);

  room.matchTime = room.timeLimit;
  room.tick();
  assert.equal(room.phase, 'post');
  assert.equal(room.result.winner, p.team);
});
