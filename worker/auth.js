import { betterAuth } from 'better-auth';

export const CANONICAL_ORIGIN = 'https://www.akmalalif.com';
export const AUTH_BASE_PATH = '/api/auth';
export const MAX_AUTH_BODY_BYTES = 16 * 1024;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REQUIRED_ENV = [
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_GITHUB_ID',
];

const authCache = new WeakMap();

function normalizedEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function configError(message) {
  return { ok: false, error: message };
}

function resolveAuthConfig(env, options = {}) {
  const values = {
    ...env,
    ...(options.config ?? {}),
  };
  const database = options.database ?? env?.DB;
  if (!database || typeof database.prepare !== 'function' || typeof database.batch !== 'function' || typeof database.exec !== 'function') {
    return configError('Authentication service is not configured: the D1 database binding is unavailable');
  }
  const allowLocal = options.allowLocal === true || values.ALLOW_LOCAL_AUTH === 'true';
  const baseURL = String(options.baseURL ?? values.BETTER_AUTH_URL ?? '').replace(/\/+$/, '');
  let baseOrigin;
  try {
    baseOrigin = new URL(baseURL).origin;
  } catch {
    return configError('Authentication service is not configured: BETTER_AUTH_URL must be a valid origin');
  }

  if (baseOrigin !== CANONICAL_ORIGIN && !(allowLocal && isLocalOrigin(baseOrigin))) {
    return configError('Authentication service is not configured for the canonical origin');
  }

  const injectedValues = {
    BETTER_AUTH_URL: options.baseURL,
    BETTER_AUTH_SECRET: options.secret,
    GOOGLE_CLIENT_ID: options.googleClientId,
    GOOGLE_CLIENT_SECRET: options.googleClientSecret,
    GITHUB_CLIENT_ID: options.githubClientId,
    GITHUB_CLIENT_SECRET: options.githubClientSecret,
    ADMIN_EMAIL: options.adminEmail,
    ADMIN_GITHUB_ID: options.adminGithubId,
  };
  for (const key of REQUIRED_ENV) {
    const value = injectedValues[key] ?? values[key];
    if (typeof value !== 'string' || value.trim() === '') {
      return configError(`Authentication service is not configured: ${key} is missing`);
    }
  }

  const secret = String(options.secret ?? values.BETTER_AUTH_SECRET);
  if (secret.length < 32) {
    return configError('Authentication service is not configured: BETTER_AUTH_SECRET is too short');
  }
  const adminEmail = normalizedEmail(options.adminEmail ?? values.ADMIN_EMAIL);
  if (!adminEmail) {
    return configError('Authentication service is not configured: ADMIN_EMAIL is invalid');
  }
  const adminGithubId = String(options.adminGithubId ?? values.ADMIN_GITHUB_ID).trim();
  if (!/^\d+$/.test(adminGithubId)) {
    return configError('Authentication service is not configured: ADMIN_GITHUB_ID is invalid');
  }

  return {
    ok: true,
    allowLocal,
    localAuth: isLocalOrigin(baseOrigin),
    baseOrigin,
    secret,
    adminEmail,
    adminGithubId,
    database,
    googleClientId: String(options.googleClientId ?? values.GOOGLE_CLIENT_ID),
    googleClientSecret: String(options.googleClientSecret ?? values.GOOGLE_CLIENT_SECRET),
    githubClientId: String(options.githubClientId ?? values.GITHUB_CLIENT_ID),
    githubClientSecret: String(options.githubClientSecret ?? values.GITHUB_CLIENT_SECRET),
    providerOverrides: options.providerOverrides ?? {},
    plugins: options.plugins ?? [],
    fetcher: options.fetcher ?? fetch,
  };
}

