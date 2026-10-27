import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { initializeWorkspace, confinedFile } from './workspace.mjs';
import { openStore } from './store.mjs';

const exec = promisify(execFile);
const workspace = await initializeWorkspace();
const store = openStore(resolve(workspace, 'data/judging.sqlite'));
try {
  for (const intake of store.list().filter(record => record.key.startsWith('intake:'))) {
    const clearedPaths = [];
    for (const id of intake.data.evidenceIds) {
      const record = store.get(`evidence:${id}`);
      if (!record || record.data.kind !== 'document' || record.data.text) continue;
      const original = await confinedFile(workspace, `${intake.data.snapshotPath}/${record.data.path}`);
      try {
        const result = await exec(process.env.JUDGING_PYTHON || `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`, [fileURLToPath(new URL('./extract-documents.py', import.meta.url)), original], { timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
        const document = JSON.parse(result.stdout);
        const text = document.pages.map(page => `[Page ${page.page}]\n${page.text}`).join('\n\n').slice(0, 250000);
        const data = { ...record.data, text, lines: text.split('\n').length, pages: document.pages, coverage: document.coverage };
        store.upsert(record.key, data);
        await writeFile(resolve(workspace, 'evidence', data.teamId, data.snapshotSha, `${id}.json`), JSON.stringify(data));
        clearedPaths.push(data.path);
        console.log(`${data.teamId}: extracted ${data.path} (${data.pages.length} pages)`);
      } catch (error) { console.error(`${intake.data.teamId}: ${(error.stderr || error.message).trim().split('\n').at(-1)}`); }
    }
    if (clearedPaths.length) {
      const data = { ...intake.data, issues: intake.data.issues.filter(issue => !clearedPaths.some(path => issue.startsWith(`Text extraction unavailable for ${path}:`))) };
      store.upsert(intake.key, data);
      await writeFile(resolve(workspace, 'evidence', data.teamId, data.sha, 'manifest.json'), JSON.stringify(data, null, 2));
    }
  }
} finally { store.close(); }
