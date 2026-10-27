import test from 'node:test';
import assert from 'node:assert/strict';
import { browserRequestAllowed, confinedFile } from '../server/workspace.mjs';
import { checkPublicUrl, discoverLinks } from '../server/intake.mjs';
import { mkdtemp, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

test('local service rejects DNS rebinding and cross-origin writes', () => {
  const req = { method: 'POST', headers: { host: '127.0.0.1:8791', origin: 'http://127.0.0.1:8791' } };
  assert.equal(browserRequestAllowed(req, 8791), true);
  assert.equal(browserRequestAllowed({ ...req, headers: { ...req.headers, origin: 'https://evil.test' } }, 8791), false);
  assert.equal(browserRequestAllowed({ ...req, headers: { ...req.headers, host: 'evil.test:8791' } }, 8791), false);
  assert.equal(browserRequestAllowed({ ...req, headers: { ...req.headers, origin: undefined } }, 8791), false);
});

test('workspace reads cannot traverse outside the private root', async () => {
  const outer = await mkdtemp(join(tmpdir(), 'judging-boundary-'));
  try {
    const root = join(outer, 'workspace');
    await mkdir(root);
    await writeFile(join(outer, 'outside.txt'), 'private');
    await writeFile(join(root, 'inside.txt'), 'evidence');
    assert.equal(await confinedFile(await realpath(root), 'inside.txt'), await realpath(join(root, 'inside.txt')));
    await assert.rejects(confinedFile(await realpath(root), '../outside.txt'), /outside/);
  } finally {
    assert.ok(relative(tmpdir(), outer).startsWith('judging-boundary-'));
    await rm(outer, { recursive: true });
  }
});

test('deployment checks fall back from HEAD to GET without claiming demo parity', async () => {
  const methods = [];
  const result = await checkPublicUrl('https://demo.example/', async (_url, init) => {
    methods.push(init.method);
    return new Response(null, { status: init.method === 'HEAD' ? 405 : 200 });
  }, async () => [{ address: '1.1.1.1' }]);
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(result.accessible, true);
  assert.equal(result.parity, 'unverified');
  await assert.rejects(checkPublicUrl('https://private.example/', fetch, async () => [{ address: '127.0.0.1' }]), /Private network/);
});

test('deployment checks reject private, carrier, benchmark, multicast and mapped addresses before fetching', async () => {
  let requested = 0;
  for (const address of ['10.0.0.1', '100.100.100.100', '198.18.0.1', '225.0.0.1', '250.0.0.1', '::1', '::ffff:127.0.0.1', '2001:db8::1', 'fe80::1']) {
    await assert.rejects(checkPublicUrl('https://demo.example/', async () => { requested++; }, async () => [{ address }]), /Private network/);
  }
  assert.equal(requested, 0);
});

test('links never carry embedded auth parameters into checks', () => {
  const links = discoverLinks('Live demo: https://demo.example/?token=secret&view=one');
  assert.equal(links[0].url, 'https://demo.example/?view=one');
});