function accountFields() {
  return {
    accountId: 'account_id',
    providerId: 'provider_id',
    userId: 'user_id',
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    idToken: 'id_token',
    accessTokenExpiresAt: 'access_token_expires_at',
    refreshTokenExpiresAt: 'refresh_token_expires_at',
    scope: 'scope',
    password: 'password',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
}

function userFields() {
  return {
    name: 'name',
    email: 'email',
    emailVerified: 'email_verified',
    image: 'image',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
}

function sessionFields() {
  return {
    expiresAt: 'expires_at',
    token: 'token',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
    userId: 'user_id',
  };
}

function verificationFields() {
  return {
    identifier: 'identifier',
    value: 'value',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  };
}

function githubUserInfo(config) {
  return async (token) => {
    const fetcher = config.fetcher;
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'akmalalif-portfolio-auth',
      Authorization: `Bearer ${token.accessToken}`,
    };
    let profileResponse;
    let emailsResponse;
    try {
      [profileResponse, emailsResponse] = await Promise.all([
        fetcher('https://api.github.com/user', { headers }),
        fetcher('https://api.github.com/user/emails', { headers }),
      ]);
      if (!profileResponse.ok || !emailsResponse.ok) return null;
      const [profile, emails] = await Promise.all([profileResponse.json(), emailsResponse.json()]);
      if (!profile || typeof profile !== 'object' || !Array.isArray(emails)) return null;

      // GitHub may omit a public email and may return a non-primary address first.
      // The allowlist policy must use the verified primary address only.
      const primary = emails.find((entry) => entry && entry.primary === true);
      const email = typeof primary?.email === 'string' ? primary.email : undefined;
      return {
        user: {
          name: String(profile.name || profile.login || ''),
          email,
          image: typeof profile.avatar_url === 'string' ? profile.avatar_url : undefined,
          emailVerified: primary?.verified === true,
        },
        data: profile,
      };
    } catch {
      return null;
    }
  };
}

function providerIsAllowed(source, user, config) {
  if (source?.method !== 'oauth') return false;
  const providerId = source.oauth?.providerId;
  const profile = source.oauth?.profile;
  const email = normalizedEmail(user?.email);
  if (!email || user?.emailVerified !== true) return false;
  if (providerId === 'google') return email === config.adminEmail;
  if (providerId === 'github') return String(profile?.id ?? '') === config.adminGithubId;
  return false;
}

function validateUserInfo(config) {
  return async ({ user, source }) => {
    if (!providerIsAllowed(source, user, config)) {
      return {
        error: 'admin_identity_not_allowed',
        errorDescription: 'This provider identity is not approved for the portfolio admin.',
      };
    }
    return undefined;
  };
}

function providerOptions(config) {
  const customGoogle = config.providerOverrides.google;
  const customGithub = config.providerOverrides.github;
  return {
    google: customGoogle ?? {
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
    },
    github: customGithub ?? {
      clientId: config.githubClientId,
      clientSecret: config.githubClientSecret,
      getUserInfo: githubUserInfo(config),
    },
  };
}

function buildAuth(config, env) {
  const local = config.baseOrigin !== CANONICAL_ORIGIN;
  const socialProviders = providerOptions(config);
  return betterAuth({
    appName: 'Akmal Alif Portfolio',
    baseURL: config.baseOrigin,
    basePath: AUTH_BASE_PATH,
    disabledPaths: ['/link-social', '/unlink-account'],
    secret: config.secret,
    database: config.database,
    socialProviders,
    plugins: config.plugins,
    user: {
      modelName: 'auth_user',
      fields: userFields(),
      validateUserInfo: validateUserInfo(config),
    },
    account: {
      modelName: 'auth_account',
      fields: accountFields(),
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        requireLocalEmailVerified: true,
        trustedProviders: ['google', 'github'],
        allowDifferentEmails: false,
      },
      encryptOAuthTokens: true,
    },
    session: {
      modelName: 'auth_session',
      fields: sessionFields(),
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    verification: {
      modelName: 'auth_verification',
      fields: verificationFields(),
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      fields: {
        key: 'key',
        count: 'count',
        lastRequest: 'last_request',
      },
    },
    trustedOrigins: (request) => {
      const origins = [CANONICAL_ORIGIN];
      if (local) origins.push(config.baseOrigin);
      try {
        const requestOrigin = new URL(request?.url ?? '').origin;
        if (config.localAuth && config.allowLocal && isLocalOrigin(requestOrigin)) origins.push(requestOrigin);
      } catch {
        // Better Auth calls this function without a request during initialization.
      }
      return origins;
    },
    advanced: {
      useSecureCookies: !local,
      cookiePrefix: 'portfolio-auth',
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      database: { validateSchema: false },
    },
  });
}

function hasCustomOptions(options) {
  return options && Object.keys(options).length > 0;
}

function getAuthRuntime(env, options = {}) {
  const config = resolveAuthConfig(env, options);
  if (!config.ok) return config;
  if (!hasCustomOptions(options) && env && typeof env === 'object') {
    const cached = authCache.get(env);
    if (cached) return cached;
    const auth = buildAuth(config, env);
    const runtime = { ...config, auth };
    authCache.set(env, runtime);
    return runtime;
  }
  return { ...config, auth: buildAuth(config, env) };
}

export function createPortfolioAuth(env, options = {}) {
  const runtime = getAuthRuntime(env, options);
  if (!runtime.ok) throw new Error(runtime.error);
  return runtime.auth;
}

function isAdminBoundary(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isLoginPath(pathname) {
  return pathname === '/admin/login' || pathname.startsWith('/admin/login/');
}

function parseSafeAdminReturnPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let candidate = value;
  try {
    for (let i = 0; i < 3; i += 1) {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }
  } catch {
    return null;
  }
  if (candidate.length > 2048 || !candidate.startsWith('/') || candidate.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(candidate)) return null;
  try {
    const target = new URL(candidate, CANONICAL_ORIGIN);
    if (target.origin !== CANONICAL_ORIGIN || !isAdminBoundary(target.pathname) || isLoginPath(target.pathname)) return null;
    return `${target.pathname}${target.search}`;
  } catch {
    return null;
  }
}

export function safeAdminReturnPath(value) {
  return parseSafeAdminReturnPath(value) ?? '/admin';
}

export function safeAdminErrorPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return '/admin/login';
  let candidate = value;
  try {
    for (let i = 0; i < 3; i += 1) {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }
  } catch {
    return '/admin/login';
  }
  if (candidate.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(candidate)) return '/admin/login';
  try {
    const target = new URL(candidate, CANONICAL_ORIGIN);
    if (target.origin !== CANONICAL_ORIGIN || target.pathname !== '/admin/login' || target.hash) return '/admin/login';
    const redirectValues = target.searchParams.getAll('redirect');
    if (redirectValues.length === 0) return '/admin/login';
    if (redirectValues.length !== 1) return '/admin/login';
    const redirect = parseSafeAdminReturnPath(redirectValues[0]);
    return redirect ? `/admin/login?redirect=${encodeURIComponent(redirect)}` : '/admin/login';
  } catch {
    return '/admin/login';
  }
}

function authResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function authError(status, error) {
  return Response.json({ error }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function errorClassification(error) {
  const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/.test(error.name)
    ? error.name
    : 'UnknownError';
  const code = typeof error?.body?.code === 'string' && /^[A-Za-z0-9_.-]{1,63}$/.test(error.body.code)
    ? error.body.code
    : typeof error?.code === 'string' && /^[A-Za-z0-9_.-]{1,63}$/.test(error.code)
      ? error.code
      : 'unknown';
  return `${name}:${code}`;
}

function setCookieHeaders(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get?.('set-cookie');
  return value ? [value] : [];
}

function requestOriginAllowed(request, runtime) {
  const url = new URL(request.url);
  if (url.origin === runtime.baseOrigin) return true;
  return false;
}

async function sanitizedRequest(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return request;
  const pathname = new URL(request.url).pathname;
  if (!pathname.endsWith('/sign-in/social')) return request;
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return request;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return request;
  for (const key of ['callbackURL', 'newUserCallbackURL']) {
    if (key in body) body[key] = safeAdminReturnPath(body[key]);
  }
  // Better Auth appends the provider error to this fixed retry endpoint. Keep
  // cancellation and denied-login flows on the public login shell.
  body.errorCallbackURL = safeAdminErrorPath(body.errorCallbackURL);
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  return new Request(request, { headers, body: JSON.stringify(body) });
}

async function boundedAuthRequest(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return { request, tooLarge: false };
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTH_BODY_BYTES) {
    return { request, tooLarge: true };
  }
  const body = request.body;
  if (!body) return { request, tooLarge: false };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_AUTH_BODY_BYTES) {
        reader.releaseLock();
        return { request, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch (error) {
    console.error('Authentication request body failed', errorClassification(error));
    return { request, readError: true };
  }
  if (chunks.length === 0) return { request, tooLarge: false };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { request: new Request(request, { body: bytes }), tooLarge: false };
}

export async function handlePortfolioAuth(request, env, options = {}) {
  const runtime = getAuthRuntime(env, options);
  if (!runtime.ok) return authError(503, runtime.error);
  if (!requestOriginAllowed(request, runtime)) return authError(404, 'Not Found');
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${AUTH_BASE_PATH}/`) && url.pathname !== AUTH_BASE_PATH) return authError(404, 'Not Found');
  if (url.pathname.endsWith('/link-social') || url.pathname.endsWith('/unlink-account')) return authError(404, 'Not Found');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const requestOrigin = request.headers.get('Origin');
    if (!requestOrigin || requestOrigin !== url.origin) return authError(403, 'Invalid origin');
  }
  try {
    const bounded = await boundedAuthRequest(request);
    if (bounded.tooLarge) return authError(413, 'Authentication request is too large');
    if (bounded.readError) return authError(400, 'Invalid authentication request body');
    return authResponse(await runtime.auth.handler(await sanitizedRequest(bounded.request)));
  } catch (error) {
    console.error('Better Auth request failed', errorClassification(error));
    return authError(500, 'Authentication request failed');
  }
}

export async function validateBetterAuthIdentity(request, env, options = {}) {
  const runtime = getAuthRuntime(env, options);
  if (!runtime.ok || !requestOriginAllowed(request, runtime)) return null;
  try {
    const result = await runtime.auth.api.getSession({ headers: request.headers, returnHeaders: true });
    const sessionResult = result?.response ?? result;
    const user = sessionResult?.user;
    const session = sessionResult?.session;
    if (!user || !session || (user.emailVerified !== true && Number(user.emailVerified) !== 1)) return null;
    if (!env.DB || typeof env.DB.prepare !== 'function') return null;
    const accountResult = await env.DB.prepare('SELECT provider_id, account_id FROM auth_account WHERE user_id = ?')
      .bind(user.id)
      .all();
    const accounts = accountResult?.results ?? [];
    const approved = accounts.some((account) => {
      if (account.provider_id === 'google') return normalizedEmail(user.email) === runtime.adminEmail;
      if (account.provider_id === 'github') return String(account.account_id) === runtime.adminGithubId;
      return false;
    });
    if (!approved) return null;
    const identity = { id: 'root', email: runtime.adminEmail };
    const setCookies = setCookieHeaders(result?.headers);
    if (setCookies.length) identity.setCookies = setCookies;
    return identity;
  } catch {
    return null;
  }
}

export function authMode(env) {
  const mode = String(env?.ADMIN_AUTH_MODE ?? 'better-auth').trim().toLowerCase();
  return mode === 'access' || mode === 'better-auth' ? mode : null;
}
