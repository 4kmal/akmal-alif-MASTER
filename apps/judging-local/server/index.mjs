import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { initializeWorkspace, browserRequestAllowed } from './workspace.mjs';
import { openStore } from './store.mjs';
import { createSync } from './sync.mjs';
import { createIntakeQueue } from './intake.mjs';
import { ASSIGNMENT, assertRecord } from '../../admin/shared/judging/model.mjs';
import { exportWorkbook, importAssignment } from '../../admin/shared/judging/workbook.mjs';

const port = Number(process.env.JUDGING_PORT || 8791);
const workspace = await initializeWorkspace();
const templatePath = resolve(workspace, 'sources/Scoresheet D1-J04 - Muhammad Akmal Alif bin Azam.xlsx');
const imported = await importAssignment(await readFile(templatePath));
if (imported.teams.length !== 9) throw new Error('The assignment must contain exactly nine teams');
const assignment = { ...ASSIGNMENT, ...imported };
const store = openStore(resolve(workspace, 'data/judging.sqlite'));
const sync = createSync(workspace, store);
const intake = createIntakeQueue(workspace, assignment, store);
let vite;

function json(res, value, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req, limit = 1024 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > limit) throw Object.assign(new Error('Request body is too large'), { status: 413 }); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  try {
    if (!browserRequestAllowed(req, port)) return json(res, { error: 'Only the loopback dashboard origin is allowed' }, 403);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/admin/fonts/inter-latin.woff2' && req.method === 'GET') {
      const font = await readFile(fileURLToPath(new URL('../../admin/public/admin/fonts/inter-latin.woff2', import.meta.url)));
      res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400' });
      return res.end(font);
    }
    if (!url.pathname.startsWith('/api/local/')) return vite.middlewares(req, res, () => json(res, { error: 'Not found' }, 404));
    sync.touch();
    const path = url.pathname.slice('/api/local'.length);
    if (path === '/state' && req.method === 'GET') {
      const cursor = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : undefined;
      if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) return json(res, { error: 'Invalid state cursor' }, 400);
      return json(res, { assignment, ...store.state(cursor), serverTime: new Date().toISOString(), sync: sync.status(), conflicts: store.conflicts() });
    }
    if (path === '/records' && req.method === 'POST') {
      const input = await body(req);
      input.data = assertRecord(input.key, input.data);
      if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0) return json(res, { error: 'A valid base version is required' }, 400);
      const result = store.save(input);
      if (result.conflict) return json(res, result, 409);
      void sync.tick();
      return json(res, result);
    }
    if (path === '/intake' && req.method === 'GET') return json(res, intake.state());
    if (path === '/intake' && req.method === 'POST') return json(res, await intake.start(await body(req)));
    if (path === '/sync/status' && req.method === 'GET') return json(res, sync.status());
    if (path === '/sync' && req.method === 'POST') { void sync.tick(); return json(res, sync.status()); }
    if (path === '/sync/resolve' && req.method === 'POST') {
      const input = await body(req);
      if (!['local', 'remote'].includes(input.choice)) return json(res, { error: 'Choose the local or cloud version explicitly' }, 400);
      const result = store.resolveConflict(input.key, input.choice);
      void sync.tick();
      return json(res, result);
    }
    if (path === '/pair' && req.method === 'POST') { const input = await body(req); return json(res, await sync.pair(input.code, input.name)); }
    if (path.startsWith('/evidence/') && req.method === 'GET') {
      const evidence = store.get(`evidence:${path.slice('/evidence/'.length)}`)?.data;
      return json(res, evidence || { error: 'Evidence not found' }, evidence ? 200 : 404);
    }
    if (path === '/exports' && req.method === 'GET') {
      const records = store.list();
      const reviews = records.filter(record => record.key.startsWith('review:')).map(record => ({ teamId: record.key.slice(7), ...record.data }));
      const judge = store.get('judge')?.data || { name: assignment.name || assignment.judgeName, domain: assignment.domain, date: '', generalNotes: '', warningsAcknowledged: false };
      const final = url.searchParams.get('final') === '1';
      const intakes = records.filter(record => record.key.startsWith('intake:')).map(record => record.data);
      const output = await exportWorkbook(await readFile(templatePath), { judge, reviews, intakes }, { final });
      const filename = `SDC-D1-J04-${final ? 'final' : 'draft'}-${new Date().toISOString().replaceAll(':', '-')}.xlsx`;
      await writeFile(resolve(workspace, 'exports', filename), output);
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
      return res.end(Buffer.from(output));
    }
    if (path === '/jobs' || path === '/assessments' || /^\/assessments\/[a-zA-Z0-9-]+\/cancel$/.test(path)) {
      if (!['GET', 'POST'].includes(req.method)) return json(res, { error: 'Method not allowed' }, 405);
      const payload = req.method === 'POST' ? JSON.stringify(await body(req)) : undefined;
      const remotePath = path === '/assessments' && req.method === 'GET' ? '/jobs' : path;
      const response = await sync.remote(remotePath, { method: req.method, ...(payload ? { headers: { 'Content-Type': 'application/json' }, body: payload } : {}) });
      return json(res, await response.json(), response.status);
    }
    return json(res, { error: 'Not found' }, 404);
  } catch (error) {
    json(res, { error: error.message }, error.status || 400);
  }
});
vite = await createViteServer({ configFile: fileURLToPath(new URL('../vite.config.mjs', import.meta.url)), server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
server.listen(port, '127.0.0.1', () => console.log(`SDC judging workspace: http://127.0.0.1:${port}`));
async function close() { sync.stop(); await vite.close(); server.close(); store.close(); }
process.once('SIGINT', close);
process.once('SIGTERM', close);
