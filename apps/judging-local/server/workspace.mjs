import { realpath, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const DEFAULT_WORKSPACE = 'C:/xampp/htdocs/akmal-alif-MASTER/events/judging/sdcHackathon';

export async function initializeWorkspace(root = process.env.JUDGING_WORKSPACE || DEFAULT_WORKSPACE) {
  await mkdir(root, { recursive: true });
  const absolute = await realpath(root);
  await writeFile(resolve(absolute, '.htaccess'), 'Options -Indexes\nRequire all denied\n', { mode: 0o600 });
  if (process.platform === 'win32') {
    const { stdout } = await exec('whoami', [], { windowsHide: true });
    await exec('icacls', [absolute, '/inheritance:r', '/grant:r', `${stdout.trim()}:(OI)(CI)(F)`, 'SYSTEM:(OI)(CI)(F)'], { windowsHide: true });
  } else await chmod(absolute, 0o700);
  for (const folder of ['repos', 'sources', 'evidence', 'data', 'exports']) await mkdir(resolve(absolute, folder), { recursive: true });
  return absolute;
}

export async function confinedFile(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('A workspace-relative file is required');
  const file = await realpath(resolve(root, path));
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('File is outside the judging workspace');
  return file;
}

export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export async function fileHash(path) { return sha256(await readFile(path)); }

export function browserRequestAllowed(req, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(req.headers.host)) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!['GET', 'HEAD'].includes(req.method)) return origin === `http://${req.headers.host}`;
  return !origin || origin === `http://${req.headers.host}`;
}
