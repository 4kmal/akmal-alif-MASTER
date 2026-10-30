import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAdminGateway, handleAnalyticsGateway, isAdminPath, validateAccessIdentity } from '../worker/admin-gateway.js';

const origin = 'https://www.akmalalif.com';
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'gateway-test-key', use: 'sig', alg: 'RS256' };
const now = Date.UTC(2026, 9, 26, 12);
const env = { ADMIN_AUTH_MODE: 'access', CF_ACCESS_TEAM_DOMAIN: 'portfolio-test.cloudflareaccess.com', CF_ACCESS_AUD: 'portfolio-admin', ADMIN_EMAIL: 'iamaleep@gmail.com', PORTFOLIO_GATEWAY_TOKEN: 'test-gateway-private-secret' };
const options = { now, fetcher: async () => Response.json({ keys: [publicKey] }) };

async function jwt(overrides = {}, headerOverrides = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', kid: publicKey.kid, ...headerOverrides });
  const payload = encode({ type: 'app', iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}`, aud: [env.CF_ACCESS_AUD], sub: 'owner-subject', email: env.ADMIN_EMAIL, iat: now / 1000 - 10, exp: now / 1000 + 3600, ...overrides });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

function accessRequest(path, token, init = {}) {
  return new Request(`${origin}${path}`, { ...init, headers: { 'Cf-Access-Jwt-Assertion': token, ...init.headers } });
}

test('Access verifies the signature, issuer, audience, expiry and exact owner', async () => {
  const valid = await jwt();
  assert.deepEqual(await validateAccessIdentity(accessRequest('/admin', valid), env, options), { email: env.ADMIN_EMAIL, subject: 'owner-subject' });
  for (const claims of [{ email: 'someone@gmail.com' }, { aud: ['other-app'] }, { iss: 'https://other.cloudflareaccess.com' }, { exp: now / 1000 }, { nbf: now / 1000 + 300 }, { sub: '' }, { type: 'service' }, { common_name: 'service-token' }]) {
    assert.equal(await validateAccessIdentity(accessRequest('/admin', await jwt(claims)), env, options), null);
  }
  assert.equal(await validateAccessIdentity(accessRequest('/admin', await jwt({}, { alg: 'none' })), env, options), null);
  const parts = valid.split('.');
  parts[1] = Buffer.from(JSON.stringify({ email: env.ADMIN_EMAIL, iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}`, aud: [env.CF_ACCESS_AUD], sub: 'owner-subject', exp: now / 1000 + 600 })).toString('base64url');
  assert.equal(await validateAccessIdentity(accessRequest('/admin', parts.join('.')), env, options), null);
  assert.equal(await validateAccessIdentity(accessRequest('/admin', valid), { ...env, ADMIN_EMAIL: undefined }, options), null);
  assert.equal(await validateAccessIdentity(new Request(`${origin}/admin`, { headers: { Cookie: `CF_Authorization=${valid}` } }), env, options)?.then((identity) => identity?.email), env.ADMIN_EMAIL);
});

test('admin gateway fails closed on missing identity, config, or preview host', async () => {
  const backend = { ...env, ADMIN: { fetch: () => { throw new Error('Unauthorized request reached the service'); } } };
  assert.equal((await handleAdminGateway(new Request(`${origin}/admin`), backend)).status, 302);
  assert.equal((await handleAdminGateway(new Request(`${origin}/api/admin/overview`), backend)).status, 401);
  assert.equal((await handleAdminGateway(new Request('https://akmalalif-portfolio.iamaleep.workers.dev/admin'), backend)).status, 404);
  assert.equal((await handleAdminGateway(new Request(`${origin}/admin`), env)).status, 503);
  assert.equal((await handleAdminGateway(new Request(`${origin}/admin?ALLOW_LOCAL_ADMIN=true`), { ...backend, ALLOW_LOCAL_ADMIN: 'true' })).status, 302);
  assert.equal((await handleAdminGateway(new Request(`${origin}/api/admin/overview`, { method: 'POST', headers: { Origin: 'https://evil.example' } }), backend)).status, 403);
  assert.ok(isAdminPath('/admin'));
  assert.ok(isAdminPath('/admin/_nuxt/app.js'));
  assert.ok(isAdminPath('/api/admin/overview'));
  assert.equal(isAdminPath('/administrator'), false);
});

