import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, version INTEGER NOT NULL, cloud_version INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (key TEXT PRIMARY KEY, mutation_id TEXT NOT NULL, base_version INTEGER NOT NULL, local_version INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conflicts (key TEXT PRIMARY KEY, remote TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);

  function record(row) { return row ? { key: row.key, version: row.version, data: JSON.parse(row.data), updatedAt: row.updated_at } : null; }
  function get(key) { return record(db.prepare('SELECT * FROM records WHERE key=?').get(key)); }
  function list() { return db.prepare('SELECT * FROM records ORDER BY key').all().map(record); }
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function save({ key, baseVersion, data }, queue = true) {
    return atomic(() => {
      const current = db.prepare('SELECT * FROM records WHERE key=?').get(key);
      const conflict = db.prepare('SELECT remote FROM conflicts WHERE key=?').get(key);
      if (conflict || (current?.version || 0) !== baseVersion) return { conflict: true, current: get(key), remote: conflict ? JSON.parse(conflict.remote) : null };
      const now = new Date().toISOString();
      const version = baseVersion + 1;
      db.prepare('INSERT INTO records(key,version,cloud_version,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,data=excluded.data,updated_at=excluded.updated_at').run(key, version, current?.cloud_version || 0, JSON.stringify(data), now);
      if (queue) db.prepare('INSERT INTO outbox(key,mutation_id,base_version,local_version,data) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET mutation_id=excluded.mutation_id,local_version=excluded.local_version,data=excluded.data').run(key, randomUUID(), current?.cloud_version || 0, version, JSON.stringify(data));
      return get(key);
    });
  }
  function upsert(key, data) { return save({ key, baseVersion: get(key)?.version || 0, data }); }
  function pull(remote) {
    return atomic(() => {
      const row = db.prepare('SELECT * FROM records WHERE key=?').get(remote.key);
      const pending = db.prepare('SELECT * FROM outbox WHERE key=?').get(remote.key);
      if (pending) {
        if (remote.version > pending.base_version && JSON.stringify(remote.data) !== pending.data) db.prepare('INSERT OR REPLACE INTO conflicts(key,remote) VALUES(?,?)').run(remote.key, JSON.stringify(remote));
        return;
      }
      if (!row || remote.version > row.cloud_version) db.prepare('INSERT INTO records(key,version,cloud_version,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET version=excluded.version,cloud_version=excluded.cloud_version,data=excluded.data,updated_at=excluded.updated_at').run(remote.key, (row?.version || 0) + 1, remote.version, JSON.stringify(remote.data), remote.updatedAt);
    });
  }
  function ack(sent, remote) {
    atomic(() => {
      const pending = db.prepare('SELECT * FROM outbox WHERE key=?').get(sent.key);
      db.prepare('UPDATE records SET cloud_version=? WHERE key=?').run(remote.version, sent.key);
      if (pending?.mutation_id === sent.mutation_id) db.prepare('DELETE FROM outbox WHERE key=?').run(sent.key);
      else db.prepare('UPDATE outbox SET base_version=? WHERE key=?').run(remote.version, sent.key);
      db.prepare('DELETE FROM conflicts WHERE key=?').run(sent.key);
    });
  }
  function resolveConflict(key, choice) {
    return atomic(() => {
      const item = db.prepare('SELECT remote FROM conflicts WHERE key=?').get(key);
      if (!item) throw new Error('Conflict no longer exists');
      const remote = JSON.parse(item.remote);
      const current = get(key);
      db.prepare('DELETE FROM conflicts WHERE key=?').run(key);
      db.prepare('UPDATE records SET cloud_version=?,version=?,data=?,updated_at=? WHERE key=?').run(remote.version, current.version + 1, JSON.stringify(choice === 'remote' ? remote.data : current.data), new Date().toISOString(), key);
      if (choice === 'remote') db.prepare('DELETE FROM outbox WHERE key=?').run(key);
      else db.prepare('INSERT INTO outbox(key,mutation_id,base_version,local_version,data) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET mutation_id=excluded.mutation_id,base_version=excluded.base_version,local_version=excluded.local_version,data=excluded.data').run(key, randomUUID(), remote.version, current.version + 1, JSON.stringify(current.data));
      return get(key);
    });
  }
  return { db, get, list, save, upsert, pull, ack, resolveConflict,
    pending: () => db.prepare('SELECT * FROM outbox WHERE key NOT IN (SELECT key FROM conflicts) ORDER BY rowid').all(),
    conflicts: () => db.prepare('SELECT key,remote FROM conflicts').all().map(row => ({ key: row.key, local: get(row.key), remote: JSON.parse(row.remote) })),
    pendingCount: () => db.prepare('SELECT COUNT(*) AS count FROM outbox').get().count,
    markConflict: (key, remote) => db.prepare('INSERT OR REPLACE INTO conflicts(key,remote) VALUES(?,?)').run(key, JSON.stringify(remote)),
    meta: key => { const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; },
    setMeta: (key, value) => db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)').run(key, JSON.stringify(value)),
    close: () => db.close(),
  };
}
