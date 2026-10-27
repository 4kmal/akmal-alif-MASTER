import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir, lstat, realpath, access } from 'node:fs/promises';
import { resolve, relative, extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { sha256, fileHash, confinedFile } from './workspace.mjs';

const exec = promisify(execFile);
const codeExtensions = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.json', '.sql', '.html', '.css', '.vue', '.svelte', '.yml', '.yaml']);
const docExtensions = new Set(['.pdf', '.docx', '.pptx']);
const ignored = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', '.next', '.cache']);
const pythonDefault = `${process.env.USERPROFILE || 'C:/Users/Admin'}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`;

async function git(args, cwd) {
  return (await exec('git', ['-c', 'core.hooksPath=NUL', ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }, timeout: 300000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout.trim();
}
async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

const nonPublicV4 = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) nonPublicV4.addSubnet(network, prefix, 'ipv4');
const nonPublicV6 = new BlockList();
nonPublicV6.addSubnet('2001:db8::', 32, 'ipv6');
function privateAddress(address) {
  const family = isIP(address);
  if (family === 4) return nonPublicV4.check(address, 'ipv4');
  return family !== 6 || !/^[2-3]/.test(address) || nonPublicV6.check(address, 'ipv6');
}

function pinnedRequest(url, init, address) {
  return new Promise((resolveResponse, reject) => {
    const request = httpsRequest(url, {
      method: init.method, headers: init.headers, signal: init.signal, agent: false,
      lookup: (_hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        if (options?.all) done(null, [address]);
        else done(null, address.address, address.family || (address.address.includes(':') ? 6 : 4));
      },
    }, response => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolveResponse(new Response(null, { status: response.statusCode, headers }));
      response.destroy();
    });
    request.once('error', reject);
    request.end();
  });
}

export async function checkPublicUrl(value, fetcher, resolver = lookup) {
  let url = new URL(value);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('Only public HTTPS links are checked');
    const addresses = await resolver(url.hostname, { all: true });
    if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error('Private network destination rejected');
    const address = addresses.find(item => item.family === 4) || addresses[0];
    const checkedFetch = fetcher || ((target, init) => pinnedRequest(target, init, address));
    let response = await checkedFetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if ([403, 405, 501].includes(response.status)) {
      response = await checkedFetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Range: 'bytes=0-0' } });
      await response.body?.cancel();
    }
    if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) { url = new URL(response.headers.get('location'), url); continue; }
    return { status: response.status, finalUrl: url.href, accessible: response.ok, checkedAt: new Date().toISOString(), parity: 'unverified' };
  }
  throw new Error('Redirect limit exceeded');
}

async function inventory(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.env') || entry.name.endsWith('.pem')) continue;
    const file = resolve(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await inventory(root, file, result);
    else if (entry.isFile()) {
      const stat = await lstat(file);
      result.push({ path: relative(root, file).replaceAll('\\', '/'), size: stat.size });
    }
  }
  return result;
}