test('better-auth local QA opt-in is independent from the Access local bypass', async () => {
  const forwarded = [];
  const backend = {
    ...env,
    ADMIN_AUTH_MODE: 'better-auth',
    BETTER_AUTH_URL: 'http://localhost',
    ALLOW_LOCAL_AUTH: 'true',
    ALLOW_LOCAL_ADMIN: 'false',
    ADMIN: { fetch: async (request) => { forwarded.push(request); return Response.json({ ok: true }); } },
  };
  const validateBetterAuthIdentity = async () => ({ id: 'root', email: env.ADMIN_EMAIL });

  const localResponse = await handleAdminGateway(
    new Request('http://localhost/admin'),
    backend,
    { validateBetterAuthIdentity },
  );
  assert.equal(localResponse.status, 200);
  assert.equal(forwarded[0].headers.get('x-portfolio-admin-id'), 'root');
  assert.equal(forwarded[0].headers.get('x-portfolio-admin-email'), env.ADMIN_EMAIL);
  assert.equal(forwarded[0].headers.get('x-portfolio-gateway'), env.PORTFOLIO_GATEWAY_TOKEN);
  assert.equal(forwarded[0].headers.get('Cookie'), null);
  assert.equal(forwarded[0].headers.get('x-forwarded-host'), 'localhost');

  assert.equal((await handleAdminGateway(new Request(`${origin}/admin`), backend, { validateBetterAuthIdentity: async () => null })).status, 302);
  assert.equal((await handleAdminGateway(new Request('https://evil.example/admin'), backend, { validateBetterAuthIdentity })).status, 404);
  assert.equal((await handleAdminGateway(new Request('http://localhost:8794/admin'), backend, { validateBetterAuthIdentity })).status, 404);
  assert.equal((await handleAdminGateway(new Request('http://localhost/admin'), { ...backend, BETTER_AUTH_URL: origin }, { validateBetterAuthIdentity })).status, 404);
  assert.equal((await handleAdminGateway(new Request('http://localhost/admin'), { ...backend, ADMIN_AUTH_MODE: 'access' }, { validateBetterAuthIdentity })).status, 404);
  assert.equal((await handleAdminGateway(new Request('http://localhost/admin'), { ...backend, ALLOW_LOCAL_AUTH: 'false', ALLOW_LOCAL_ADMIN: 'true' }, { validateBetterAuthIdentity })).status, 404);

  const accessForwarded = [];
  const accessLocal = {
    ...env,
    ALLOW_LOCAL_ADMIN: 'true',
    ADMIN: { fetch: async (request) => { accessForwarded.push(request); return Response.json({ ok: true }); } },
  };
  assert.equal((await handleAdminGateway(new Request('http://localhost/admin'), accessLocal)).status, 200);
  assert.equal(accessForwarded[0].headers.get('x-portfolio-admin-id'), 'root');
});

