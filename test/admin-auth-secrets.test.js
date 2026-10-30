import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from 'node:util';
import { AUTH_SECRET_KEYS, getAuthSecrets, initializeAuthEnv, setAuthCredential } from '../scripts/admin-auth-secrets.mjs';

test('auth initialization preserves existing settings and does not rotate a saved secret', () => {
  const source = '# Existing preview\r\nPORTFOLIO_DEV_BACKEND=http://localhost:8787\r\nOTHER_SECRET="private-existing-value"\r\n';
  const result = initializeAuthEnv(source, 'first-generated-secret');
  assert.ok(result.startsWith(source));
  assert.equal(parseEnv(result).BETTER_AUTH_URL, 'https://www.akmalalif.com');
  assert.equal(parseEnv(result).ADMIN_GITHUB_ID, '44127834');
  assert.equal(parseEnv(result).BETTER_AUTH_SECRET, 'first-generated-secret');
  assert.equal(initializeAuthEnv(result, 'replacement-must-not-be-used'), result);
});

test('auth initialization generates a sufficiently long secret and handles a missing final newline', () => {
  const result = initializeAuthEnv('PORTFOLIO_DEV_BACKEND=https://www.akmalalif.com');
  assert.ok(result.startsWith('PORTFOLIO_DEV_BACKEND=https://www.akmalalif.com\n'));
  assert.match(parseEnv(result).BETTER_AUTH_SECRET, /^[A-Za-z0-9_-]{64}$/);
});

test('secret upload selects only auth credentials from a mixed root environment', () => {
  const source = AUTH_SECRET_KEYS.map(key => `${key}=${key === 'BETTER_AUTH_SECRET' ? 'a'.repeat(64) : 'test-value'}`).join('\n')
    + '\nPORTFOLIO_GATEWAY_TOKEN=never-upload-this\nOTHER_SECRET=also-private\nBETTER_AUTH_URL=https://www.akmalalif.com\n';
  const secrets = getAuthSecrets(source);
  assert.deepEqual(Object.keys(secrets), [...AUTH_SECRET_KEYS]);
  assert.equal(secrets.PORTFOLIO_GATEWAY_TOKEN, undefined);
  assert.equal(secrets.OTHER_SECRET, undefined);
  assert.equal(secrets.BETTER_AUTH_URL, undefined);
});

test('incomplete or weak credentials stop upload without exposing values', () => {
  assert.throws(() => getAuthSecrets('GOOGLE_CLIENT_ID=private-id'), error => {
    assert.ok(error.message.includes('GOOGLE_CLIENT_SECRET'));
    assert.ok(!error.message.includes('private-id'));
    return true;
  });
  const source = AUTH_SECRET_KEYS.map(key => `${key}=short`).join('\n');
  assert.throws(() => getAuthSecrets(source), /at least 32 characters/);
});

test('clipboard credential storage preserves other settings and rejects injected environment lines', () => {
  const source = 'OTHER_SECRET=keep-me\r\nGOOGLE_CLIENT_SECRET=previous\r\n';
  const replaced = setAuthCredential(source, 'GOOGLE_CLIENT_SECRET', 'GOCSPX-example-value');
  assert.equal(parseEnv(replaced).OTHER_SECRET, 'keep-me');
  assert.equal(parseEnv(replaced).GOOGLE_CLIENT_SECRET, 'GOCSPX-example-value');
  const appended = setAuthCredential(replaced, 'GITHUB_CLIENT_ID', 'Ov23.example');
  assert.equal(parseEnv(appended).GITHUB_CLIENT_ID, 'Ov23.example');
  assert.ok(appended.includes('\r\nGITHUB_CLIENT_ID=Ov23.example\r\n'));
  assert.throws(() => setAuthCredential(source, 'OTHER_SECRET', 'overwrite'), /Unsupported/);
  assert.throws(() => setAuthCredential(source, 'GOOGLE_CLIENT_ID', 'one\nADMIN_EMAIL=attacker'), /Invalid credential format/);
  assert.throws(() => setAuthCredential('GOOGLE_CLIENT_ID=one\nGOOGLE_CLIENT_ID=two\n', 'GOOGLE_CLIENT_ID', 'replacement'), /duplicate/);
});
