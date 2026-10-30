import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPortfolioAuth,
  handlePortfolioAuth,
  MAX_AUTH_BODY_BYTES,
  safeAdminReturnPath,
  safeAdminErrorPath,
  validateBetterAuthIdentity,
} from '../worker/auth.js';

const origin = 'https://www.akmalalif.com';
const secret = 'test-secret-that-is-long-enough-for-better-auth';
const migration = readFileSync(new URL('../migrations/0005_better_auth.sql', import.meta.url), 'utf8');

class D1Shim {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(migration);
  }

  exec(sql) {
    this.sqlite.exec(sql);
  }

  prepare(sql) {
    const sqlite = this.sqlite;
    return {
      bind(...parameters) {
        return {
          async all() {
            const results = sqlite.prepare(sql).all(...parameters);
            return { results, meta: { changes: 0 } };
          },
          async first() {
            return sqlite.prepare(sql).get(...parameters) ?? null;
          },
          async run() {
            const result = sqlite.prepare(sql).run(...parameters);
            return {
              results: [],
              meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
            };
          },
        };
      },
    };
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.all()));
  }
}

function env(db, overrides = {}) {
  return {
    DB: db,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: secret,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'github-secret',
    ADMIN_EMAIL: 'iamaleep@gmail.com',
    ADMIN_GITHUB_ID: '44127834',
    ...overrides,
  };
}

function provider(id, getProfile) {
  return {
    id,
    name: id,
    options: {},
    accountSubject: ({ profile }) => String(profile.id),
    async createAuthorizationURL({ state, redirectURI }) {
      return new URL(`https://provider.test/${id}?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectURI)}`);
    },
    async validateAuthorizationCode() {
      return { accessToken: `${id}-access-token`, refreshToken: `${id}-refresh-token`, scopes: ['read:user'] };
    },
    async getUserInfo() {
      const profile = getProfile();
      return {
        user: {
          name: profile.name || id,
          email: profile.email,
          emailVerified: profile.emailVerified === true,
          image: profile.image,
        },
        data: profile,
      };
    },
  };
}

function authOptions(googleProfile, githubProfile) {
  return {
    plugins: [{
      id: 'test-social-providers',
      init(context) {
        return {
          context: {
            socialProviders: [
              provider('google', () => googleProfile),
              provider('github', () => githubProfile),
              ...context.socialProviders,
            ],
          },
        };
      },
    }],
  };
}

async function signIn(db, runtimeEnv, options, providerId, callbackURL = '/admin') {
  const response = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: providerId, callbackURL, disableRedirect: true }),
  }), runtimeEnv, options);
  assert.equal(response.status, 200);
  const body = await response.json();
  const authorizationURL = new URL(body.url);
  const stateCookies = response.headers.getSetCookie();
  const callbackHeaders = stateCookies.length > 0
    ? { Cookie: stateCookies.map((value) => value.split(';', 1)[0]).join('; ') }
    : {};
  const callback = await handlePortfolioAuth(new Request(`${origin}/api/auth/callback/${providerId}?code=accepted&state=${authorizationURL.searchParams.get('state')}`, { headers: callbackHeaders }), runtimeEnv, options);
  assert.equal(callback.status, 302);
  const setCookies = callback.headers.getSetCookie();
  const location = callback.headers.get('Location') || '';
  if (location.includes('/admin')) assert.ok(setCookies.length > 0);
  return {
    callback,
    cookie: setCookies.map((value) => value.split(';', 1)[0]).join('; '),
    setCookies,
  };
}

async function beginSignIn(runtimeEnv, options, providerId, callbackURL = '/admin') {
  const response = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: providerId, callbackURL, disableRedirect: true }),
  }), runtimeEnv, options);
  assert.equal(response.status, 200);
  const authorizationURL = new URL((await response.json()).url);
  const stateCookies = response.headers.getSetCookie();
  const callbackHeaders = stateCookies.length > 0
    ? { Cookie: stateCookies.map((value) => value.split(';', 1)[0]).join('; ') }
    : {};
  return { authorizationURL, callbackHeaders };
}

