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
