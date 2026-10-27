import { readFile, writeFile, chmod, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sha256 } from './workspace.mjs';

const exec = promisify(execFile);
const CLOUD_ORIGIN = 'https://www.akmalalif.com';

export function createSync(workspace, store) {
  const credentialPath = resolve(workspace, 'data/device-credential.json');
  let credential;
  let running = false;
  let stopped = false;
  const status = { status: 'unpaired', pending: store.pendingCount(), lastSuccessfulAt: store.meta('lastSync'), error: null, device: null };

  function safeDevice(value) { return { id: value.deviceId || value.id, name: value.name || 'Local judging workspace', expiresAt: value.expiresAt }; }
  async function load() {
    try {
      credential = JSON.parse(await readFile(credentialPath, 'utf8'));
      status.device = safeDevice(credential);
      status.status = 'pending';
    } catch (error) { if (error.code !== 'ENOENT') { status.status = 'failed'; status.error = 'Device credential could not be read'; } }
  }
  const loaded = load();

  async function remote(path, options = {}) {
    await loaded;
    if (!credential?.token) throw new Error('Pair this local workspace with the owner dashboard first');
    const response = await fetch(`${CLOUD_ORIGIN}/api/judging-sync/sdc-2026${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${credential.token}`, ...options.headers },
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if ([401, 403].includes(response.status)) { status.status = 'expired'; throw new Error('Device authorization expired or was revoked. Pair again to resume sync.'); }
    return response;
  }

  async function pair(code, name = 'Akmal local judging workspace') {
    if (typeof code !== 'string' || code.length > 100) throw new Error('Enter the owner-confirmed pairing code');
    const response = await fetch(`${CLOUD_ORIGIN}/api/judging-sync/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name: name.slice(0, 100) }), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.token) throw new Error(result.statusMessage || result.error || 'Pairing code was rejected');
    const next = { token: result.token, deviceId: result.deviceId || result.device?.id || result.id, name, expiresAt: result.expiresAt || result.device?.expiresAt };
    const temporary = `${credentialPath}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    if (process.platform === 'win32') {
      const { stdout } = await exec('whoami', [], { windowsHide: true });
      await exec('icacls', [temporary, '/inheritance:r', '/grant:r', `${stdout.trim()}:(F)`, 'SYSTEM:(F)'], { windowsHide: true });
    } else await chmod(temporary, 0o600);
    await rename(temporary, credentialPath);
    credential = next;
    status.device = safeDevice(next);
    status.error = null;
    status.status = 'pending';
    store.setMeta('templateSynced', null);
    void tick();
    return { device: status.device, status: status.status };
  }

  async function tick() {
    await loaded;
    if (running || stopped || !credential?.token) return;
    running = true;
    status.status = 'syncing';
    try {
      const template = await readFile(resolve(workspace, 'sources/Scoresheet D1-J04 - Muhammad Akmal Alif bin Azam.xlsx'));
      const templateHash = sha256(template);
      if (store.meta('templateSynced') !== templateHash) {
        const uploaded = await remote('/template', { method: 'PUT', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: template });
        if (!uploaded.ok) throw new Error(`Template sync failed (${uploaded.status})`);
        store.setMeta('templateSynced', templateHash);
      }
      let sent = 0;
      for (const entry of store.pending()) {
        if (stopped || sent >= 100) break;
        const response = await remote('/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: entry.key, baseVersion: entry.base_version, data: JSON.parse(entry.data), mutationId: entry.mutation_id }) });
        const result = await response.json();
        if (response.status === 409) {
          const current = result.current || result.data?.current;
          if (!current) throw new Error('Cloud conflict did not include a comparable record');
          store.markConflict(entry.key, current);
          continue;
        }
        if (!response.ok) throw new Error(result.statusMessage || result.error || `Sync failed (${response.status})`);
        const remoteRecord = result.record || result;
        store.ack(entry, remoteRecord);
        sent++;
      }
      const response = await remote('/state');
      if (!response.ok) throw new Error(`Cloud refresh failed (${response.status})`);
      const result = await response.json();
      for (const record of result.records) store.pull(record);
      status.lastSuccessfulAt = new Date().toISOString();
      store.setMeta('lastSync', status.lastSuccessfulAt);
      status.pending = store.pendingCount();
      status.error = null;
      status.status = store.conflicts().length ? 'conflict' : status.pending ? 'pending' : 'synced';
    } catch (error) {
      status.error = error.message;
      if (status.status !== 'expired') status.status = 'offline';
    } finally { running = false; }
  }
  const timer = setInterval(() => { void tick(); }, 10000);
  timer.unref();
  void tick();
  return { pair, remote, tick, status: () => ({ ...status, pending: store.pendingCount(), conflicts: store.conflicts() }), stop: () => { stopped = true; clearInterval(timer); } };
}