function count(db, table) {
  return db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function authCounts(db) {
  return ['auth_user', 'auth_account', 'auth_session'].map((table) => count(db, table));
}

test('safe admin returns remain same-origin admin paths', () => {
  assert.equal(safeAdminReturnPath('/admin/portfolio?tab=about'), '/admin/portfolio?tab=about');
  assert.equal(safeAdminReturnPath('/admin/login'), '/admin');
  assert.equal(safeAdminReturnPath('https://evil.example/steal'), '/admin');
  assert.equal(safeAdminReturnPath('//evil.example/steal'), '/admin');
  assert.equal(safeAdminReturnPath('/admin/%2F%2Fevil.example'), '/admin///evil.example');
  assert.equal(safeAdminErrorPath('/admin/login'), '/admin/login');
  assert.equal(safeAdminErrorPath('/admin/login?redirect=%2Fadmin%2Fportfolio%3Ftab%3Dabout'), '/admin/login?redirect=%2Fadmin%2Fportfolio%3Ftab%3Dabout');
  assert.equal(safeAdminErrorPath('/admin/login?redirect=https%3A%2F%2Fevil.example'), '/admin/login');
  assert.equal(safeAdminErrorPath('/admin/login?redirect=%2Fadmin%2Fportfolio&other=ignored'), '/admin/login?redirect=%2Fadmin%2Fportfolio');
});

test('auth request bodies are capped before parsing, including chunked bodies', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const oversizedJSON = JSON.stringify({ provider: 'google', callbackURL: '/admin', payload: 'x'.repeat(MAX_AUTH_BODY_BYTES) });
  const oversized = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: oversizedJSON,
  }), runtimeEnv);
  assert.equal(oversized.status, 413);
  assert.equal(count(db, 'auth_user'), 0);
  assert.equal(count(db, 'auth_account'), 0);
  assert.equal(count(db, 'auth_session'), 0);

  const firstChunk = new Uint8Array(MAX_AUTH_BODY_BYTES / 2 + 1);
  const secondChunk = new Uint8Array(MAX_AUTH_BODY_BYTES / 2 + 1);
  const chunked = new ReadableStream({
    start(controller) {
      controller.enqueue(firstChunk);
      controller.enqueue(secondChunk);
      controller.close();
    },
  });
  const chunkedRequest = new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: chunked,
    duplex: 'half',
  });
  assert.equal(chunkedRequest.headers.get('Content-Length'), null);
  const chunkedResponse = await handlePortfolioAuth(chunkedRequest, runtimeEnv);
  assert.equal(chunkedResponse.status, 413);
  assert.equal(count(db, 'auth_user'), 0);
  assert.equal(count(db, 'auth_account'), 0);
  assert.equal(count(db, 'auth_session'), 0);
});