test('admin responses preserve Better Auth session refresh cookies', async () => {
  const backend = {
    ...env,
    ADMIN_AUTH_MODE: 'better-auth',
    ADMIN: { fetch: async () => Response.json({ ok: true }) },
  };
  const response = await handleAdminGateway(new Request(`${origin}/admin`), backend, {
    validateBetterAuthIdentity: async () => ({
      id: 'root',
      email: env.ADMIN_EMAIL,
      setCookies: ['portfolio-auth.session_token=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax'],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.headers.getSetCookie(), ['portfolio-auth.session_token=refreshed; Path=/; HttpOnly; Secure; SameSite=Lax']);
});

test('login shell exposes only its bounded public asset set', async () => {
  const forwarded = [];
  const backend = {
    ...env,
    ADMIN: { fetch: async (request) => { forwarded.push(request); return new Response('asset'); } },
  };
  for (const asset of ['/admin/login', '/admin/_nuxt/app.js', '/admin/_i18n/en-US.json', '/admin/sink.png', '/admin/fonts/inter-latin.woff2']) {
    const response = await handleAdminGateway(new Request(`${origin}${asset}`), backend);
    assert.equal(response.status, 200, asset);
    assert.equal(forwarded.at(-1).headers.get('x-portfolio-admin-id'), null, asset);
  }
  assert.equal((await handleAdminGateway(new Request(`${origin}/admin/sphere.bin`), backend)).status, 302);
  assert.equal(forwarded.length, 5);
});

test('admin forwarding preserves bodies and queries, removes spoofed gateway headers and enforces CSRF', async () => {
  const forwarded = [];
  const backend = { ...env, ADMIN: { fetch: async (request) => { forwarded.push({ url: request.url, headers: request.headers, body: await request.text() }); return Response.json({ ok: true }); } } };
  const token = await jwt();
  const response = await handleAdminGateway(accessRequest('/api/admin/sink/link/create?dry=1', token, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: 'Bearer untrusted-browser-token', 'x-portfolio-gateway': 'spoofed', 'x-forwarded-host': 'evil.test' }, body: '{"slug":"github"}' }), backend, options);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(forwarded[0].url, `${origin}/api/link/create?dry=1`);
  assert.equal(forwarded[0].body, '{"slug":"github"}');
  assert.equal(forwarded[0].headers.get('x-portfolio-gateway'), env.PORTFOLIO_GATEWAY_TOKEN);
  assert.equal(forwarded[0].headers.get('x-forwarded-host'), 'www.akmalalif.com');
  assert.equal(forwarded[0].headers.get('Authorization'), null);
  assert.equal((await handleAdminGateway(accessRequest('/api/admin/sink/link/delete', token, { method: 'POST', headers: { Origin: 'https://evil.test' } }), backend, options)).status, 403);
  assert.equal(forwarded.length, 1);
  await handleAdminGateway(accessRequest('/api/admin/overview?range=7d', token), backend, options);
  assert.equal(forwarded[1].url, `${origin}/api/portfolio/overview?range=7d`);
});

test('the gateway removes alternate proxy headers and preserves multiple cookies', async () => {
  let forwarded;
  const backend = { ...env, PORTFOLIO_ADMIN_ORIGIN: 'https://stage.akmalalif.com', ADMIN: { fetch: async (request) => {
    forwarded = request;
    const headers = new Headers({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors https://example.com" });
    headers.append('Set-Cookie', 'visitor=one; Secure; HttpOnly');
    headers.append('Set-Cookie', 'session=two; Secure; HttpOnly');
    return new Response('private', { headers });
  } } };
  const request = new Request(`${origin}/admin`, { headers: { 'Cf-Access-Jwt-Assertion': await jwt(), Forwarded: 'for=attacker;host=evil.test', 'X-Real-IP': 'spoofed', 'True-Client-IP': 'spoofed', 'X-Original-URL': '/api/link/delete' } });
  const response = await handleAdminGateway(request, backend, options);
  assert.equal(response.status, 200);
  for (const header of ['Forwarded', 'X-Real-IP', 'True-Client-IP', 'X-Original-URL']) assert.equal(forwarded.headers.get(header), null);
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'www.akmalalif.com');
  assert.equal((await handleAdminGateway(new Request('https://stage.akmalalif.com/admin'), backend, options)).status, 404);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'self'; frame-ancestors 'none'");
});

test('public analytics has a separate, bounded canonical-origin gateway', async () => {
  const forwarded = [];
  const backend = { ...env, ADMIN: { fetch: async (request) => { forwarded.push(request); return Response.json({ accepted: 1 }); } } };
  const init = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.8', 'User-Agent': 'Browser test', 'x-portfolio-meta': '{"ip":"spoofed"}' }, body: '{"events":[]}' };
  const response = await handleAnalyticsGateway(new Request(`${origin}/api/events`, init), backend);
  assert.equal(response.status, 200);
  assert.equal(forwarded[0].url, `${origin}/internal/events`);
  assert.equal(JSON.parse(forwarded[0].headers.get('x-portfolio-meta')).ip, '192.0.2.8');
  assert.equal(forwarded[0].headers.get('x-portfolio-gateway'), env.PORTFOLIO_GATEWAY_TOKEN);
  assert.equal((await handleAnalyticsGateway(new Request('https://localhost/api/events', init), backend)).status, 403);
  assert.equal((await handleAnalyticsGateway(new Request(`${origin}/api/events`, { ...init, headers: { ...init.headers, Origin: 'https://evil.test' } }), backend)).status, 403);
  assert.equal((await handleAnalyticsGateway(new Request(`${origin}/api/events`, { ...init, body: 'x'.repeat(32769) }), backend)).status, 413);
  assert.equal((await handleAnalyticsGateway(new Request(`${origin}/api/events`), backend)).status, 405);
  assert.equal(forwarded.length, 1);
});

test('service calls forward only the credentials required by each boundary', async () => {
  const forwarded = [];
  const backend = { ...env, ADMIN: { fetch: async (request) => { forwarded.push(request); return Response.json({ ok: true }); } } };
  const token = await jwt();
  const cookie = `CF_Authorization=${token}; other-private-cookie=private; __Host-portfolio-visitor=visitor-signature; __Host-portfolio-session=session-signature`;

  const adminResponse = await handleAdminGateway(new Request(`${origin}/admin`, { headers: { Cookie: cookie } }), backend, options);
  assert.equal(adminResponse.status, 200);
  assert.equal(forwarded[0].headers.get('Cookie'), null);
  assert.equal(forwarded[0].headers.get('Cf-Access-Jwt-Assertion'), null);
  assert.equal(forwarded[0].headers.get('x-portfolio-admin-id'), 'root');
  assert.equal(forwarded[0].headers.get('x-portfolio-admin-email'), env.ADMIN_EMAIL);

  const eventResponse = await handleAnalyticsGateway(new Request(`${origin}/api/events`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'Cf-Access-Jwt-Assertion': token },
    body: '{"events":[]}',
  }), backend);
  assert.equal(eventResponse.status, 200);
  assert.equal(forwarded[1].headers.get('Cookie'), '__Host-portfolio-visitor=visitor-signature; __Host-portfolio-session=session-signature');
  assert.equal(forwarded[1].headers.get('Cf-Access-Jwt-Assertion'), null);
  assert.equal(forwarded[1].headers.get('x-portfolio-admin-id'), null);
  assert.equal(forwarded[1].headers.get('x-portfolio-admin-email'), null);
});
