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