test('Better Auth social account mutation paths stay disabled with trailing slashes', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  for (const endpoint of ['link-social/', 'unlink-account/']) {
    const response = await handlePortfolioAuth(new Request(`${origin}/api/auth/${endpoint}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    }), runtimeEnv);
    assert.equal(response.status, 404, endpoint);
  }
  assert.equal(count(db, 'auth_user'), 0);
  assert.equal(count(db, 'auth_account'), 0);
  assert.equal(count(db, 'auth_session'), 0);
});

test('Better Auth OAuth gates before writes, persists encrypted tokens, and maps approved providers', async () => {
  const db = new D1Shim();
  const googleProfile = { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true };
  const githubProfile = { id: '44127834', email: 'iamaleep@gmail.com', emailVerified: true };
  const runtimeEnv = env(db);
  const options = authOptions(googleProfile, githubProfile);

  const first = await signIn(db, runtimeEnv, options, 'google');
  assert.equal(new URL(first.callback.headers.get('Location'), origin).pathname, '/admin');
  assert.equal(count(db, 'auth_user'), 1);
  assert.equal(count(db, 'auth_account'), 1);
  assert.equal(count(db, 'auth_session'), 1);
  const storedToken = db.sqlite.prepare('SELECT access_token FROM auth_account').get().access_token;
  assert.notEqual(storedToken, 'google-access-token');
  assert.match(storedToken, /^[0-9a-f]+$/i);
  assert.ok(first.setCookies.every((value) => /Secure/.test(value) && /HttpOnly/.test(value) && /SameSite=Lax/i.test(value) && !/Domain=/i.test(value)));

  const identity = await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: first.cookie } }), runtimeEnv, options);
  assert.deepEqual(identity, { id: 'root', email: 'iamaleep@gmail.com' });

  await signIn(db, runtimeEnv, options, 'google');
  assert.equal(count(db, 'auth_user'), 1);
  assert.equal(count(db, 'auth_account'), 1);
  assert.equal(count(db, 'auth_session'), 2);

  await signIn(db, runtimeEnv, options, 'github');
  assert.equal(count(db, 'auth_user'), 1);
  assert.equal(count(db, 'auth_account'), 2);
});

test('replaying a successful OAuth callback consumes state without creating another session', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const options = authOptions(
    { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true },
    { id: '44127834', email: 'private-github@example.com', emailVerified: true },
  );
  const { authorizationURL, callbackHeaders } = await beginSignIn(runtimeEnv, options, 'google');
  const callbackURL = `${origin}/api/auth/callback/google?code=accepted&state=${encodeURIComponent(authorizationURL.searchParams.get('state'))}`;

  const firstCallback = await handlePortfolioAuth(new Request(callbackURL, { headers: callbackHeaders }), runtimeEnv, options);
  assert.equal(firstCallback.status, 302);
  const countsAfterSuccess = authCounts(db);
  assert.deepEqual(countsAfterSuccess, [1, 1, 1]);

  const replay = await handlePortfolioAuth(new Request(callbackURL, { headers: callbackHeaders }), runtimeEnv, options);
  assert.equal(replay.status, 302);
  assert.equal(new URL(replay.headers.get('Location'), origin).origin, origin);
  assert.deepEqual(authCounts(db), countsAfterSuccess);
});

test('sign-out deletes the DB session and invalidates its old cookie', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const options = authOptions(
    { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true },
    { id: '44127834', email: 'private-github@example.com', emailVerified: true },
  );
  const login = await signIn(db, runtimeEnv, options, 'google');
  assert.equal(count(db, 'auth_session'), 1);
  assert.ok(await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: login.cookie } }), runtimeEnv, options));

  const signOut = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-out`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: login.cookie, 'Content-Type': 'application/json' },
    body: '{}',
  }), runtimeEnv, options);
  assert.equal(signOut.status, 200);
  assert.equal(count(db, 'auth_session'), 0);
  assert.equal(await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: login.cookie } }), runtimeEnv, options), null);
});

test('unapproved and unverified Google identities do not write after an approved GitHub login', async () => {
  const db = new D1Shim();
  const googleProfile = { id: 'google-owner', email: 'unapproved@example.com', emailVerified: true };
  const githubProfile = { id: '44127834', email: 'iamaleep@gmail.com', emailVerified: true };
  const runtimeEnv = env(db);
  const options = authOptions(googleProfile, githubProfile);
  await signIn(db, runtimeEnv, options, 'github');
  const approvedCounts = authCounts(db);
  assert.deepEqual(approvedCounts, [1, 1, 1]);

  await signIn(db, runtimeEnv, options, 'google');
  assert.deepEqual(authCounts(db), approvedCounts);

  googleProfile.email = 'iamaleep@gmail.com';
  googleProfile.emailVerified = false;
  await signIn(db, runtimeEnv, options, 'google');
  assert.deepEqual(authCounts(db), approvedCounts);
});

