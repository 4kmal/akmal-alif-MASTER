import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeWorkspace } from './workspace.mjs';
import { openStore } from './store.mjs';
import { discoverLinks, checkPublicUrl } from './intake.mjs';

const workspace = await initializeWorkspace();
const store = openStore(resolve(workspace, 'data/judging.sqlite'));
try {
  for (const record of store.list().filter(item => item.key.startsWith('intake:'))) {
    let readme = '';
    for (const file of record.data.artifacts.filter(item => /(?:^|\/)readme[^/]*$/i.test(item.path) && item.size <= 256000)) readme += await readFile(resolve(workspace, record.data.snapshotPath, file.path), 'utf8');
    const links = discoverLinks(readme);
    for (const link of links.filter(item => item.kind === 'deployment').slice(0, 8)) {
      try { Object.assign(link, await checkPublicUrl(link.url)); }
      catch (error) { link.error = error.message; link.checkedAt = new Date().toISOString(); }
    }
    store.upsert(record.key, { ...record.data, links });
    console.log(`${record.data.teamId}: ${links.filter(item => item.kind === 'deployment').map(link => `${link.status || link.error} ${link.url}`).join(', ')}`);
  }
} finally { store.close(); }
