import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
export const AUTH_SECRET_KEYS = Object.freeze([
  'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
]);

export function initializeAuthEnv(source, secret = randomBytes(48).toString('base64url')) {
  const env = parseEnv(source);
  const defaults = {
    BETTER_AUTH_URL: 'https://www.akmalalif.com',
    ADMIN_GITHUB_ID: '44127834',
    BETTER_AUTH_SECRET: secret,
  };
  const added = Object.entries(defaults).filter(([key]) => !Object.hasOwn(env, key));
  if (!added.length) return source;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source + (source && !source.endsWith('\n') ? newline : '')
    + added.map(([key, value]) => `${key}=${value}`).join(newline) + newline;
}

export function getAuthSecrets(source) {
  const env = parseEnv(source);
  const missing = AUTH_SECRET_KEYS.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing authentication settings: ${missing.join(', ')}`);
  if (env.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return Object.fromEntries(AUTH_SECRET_KEYS.map(key => [key, env[key]]));
}

export function setAuthCredential(source, key, value) {
  if (!AUTH_SECRET_KEYS.includes(key)) throw new Error('Unsupported authentication credential name');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_./:+@=-]+$/.test(value)) throw new Error(`Invalid credential format for ${key}`);
  const pattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=.*$`, 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length > 1 || /[\r\n]/.test(parseEnv(source)[key] || '')) throw new Error(`Resolve duplicate or multiline ${key} before replacing it`);
  const entry = `${key}=${value}`;
  if (matches.length) return source.replace(pattern, entry);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source + (source && !source.endsWith('\n') ? newline : '') + entry + newline;
}

async function main(command) {
  const source = await readFile(envPath, 'utf8').catch(error => {
    if (command === 'init' && error.code === 'ENOENT') return '';
    throw error;
  });
  if (command === 'init') {
    const updated = initializeAuthEnv(source);
    if (updated !== source) await writeFile(envPath, updated, { mode: 0o600 });
    console.log('Root .env initialized; existing settings preserved.');
    return;
  }
  if (command === 'status') {
    const env = parseEnv(source);
    for (const key of AUTH_SECRET_KEYS) console.log(`${key}: ${env[key]?.trim() ? 'present' : 'missing'}`);
    return;
  }
  if (command === 'set') {
    let value = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) value += chunk;
    const key = process.argv[3];
    await writeFile(envPath, setAuthCredential(source, key, value.trim()), { mode: 0o600 });
    console.log(`Saved ${key} to root .env.`);
    return;
  }
  if (command !== 'upload') throw new Error('Usage: node scripts/admin-auth-secrets.mjs init|status|upload|set KEY');
  const secrets = getAuthSecrets(source);
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk',
    '--name', 'akmalalif-portfolio', '--config', path.join(root, 'wrangler.jsonc'),
  ], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], env: process.env });
  const completed = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start Wrangler')));
    child.stdin.once('error', () => reject(new Error('Could not supply authentication settings to Wrangler')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Wrangler secret upload failed')));
  });
  child.stdin.end(JSON.stringify(secrets));
  await completed;
}

if (typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