export function discoverLinks(text) {
  const links = new Map();
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(/https:\/\/[^\s<>"')\]|*`]+/g)) {
      try {
        const url = new URL(match[0].replace(/[.,;*`]+$/, ''));
        for (const key of [...url.searchParams.keys()]) if (/token|secret|password|api.?key|auth/i.test(key)) url.searchParams.delete(key);
        const deployedHost = /(?:^|\.)(?:replit\.app|vercel\.app|netlify\.app)$/.test(url.hostname);
        const knownReference = /(?:^|\.)(?:github\.com|shields\.io|docs\.replit\.com|youtube\.com|youtu\.be|drive\.google\.com)$/.test(url.hostname);
        const kind = /youtube\.com|youtu\.be/.test(url.hostname) ? 'video' : deployedHost || !knownReference && /live demo|deployment|deployed url/i.test(line) ? 'deployment' : /slides|pitch|deck|drive\.google/.test(line) ? 'deck' : 'reference';
        links.set(url.href, { url: url.href, kind, status: null, parity: 'unverified' });
      } catch { /* Invalid participant link remains in the original source. */ }
    }
  }
  return [...links.values()].slice(0, 100);
}

export async function intakeTeam({ workspace, team, store, refresh = false, report = () => {} }) {
  const recordKey = `intake:${team.id}`;
  const previous = store.get(recordKey)?.data;
  async function verifyPrevious() {
    const directory = await confinedFile(workspace, previous.snapshotPath);
    if (await git(['rev-parse', 'HEAD'], directory) !== previous.sha) throw new Error('Existing snapshot changed; preserved for review');
    if (await git(['status', '--porcelain'], directory)) throw new Error('Existing snapshot has working-tree changes; preserved for review');
    for (const artifact of previous.artifacts) if (await fileHash(await confinedFile(directory, artifact.path)) !== artifact.sha256) throw new Error(`Existing evidence changed: ${artifact.path}`);
    report(`Verified saved snapshot ${previous.sha.slice(0, 8)}`);
    return previous;
  }
  if (previous?.verified && !refresh) return verifyPrevious();
  report('Freezing remote HEAD');
  const remote = await git(['ls-remote', '--symref', team.repoUrl, 'HEAD']);
  const branch = remote.match(/ref: refs\/heads\/(.+)\s+HEAD/)?.[1] || 'main';
  const sha = remote.match(/^([a-f0-9]{40})\s+HEAD/m)?.[1];
  if (!sha || !/^[a-zA-Z0-9_./-]+$/.test(branch)) throw new Error('Could not freeze repository HEAD');
  if (previous?.verified && previous.sha === sha) return verifyPrevious();
  const retrievedAt = new Date().toISOString();
  let snapshotPath = `repos/${team.id}/${sha}`;
  let target = resolve(workspace, snapshotPath);
  await mkdir(resolve(workspace, 'repos', team.id), { recursive: true });
  if (await exists(target)) {
    snapshotPath += `-retry-${randomUUID().slice(0, 8)}`;
    target = resolve(workspace, snapshotPath);
    report('Preserved existing download; retrying into a new snapshot folder');
  }
  if (!await exists(target)) {
    report(`Downloading ${sha.slice(0, 8)}`);
    await git(['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', team.repoUrl, target], workspace);
  }
  if (await git(['rev-parse', 'HEAD'], target) !== sha) {
    await git(['fetch', '--depth', '1', 'origin', sha], target);
    await git(['checkout', '--detach', sha], target);
  }
  if (await git(['rev-parse', 'HEAD'], target) !== sha) throw new Error('Downloaded checkout does not match frozen HEAD');
  if (await git(['status', '--porcelain'], target)) throw new Error('Snapshot contains modified files');
  report('Hashing files and extracting review evidence');
  const files = await inventory(target);
  const artifacts = [];
  for (const item of files) artifacts.push({ ...item, sha256: await fileHash(resolve(target, item.path)) });
  const sources = files.filter(file => codeExtensions.has(extname(file.path).toLowerCase()) && file.size <= 256000 && !/lock\.json$|lock\.yaml$|\.min\./.test(file.path))
    .sort((a, b) => score(b.path) - score(a.path) || a.path.localeCompare(b.path)).slice(0, 100);
  const documents = files.filter(file => docExtensions.has(extname(file.path).toLowerCase()) && file.size < 40 * 1024 * 1024).slice(0, 20);
  const evidenceIds = [];
  const issues = [];
  let readme = '';
  const evidenceDirectory = resolve(workspace, 'evidence', team.id, sha);
  await mkdir(evidenceDirectory, { recursive: true });
  for (const item of [...sources, ...documents]) {
    const original = resolve(target, item.path);
    let text = '';
    let pages;
    let coverage = 'Inspected text source; execution and demo behavior unverified';
    const kind = docExtensions.has(extname(item.path).toLowerCase()) ? 'document' : 'source';
    if (kind === 'source') {
      text = (await readFile(original, 'utf8')).replaceAll('\0', '');
      if (/readme/i.test(basename(item.path))) readme += text + '\n';
    } else {
      try {
        const extracted = await exec(process.env.JUDGING_PYTHON || pythonDefault, [fileURLToPath(new URL('./extract-documents.py', import.meta.url)), original], { timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
        const document = JSON.parse(extracted.stdout);
        pages = document.pages;
        coverage = document.coverage;
        text = pages.map(page => `[Page ${page.page}]\n${page.text}`).join('\n\n');
      } catch (error) { issues.push(`Text extraction unavailable for ${item.path}: ${(error.stderr || error.message).trim().split('\n').at(-1).slice(0, 160)}`); }
    }
    const id = sha256(`${team.id}\n${sha}\n${item.path}`).slice(0, 32);
    const evidence = { id, teamId: team.id, snapshotSha: sha, path: item.path, kind, sha256: artifacts.find(file => file.path === item.path).sha256, text: text.slice(0, 250000), lines: text.split('\n').length, ...(pages ? { pages } : {}), coverage, createdAt: retrievedAt };
    await writeFile(resolve(evidenceDirectory, `${id}.json`), JSON.stringify(evidence));
    store.upsert(`evidence:${id}`, evidence);
    evidenceIds.push(id);
  }
  const links = discoverLinks(readme);
  for (const link of links.filter(item => item.kind === 'deployment').slice(0, 8)) {
    report(`Checking deployed URL: ${new URL(link.url).hostname}`);
    try { Object.assign(link, await checkPublicUrl(link.url)); }
    catch (error) { link.error = error.message; link.checkedAt = new Date().toISOString(); }
  }
  const declaredDemoCommits = [...new Set([...readme.matchAll(/(?:commit|published|demo)[^\n]{0,60}\b([a-f0-9]{7,40})\b/gi)].map(match => match[1]))];
  if (declaredDemoCommits.some(commit => !sha.startsWith(commit))) issues.push('A declared demo/published commit differs from the frozen HEAD; demo parity requires manual review.');
  const result = { teamId: team.id, repoUrl: team.repoUrl, branch, sha, retrievedAt, snapshotPath, verified: true, evidenceIds, artifacts, links, demoParity: 'unverified', issues, declaredDemoCommits, previousSnapshots: [...(previous?.previousSnapshots || []), ...(previous && previous.sha !== sha ? [{ sha: previous.sha, snapshotPath: previous.snapshotPath, retrievedAt: previous.retrievedAt }] : [])] };
  await writeFile(resolve(evidenceDirectory, 'manifest.json'), JSON.stringify(result, null, 2));
  store.upsert(recordKey, result);
  return result;
}

function score(path) {
  return /readme/i.test(path) ? 100 : /proposal|submission|technical|pitch/i.test(path) ? 80 : /server|api|route|match|recommend|skill|trend|reskill|scenario|sdg|model|app\./i.test(path) ? 60 : /package\.json$/.test(path) ? 50 : 10;
}

export function createIntakeQueue(workspace, assignment, store) {
  const state = { running: false, completed: 0, total: 0, teamId: null, message: '', errors: [], startedAt: null, finishedAt: null };
  async function start({ teamId, refresh = false } = {}) {
    if (state.running) return state;
    const teams = teamId ? assignment.teams.filter(team => team.id === teamId) : assignment.teams;
    if (!teams.length) throw new Error('Unknown assigned team');
    Object.assign(state, { running: true, completed: 0, total: teams.length, errors: [], startedAt: new Date().toISOString(), finishedAt: null });
    void (async () => {
      for (const team of teams) {
        state.teamId = team.id;
        try { await intakeTeam({ workspace, team, store, refresh, report: message => { state.message = message; } }); }
        catch (error) { state.errors.push({ teamId: team.id, message: error.message }); }
        state.completed++;
      }
      Object.assign(state, { running: false, finishedAt: new Date().toISOString(), message: state.errors.length ? 'Intake finished with evidence issues' : 'All requested snapshots verified' });
      store.setMeta('lastIntake', state);
    })();
    return state;
  }
  return { start, state: () => ({ ...state }) };
}
