import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createSync } from '../server/sync.mjs';
import { openStore } from '../server/store.mjs';

async function fixture() {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(resolve(parent, 'sdc-sync-test-'));
  await mkdir(resolve(directory, 'data'));
  await mkdir(resolve(directory, 'sources'));
  await writeFile(resolve(directory, 'data/device-credential.json'), JSON.stringify({ token: 'synthetic-test-token-not-a-real-credential', deviceId: 'fixture-device' }));
  await writeFile(resolve(directory, 'sources/Scoresheet D1-J04 - Muhammad Akmal Alif bin Azam.xlsx'), 'synthetic template bytes');
  const store = openStore(':memory:');
  return { directory, store, async close() { store.close(); assert.ok(directory.startsWith(parent + sep) && directory.includes('sdc-sync-test-')); await rm(directory, { recursive: true, force: true }); } };
}

async function settled(sync) {
  for (let count = 0; count < 100; count++) {
    if (['synced', 'offline', 'expired', 'conflict'].includes(sync.status().status)) return;
    await delay(5);
  }
  throw new Error('Sync did not settle');
}

test('sync automatically drains the outbox, reuses mutation IDs after failures, and recovers a restored cursor', async (t) => {
  const current = await fixture();
  const { store } = current;
  store.upsert('judge', { name: 'Local judge' });
  store.setMeta('cloudCursor', 99);
  const mutations = [];
  const paths = [];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname + new URL(url).search;
    paths.push(path);
    assert.equal(init.redirect, 'error');
    assert.match(init.headers.Authorization, /^Bearer synthetic-test/);
    if (path.endsWith('/template')) return Response.json({ stored: true });
    if (path.endsWith('/records')) {
      const input = JSON.parse(init.body);
      mutations.push(input.mutationId);
      if (fail) return Response.json({ error: 'Temporary service failure' }, { status: 503 });
      return Response.json({ key: input.key, version: 1, data: input.data });
    }
    if (path.endsWith('/state?cursor=99')) return Response.json({ error: 'Cursor ahead' }, { status: 400 });
    if (path.endsWith('/state')) return Response.json({ records: [], cursor: 1 });
    throw new Error(`Unexpected sync request: ${path}`);
  });
  const sync = createSync(current.directory, store);
  try {
    await settled(sync);
    assert.equal(sync.status().status, 'offline');
    assert.equal(store.pendingCount(), 1);
    fail = false;
    await sync.tick();
    assert.equal(sync.status().status, 'synced');
    assert.equal(store.pendingCount(), 0);
    assert.equal(mutations[0], mutations[1]);
    assert.equal(store.meta('cloudCursor'), 1);
    assert.ok(paths.some(path => path.endsWith('/state?cursor=99')));
    assert.ok(paths.some(path => path.endsWith('/state')));
    assert.equal(store.get('judge').data.name, 'Local judge');
  } finally { sync.stop(); await current.close(); }
});

test('revoked device responses leave local edits queued and request renewed pairing', async (t) => {
  const current = await fixture();
  current.store.upsert('judge', { name: 'Offline edit' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Revoked' }, { status: 401 }));
  const sync = createSync(current.directory, current.store);
  try {
    await settled(sync);
    assert.equal(sync.status().status, 'expired');
    assert.equal(current.store.pendingCount(), 1);
    assert.match(sync.status().error, /Pair again/);
  } finally { sync.stop(); await current.close(); }
});