test('GitHub requires the immutable approved id and a verified primary email', async () => {
  const db = new D1Shim();
  const googleProfile = { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true };
  const githubProfile = { id: 'wrong-id', email: 'iamaleep@gmail.com', emailVerified: true };
  const runtimeEnv = env(db);
  const options = authOptions(googleProfile, githubProfile);
  const gate = createPortfolioAuth(runtimeEnv, options).options.user.validateUserInfo;
  assert.equal((await gate({ user: { email: githubProfile.email, emailVerified: true }, source: { method: 'oauth', oauth: { providerId: 'github', profile: { id: githubProfile.id } } } }, {}))?.error, 'admin_identity_not_allowed');
  const rejectedId = await signIn(db, runtimeEnv, options, 'github');
  const rejectedLocation = new URL(rejectedId.callback.headers.get('Location'), origin);
  assert.equal(rejectedLocation.pathname, '/admin/login');
  assert.match(rejectedLocation.search, /admin_identity_not_allowed|account_not_linked/);
  assert.equal(count(db, 'auth_user'), 0);
  assert.equal(count(db, 'auth_account'), 0);
  assert.equal(count(db, 'auth_session'), 0);

  githubProfile.id = '44127834';
  githubProfile.emailVerified = false;
  await signIn(db, runtimeEnv, options, 'github');
  assert.equal(count(db, 'auth_user'), 0);
  assert.equal(count(db, 'auth_account'), 0);
  assert.equal(count(db, 'auth_session'), 0);
});

test('GitHub user info reads the verified primary email endpoint without fallback', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const calls = [];
  let emailRows = [
    { email: 'private-github@example.com', primary: false, verified: true },
    { email: 'iamaleep@gmail.com', primary: true, verified: true },
  ];
  const auth = createPortfolioAuth(runtimeEnv, {
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/user')) return Response.json({ id: 44127834, login: 'login4kmal', name: 'Akmal' });
      return Response.json(emailRows);
    },
  });
  const github = auth.options.socialProviders.github;
  const allowed = await github.getUserInfo({ accessToken: 'github-access-token' });
  assert.equal(allowed.user.email, 'iamaleep@gmail.com');
  assert.equal(allowed.user.emailVerified, true);
  assert.equal(allowed.data.login, 'login4kmal');
  assert.deepEqual(calls.map(({ url }) => url).sort(), ['https://api.github.com/user', 'https://api.github.com/user/emails']);
  assert.match(calls[0].init.headers.Authorization, /^Bearer github-access-token$/);

  emailRows = [{ email: 'private-github@example.com', primary: false, verified: true }];
  const missingPrimary = await github.getUserInfo({ accessToken: 'github-access-token' });
  assert.equal(missingPrimary.user.email, undefined);
  assert.equal(missingPrimary.user.emailVerified, false);
});

test('approved providers with different verified emails produce separate owner-mapped users', async () => {
  const db = new D1Shim();
  const googleProfile = { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true };
  const githubProfile = { id: '44127834', email: 'private-github@example.com', emailVerified: true };
  const runtimeEnv = env(db);
  const options = authOptions(googleProfile, githubProfile);
  const github = await signIn(db, runtimeEnv, options, 'github');
  const google = await signIn(db, runtimeEnv, options, 'google');
  assert.equal(count(db, 'auth_user'), 2);
  assert.equal(count(db, 'auth_account'), 2);
  assert.deepEqual(await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: github.cookie } }), runtimeEnv, options), { id: 'root', email: 'iamaleep@gmail.com' });
  assert.deepEqual(await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: google.cookie } }), runtimeEnv, options), { id: 'root', email: 'iamaleep@gmail.com' });
});

