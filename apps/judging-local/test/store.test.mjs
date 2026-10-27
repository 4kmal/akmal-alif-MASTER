import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.mjs';

test('local saves preserve blanks and reject stale versions and duplicate mutation misuse', () => {
  const store = openStore(':memory:');
  try {
    const input = { key: 'review:01-console', baseVersion: 0, data: { scores: [null, 0, 100, 77.25] }, mutationId: 'test-mutation-001' };
    const result = store.save(input);
    assert.equal(result.version, 1);
    assert.deepEqual(result.data.scores, [null, 0, 100, 77.25]);
    assert.deepEqual(store.save(input), result);
    assert.throws(() => store.save({ ...input, data: { scores: [] } }), /different edit/);
    assert.equal(store.save({ ...input, mutationId: 'test-mutation-002' }).conflict, true);
    assert.equal(store.pendingCount(), 1);
  } finally { store.close(); }
});

test('edits during a sync remain queued against the acknowledged cloud version', () => {
  const store = openStore(':memory:');
  try {
    store.upsert('judge', { name: 'first' });
    const sent = store.pending()[0];
    store.upsert('judge', { name: 'second' });
    store.ack(sent, { key: 'judge', version: 5 });
    assert.equal(store.pending()[0].base_version, 5);
    assert.equal(JSON.parse(store.pending()[0].data).name, 'second');
    const second = store.pending()[0];
    store.ack(second, { key: 'judge', version: 6 });
    assert.equal(store.pendingCount(), 0);
    store.pull({ key: 'judge', version: 7, data: { name: 'cloud edit' }, updatedAt: '2026-10-28T00:00:00Z' });
    assert.equal(store.get('judge').data.name, 'cloud edit');
  } finally { store.close(); }
});

test('cloud conflicts require an explicit choice and cannot silently overwrite local work', () => {
  const store = openStore(':memory:');
  try {
    store.upsert('judge', { name: 'local' });
    store.pull({ key: 'judge', version: 4, data: { name: 'cloud' }, updatedAt: '2026-10-28T00:00:00Z' });
    assert.equal(store.get('judge').data.name, 'local');
    assert.equal(store.conflicts().length, 1);
    assert.equal(store.pending().length, 0);
    assert.equal(store.save({ key: 'judge', baseVersion: 1, data: { name: 'new' } }).conflict, true);
    store.resolveConflict('judge', 'local');
    assert.equal(store.pending()[0].base_version, 4);
    assert.equal(store.get('judge').data.name, 'local');
    store.pull({ key: 'judge', version: 5, data: { name: 'other' }, updatedAt: '2026-10-28T00:00:00Z' });
    store.resolveConflict('judge', 'remote');
    assert.equal(store.get('judge').data.name, 'other');
    assert.equal(store.pendingCount(), 0);
  } finally { store.close(); }
});

test('incremental state includes remote edits and never repeats an unchanged evidence corpus', () => {
  const store = openStore(':memory:');
  try {
    store.upsert('judge', { name: 'first' });
    const initial = store.state();
    assert.equal(initial.records.length, 1);
    assert.equal(store.state(initial.cursor).records.length, 0);
    store.upsert('judge', { name: 'second' });
    const changed = store.state(initial.cursor);
    assert.equal(changed.records[0].data.name, 'second');
    const sent = store.pending()[0];
    store.ack(sent, { version: 1 });
    store.pull({ key: 'judge', version: 2, data: { name: 'remote' }, updatedAt: new Date().toISOString() });
    assert.equal(store.state(changed.cursor).records[0].data.name, 'remote');
  } finally { store.close(); }
});
