import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker/index.js';
import { ExepertLobby } from '../worker/exepert/lobby-do.js';
import { ExepertRoom } from '../worker/exepert/room-do.js';
import { CODE_RE } from '../worker/exepert/shared.js';

/* In-memory stand-ins for Durable Object namespaces, storage and the rate limiter. */
function storage(){
  const map = new Map();
  return { map, get:async (k) => map.get(k), put:async (k, v) => { map.set(k, v); }, setAlarm:async () => {}, deleteAll:async () => map.clear() };
}
function namespace(make){
  const instances = new Map();
  return {
    instances,
    idFromName:(name) => name,
    get:(id) => {
      if (!instances.has(id)) instances.set(id, make(id));
      const obj = instances.get(id);
      return { fetch:(input, init) => obj.fetch(input instanceof Request ? input : new Request(input, init)) };
    },
  };
}
function makeEnv({ allow = true } = {}){
  const env = {};
  env.EXEPERT_LOBBY = namespace(() => new ExepertLobby({ storage:storage() }, env));
  env.EXEPERT_ROOMS = namespace(() => new ExepertRoom({ storage:storage(), acceptWebSocket(){} }, env));
  env.EXEPERT_RATE_LIMITER = { limit:async () => ({ success:allow }) };
  return env;
}
const call = (env, path, init = {}) => worker.fetch(new Request(`https://www.akmalalif.com${path}`, init), env, {});
const post = (env, path, body, headers = {}) => call(env, path, { method:'POST', headers:{ 'Content-Type':'application/json', ...headers }, body:JSON.stringify(body) });

test('private rooms get a Crockford code and remember their mode', async () => {
  const env = makeEnv();
  const res = await post(env, '/api/exepert/rooms', { mode:'ffa', sector:'silt' });
  assert.equal(res.status, 201);
  const { code } = await res.json();
  assert.match(code, CODE_RE);
  const status = await (await call(env, `/api/exepert/rooms/${code}`)).json();
  assert.equal(status.mode, 'ffa');
  assert.equal(status.priv, true);
});

test('quick play puts two runners in the same public room', async () => {
  const env = makeEnv();
  const a = await (await post(env, '/api/exepert/quickplay', { mode:'tdm' })).json();
  const b = await (await post(env, '/api/exepert/quickplay', { mode:'tdm' })).json();
  assert.equal(a.code, b.code);
  const status = await call(env, '/api/exepert/status');
  assert.equal(status.headers.get('Cache-Control'), 'public, max-age=15');
  const body = await status.json();
  assert.equal(body.rooms, 1);
  assert.equal(body.open, 1);
});

test('confirmed presence excludes quick-play reservations and expires old room heartbeats', async () => {
  const env = makeEnv();
  const { code } = await (await post(env, '/api/exepert/quickplay', { mode:'tdm' })).json();
  let status = await (await call(env, '/api/exepert/status')).json();
  assert.equal(status.players, 1);
  assert.equal(status.confirmed.players, null);
  assert.equal(status.confirmed.rooms, null);
  assert.equal(status.confirmed.status, 'unavailable');
  const actualLobby = [...env.EXEPERT_LOBBY.instances.values()][0];
  await actualLobby.fetch(new Request('https://lobby/report', {
    method:'POST', body:JSON.stringify({ code, mode:'tdm', humans:1, bots:7, max:8, phase:'live' }),
  }));
  await post(env, '/api/exepert/quickplay', { mode:'tdm' });
  status = await (await call(env, '/api/exepert/status')).json();
  assert.equal(status.players, 2);
  assert.equal(status.confirmed.players, 1);
  assert.equal(status.confirmed.bots, 7);
  assert.equal(status.confirmed.rooms, 1);
  assert.ok(status.confirmed.oldestHeartbeatAt);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 36_000;
    status = await (await call(env, '/api/exepert/status')).json();
    assert.equal(status.confirmed.players, null);
    assert.equal(status.confirmed.rooms, null);
    assert.equal(status.confirmed.status, 'unavailable');
  } finally {
    Date.now = realNow;
  }
  await actualLobby.fetch(new Request('https://lobby/report', {
    method:'POST', body:JSON.stringify({ code, closed:true }),
  }));
  status = await (await call(env, '/api/exepert/status')).json();
  assert.equal(status.confirmed.players, 0);
  assert.equal(status.confirmed.rooms, 0);
  assert.ok(status.confirmed.evidenceAt);
});

test('rooms from other sites, bad codes and unknown rooms are refused', async () => {
  const env = makeEnv();
  assert.equal((await post(env, '/api/exepert/rooms', { mode:'tdm' }, { Origin:'https://evil.example' })).status, 403);
  assert.equal((await call(env, '/api/exepert/rooms/abc')).status, 400);
  assert.equal((await call(env, '/api/exepert/rooms/ZZZZZ')).status, 404);
  assert.equal((await call(env, '/api/exepert/rooms/ZZZZZ/ws')).status, 426);
  assert.equal((await call(env, '/api/exepert/quickplay')).status, 405);
});

test('room creation is rate limited per address', async () => {
  const env = makeEnv({ allow:false });
  const res = await post(env, '/api/exepert/rooms', { mode:'tdm' });
  assert.equal(res.status, 429);
});

test('online play reports clearly when the Durable Objects are not bound', async () => {
  const res = await call({}, '/api/exepert/status');
  assert.equal(res.status, 503);
});

test('the Worker exports both Durable Object classes', async () => {
  const mod = await import('../worker/index.js');
  assert.equal(typeof mod.ExepertRoom, 'function');
  assert.equal(typeof mod.ExepertLobby, 'function');
});

test('room summaries carry mode counters through the server-only admin binding', async () => {
  const calls = [];
  const waits = [];
  const env = {
    PORTFOLIO_GATEWAY_TOKEN: 'room-secret',
    ADMIN: { fetch: async request => { calls.push(request); return new Response('ok'); } },
  };
  const ctx = { storage:storage(), acceptWebSocket(){}, waitUntil(promise){ waits.push(promise); } };
  const room = new ExepertRoom(ctx, env);
  room.queueSummary({
    matchId:'match-counters', mode:'uplink', sector:'full', startedAt:1, endedAt:2, status:'completed',
    result:{ winner:0 },
    telemetryCounters:{ captures:4, contests:2, deploys:3, loots:0, extractedValue:0 },
    participants:[{ participantId:'1', correlationToken:null, bot:false, kills:2, deaths:1, assists:1, score:90, details:{ team:0 } }],
  });
  await Promise.all(waits);
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.url, 'https://admin.internal/internal/gaming/summary');
  assert.equal(request.headers.get('X-Gaming-Service'), 'exepert-room');
  assert.equal(request.headers.get('X-Portfolio-Gateway'), 'room-secret');
  const body = await request.json();
  assert.equal(body.result.captures, 4);
  assert.equal(body.result.contests, 2);
  assert.equal(body.result.deploys, 3);
  assert.equal(body.code, undefined);
  assert.equal(body.participants[0].details.team, 0);
  assert.equal(body.participants[0].details.x, undefined);
});