test('session expiry and account removal revoke the next protected request', async () => {
  const db = new D1Shim();
  const googleProfile = { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true };
  const githubProfile = { id: '44127834', email: 'private-github@example.com', emailVerified: true };
  const runtimeEnv = env(db);
  const options = authOptions(googleProfile, githubProfile);
  const login = await signIn(db, runtimeEnv, options, 'google');
  const request = new Request(`${origin}/admin`, { headers: { Cookie: login.cookie } });
  assert.ok(await validateBetterAuthIdentity(request, runtimeEnv, options));
  db.exec(`UPDATE auth_session SET expires_at = '${new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString()}'`);
  const refreshed = await validateBetterAuthIdentity(request, runtimeEnv, options);
  assert.equal(refreshed.id, 'root');
  assert.ok(refreshed.setCookies?.some((value) => /portfolio-auth.*session_token/i.test(value)));
  db.exec("UPDATE auth_session SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal(await validateBetterAuthIdentity(request, runtimeEnv, options), null);

  const fresh = await signIn(db, runtimeEnv, options, 'google');
  db.exec('DELETE FROM auth_account');
  assert.equal(await validateBetterAuthIdentity(new Request(`${origin}/admin`, { headers: { Cookie: fresh.cookie } }), runtimeEnv, options), null);
});

test('auth configuration fails closed and Better Auth enforces origin and state', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const options = authOptions(
    { id: 'google-owner', email: 'iamaleep@gmail.com', emailVerified: true },
    { id: '44127834', email: 'private-github@example.com', emailVerified: true },
  );
  const missing = { ...runtimeEnv, BETTER_AUTH_SECRET: undefined };
  const missingResponse = await handlePortfolioAuth(new Request(`${origin}/api/auth/get-session`), missing);
  assert.equal(missingResponse.status, 503);
  assert.match(await missingResponse.text(), /BETTER_AUTH_SECRET/);

  const canonicalWithLocalFlag = { ...runtimeEnv, ALLOW_LOCAL_AUTH: 'true' };
  assert.equal((await handlePortfolioAuth(new Request('http://localhost/api/auth/get-session'), canonicalWithLocalFlag)).status, 404);

  const csrf = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google' }),
  }), runtimeEnv, options);
  assert.equal(csrf.status, 403);

  const valid = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: 'https://evil.example/', disableRedirect: true }),
  }), runtimeEnv, options);
  const authURL = new URL((await valid.json()).url);
  authURL.searchParams.set('state', `${authURL.searchParams.get('state')}forged`);
  const replay = await handlePortfolioAuth(new Request(`${origin}/api/auth/callback/google?code=accepted&state=${encodeURIComponent(authURL.searchParams.get('state'))}`), runtimeEnv, options);
  assert.equal(replay.status, 302);
  assert.equal(new URL(replay.headers.get('Location')).origin, origin);
  assert.equal(count(db, 'auth_user'), 0);
});

test('Better Auth native API is available from the configured D1 binding', () => {
  const db = new D1Shim();
  const auth = createPortfolioAuth(env(db));
  assert.equal(typeof auth.handler, 'function');
  assert.equal(typeof auth.api.getSession, 'function');
});

test('database rate limiting is enabled and keys requests by the Cloudflare client IP', async () => {
  const db = new D1Shim();
  const runtimeEnv = env(db);
  const auth = createPortfolioAuth(runtimeEnv);
  const context = await auth.$context;
  assert.equal(context.rateLimit.enabled, true);
  assert.deepEqual(context.options.advanced.ipAddress.ipAddressHeaders, ['cf-connecting-ip']);

  const response = await handlePortfolioAuth(new Request(`${origin}/api/auth/get-session`, {
    headers: { 'CF-Connecting-IP': '203.0.113.7' },
  }), runtimeEnv);
  assert.equal(response.status, 200);
  const rows = db.sqlite.prepare('SELECT key FROM auth_rate_limit').all();
  assert.ok(rows.some(({ key }) => key === '203.0.113.7|/get-session'));
});

test('GitHub authorization requests include the private-email scope', async () => {
  const db = new D1Shim();
  const response = await handlePortfolioAuth(new Request(`${origin}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'github', callbackURL: '/admin', disableRedirect: true }),
  }), env(db));
  assert.equal(response.status, 200);
  const scope = new URL((await response.json()).url).searchParams.get('scope')?.split(' ') ?? [];
  assert.ok(scope.includes('read:user'));
  assert.ok(scope.includes('user:email'));
});
