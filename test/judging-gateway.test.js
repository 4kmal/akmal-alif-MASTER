import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleJudgingSyncGateway, isJudgingSyncPath } from '../worker/admin-gateway.js';

test('scoped device sync forwards only the intended namespace and strips browser credentials', async () => {
  let forwarded;
  const env = { PORTFOLIO_GATEWAY_TOKEN: 'test-gateway', ADMIN: { fetch: async request => { forwarded = request; return Response.json({ records: [] }); } } };
  const response = await handleJudgingSyncGateway(new Request('https://www.akmalalif.com/api/judging-sync/sdc-2026/state', { headers: { Authorization: 'Bearer scoped-device', Cookie: 'CF_Authorization=owner', 'Cf-Access-Jwt-Assertion': 'owner-jwt', 'x-portfolio-gateway': 'spoofed' } }), env);
  assert.equal(response.status, 200);
  assert.equal(forwarded.headers.get('Authorization'), 'Bearer scoped-device');
  assert.equal(forwarded.headers.get('Cookie'), null);
  assert.equal(forwarded.headers.get('Cf-Access-Jwt-Assertion'), null);
  assert.equal(forwarded.headers.get('x-portfolio-gateway'), 'test-gateway');
  assert.equal(isJudgingSyncPath('/api/admin/judging/sdc-2026/state'), false);
  assert.equal(isJudgingSyncPath('/api/judging-sync/other-event/state'), false);
});

test('browser calls, alternate hosts, oversized bodies and unrelated paths cannot use the sync gateway', async () => {
  let calls = 0;
  const env = { PORTFOLIO_GATEWAY_TOKEN: 'test-gateway', ADMIN: { fetch: async () => { calls++; return Response.json({}); } } };
  for (const [url, init, expected] of [
    ['https://www.akmalalif.com/api/judging-sync/sdc-2026/state', { headers: { Origin: 'https://www.akmalalif.com' } }, 403],
    ['https://go.akmalalif.com/api/judging-sync/sdc-2026/state', {}, 404],
    ['https://www.akmalalif.com/api/admin/overview', {}, 404],
    ['https://www.akmalalif.com/api/judging-sync/sdc-2026/records', { method: 'POST', headers: { 'Content-Length': '5242881' } }, 413],
  ]) assert.equal((await handleJudgingSyncGateway(new Request(url, init), env)).status, expected);
  assert.equal(calls, 0);
});
