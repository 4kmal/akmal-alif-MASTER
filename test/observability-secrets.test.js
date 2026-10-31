import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from 'node:util';
import { setObservabilityToken } from '../scripts/observability-secrets.mjs';

const token = 'test-only-token-012345678901234567890123456789';

test('observability token updates preserve unrelated credentials and CRLF files', () => {
  const source = 'GOOGLE_CLIENT_SECRET=unchanged\r\nCF_OBSERVABILITY_TOKEN=old\r\nADMIN_EMAIL=owner@example.com\r\n';
  const updated = setObservabilityToken(source, token);
  assert.equal(parseEnv(updated).GOOGLE_CLIENT_SECRET, 'unchanged');
  assert.equal(parseEnv(updated).ADMIN_EMAIL, 'owner@example.com');
  assert.equal(parseEnv(updated).CF_OBSERVABILITY_TOKEN, token);
  assert.ok(updated.includes('\r\n'));
});

test('observability token accepts an absent .env entry without changing existing values', () => {
  assert.equal(setObservabilityToken('ADMIN_EMAIL=owner@example.com', token), `ADMIN_EMAIL=owner@example.com\nCF_OBSERVABILITY_TOKEN=${token}\n`);
});

test('observability token rejects malformed clipboard data and duplicate definitions', () => {
  for (const value of ['', 'https://example.com/', 'x'.repeat(40) + '\nOTHER=changed', ' '.repeat(40)])
    assert.throws(() => setObservabilityToken('', value));
  assert.throws(() => setObservabilityToken('CF_OBSERVABILITY_TOKEN=a\nCF_OBSERVABILITY_TOKEN=b\n', token), /duplicate/);
});
