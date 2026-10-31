import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(root, '.env');
const key = 'CF_OBSERVABILITY_TOKEN';

function validateToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value))
    throw new Error('Expected a Cloudflare API token on stdin.');
  return value;
}

export function setObservabilityToken(source, value) {
  validateToken(value);
  const pattern = /^[\t ]*(?:export[\t ]+)?CF_OBSERVABILITY_TOKEN[\t ]*=[^\r\n]*$/gm;
  const matches = [...source.matchAll(pattern)];
  if (matches.length > 1 || /[\r\n]/.test(parseEnv(source)[key] || ''))
    throw new Error('Resolve duplicate CF_OBSERVABILITY_TOKEN entries before replacing it.');
  const entry = `${key}=${value}`;
  if (matches.length)
    return source.replace(pattern, () => entry);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  return source + (source && !source.endsWith('\n') ? newline : '') + entry + newline;
}

async function main(command) {
  const source = await readFile(envPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (command === 'status') {
    console.log(`${key}: ${parseEnv(source)[key]?.trim() ? 'present' : 'missing'}`);
    return;
  }
  if (command === 'set') {
    let value = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) value += chunk;
    await writeFile(envPath, setObservabilityToken(source, value.trim()), { mode: 0o600 });
    console.log(`Saved ${key} to root .env.`);
    return;
  }
  if (command !== 'upload')
    throw new Error('Usage: node scripts/observability-secrets.mjs status|set|upload');
  const value = validateToken(parseEnv(source)[key]);
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'bulk',
    '--name', 'akmalalif-admin', '--config', path.join(root, 'apps/admin/wrangler.jsonc'),
  ], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  const completed = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Could not start Wrangler.')));
    child.stdin.once('error', () => reject(new Error('Could not supply the observability token to Wrangler.')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Observability secret upload failed.')));
  });
  child.stdin.end(JSON.stringify({ [key]: value }));
  await completed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
