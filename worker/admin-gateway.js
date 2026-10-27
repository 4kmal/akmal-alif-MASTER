const ADMIN_ORIGIN = 'https://www.akmalalif.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const keys = new Map();
const encoder = new TextEncoder();

function reply(status, error) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function adminOrigin(env) {
  try {
    const configured = new URL(env.PORTFOLIO_ADMIN_ORIGIN || ADMIN_ORIGIN);
    if (configured.protocol !== 'https:' || configured.hostname.endsWith('.workers.dev') || configured.username || configured.password) return null;
    return configured.origin;
  } catch {
    return null;
  }
}

function decodePart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid JWT encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

function tokenFromRequest(request) {
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion) return assertion;
  const cookie = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('CF_Authorization='));
  return cookie ? cookie.slice('CF_Authorization='.length) : null;
}

export async function validateAccessIdentity(request, env, options = {}) {
  const now = options.now ?? Date.now();
  const fetcher = options.fetcher ?? fetch;
  const domain = String(env.CF_ACCESS_TEAM_DOMAIN || env.NUXT_CF_ACCESS_TEAM_DOMAIN || '').replace(/^https:\/\//, '').replace(/\/$/, '');
  const audience = env.CF_ACCESS_AUD || env.NUXT_CF_ACCESS_AUD;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !audience) return null;
  const token = tokenFromRequest(request);
  if (!token || token.length > 16384) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
    const expectedEmail = String(env.ADMIN_EMAIL || '').toLowerCase();
    if (!expectedEmail || expectedEmail.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(expectedEmail)) return null;
    const seconds = Math.floor(now / 1000);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256
      || claims.type !== 'app' || claims.common_name !== undefined
      || claims.iss !== `https://${domain}`
      || !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience)
      || !Number.isFinite(claims.exp) || claims.exp <= seconds
      || (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30))
      || (claims.iat != null && (!Number.isFinite(claims.iat) || claims.iat > seconds + 30))
      || typeof claims.sub !== 'string' || !claims.sub
      || typeof claims.email !== 'string' || claims.email.toLowerCase() !== expectedEmail) return null;

    const cacheKey = `${domain}:${header.kid}`;
    let cached = keys.get(cacheKey);
    if (!cached || cached.expires <= now) {
      const response = await fetcher(`https://${domain}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const jwks = await response.json();
      const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
      if (!jwk) return null;
      cached = { key: await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']), expires: now + 600000 };
      if (keys.size >= 16) keys.delete(keys.keys().next().value);
      keys.set(cacheKey, cached);
    }
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cached.key, decodePart(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
    return valid ? { email: claims.email.toLowerCase(), subject: claims.sub } : null;
  } catch {
    return null;
  }
}

export function isAdminPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export function isJudgingSyncPath(pathname) {
  return pathname === '/api/judging-sync/pair' || pathname.startsWith('/api/judging-sync/sdc-2026/');
}

export async function handleJudgingSyncGateway(request, env) {
  const url = new URL(request.url);
  if (url.origin !== adminOrigin(env) || !isJudgingSyncPath(url.pathname)) return reply(404, 'Not Found');
  if (!env.ADMIN || !env.PORTFOLIO_GATEWAY_TOKEN) return reply(503, 'Judging service is not configured');
  // Device credentials stay in the local service. Browser owner sessions use /api/admin/judging.
  if (request.headers.has('Origin') || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply(403, 'Device sync does not accept browser requests');
  if (!['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].includes(request.method)) return reply(405, 'Method Not Allowed');
  if (Number(request.headers.get('Content-Length')) > 5 * 1024 * 1024) return reply(413, 'Judging request is too large');
  const headers = trustedHeaders(request, env);
  headers.delete('Cf-Access-Jwt-Assertion');
  headers.delete('Cookie');
  const deviceAuthorization = request.headers.get('Authorization');
  if (deviceAuthorization) headers.set('Authorization', deviceAuthorization);
  if (url.pathname === '/api/judging-sync/pair') headers.set('x-judging-pair-ip', request.headers.get('CF-Connecting-IP') || 'unknown');
  return proxyResponse(await env.ADMIN.fetch(new Request(request, { headers, redirect: 'manual' })));
}

function trustedHeaders(request, env, analytics = false) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    const lower = name.toLowerCase();
    if (lower.startsWith('x-portfolio-') || lower.startsWith('x-forwarded-') || lower === 'authorization' || lower === 'cookie'
      || ['host', 'forwarded', 'x-real-ip', 'true-client-ip', 'x-original-url', 'x-original-host', 'x-rewrite-url', 'x-http-method-override'].includes(lower)
      || (lower.startsWith('cf-') && lower !== 'cf-access-jwt-assertion')) headers.delete(name);
  }
  const origin = new URL(adminOrigin(env) || ADMIN_ORIGIN);
  headers.set('x-portfolio-gateway', env.PORTFOLIO_GATEWAY_TOKEN);
  headers.set('x-forwarded-proto', origin.protocol.slice(0, -1));
  headers.set('x-forwarded-host', origin.host);
  if (analytics) {
    const cookies = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim())
      .filter((part) => /^__Host-portfolio-(visitor|session)=/.test(part));
    if (cookies.length) headers.set('Cookie', cookies.join('; '));
  } else {
    const assertion = tokenFromRequest(request);
    if (assertion) headers.set('Cf-Access-Jwt-Assertion', assertion);
  }
  return headers;
}

function proxyResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  const csp = (headers.get('Content-Security-Policy') || '').split(';').map((directive) => directive.trim()).filter((directive) => directive && !/^frame-ancestors\b/i.test(directive));
  csp.push("frame-ancestors 'none'");
  headers.set('Content-Security-Policy', csp.join('; '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function handleAdminGateway(request, env, options = {}) {
  const url = new URL(request.url);
  const local = LOCAL_HOSTS.has(url.hostname) && env.ALLOW_LOCAL_ADMIN === 'true';
  if (url.origin !== adminOrigin(env) && !local) return reply(404, 'Not Found');
  if (!env.ADMIN || !env.PORTFOLIO_GATEWAY_TOKEN) return reply(503, 'Admin service is not configured');
  if (!local && !await validateAccessIdentity(request, env, options)) return reply(401, 'Cloudflare Access owner sign-in required');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('Origin') !== url.origin) return reply(403, 'Cross-origin admin writes are not allowed');
  const target = new URL(url);
  if (url.pathname === '/api/admin/overview') target.pathname = '/api/portfolio/overview';
  else if (url.pathname.startsWith('/api/admin/portfolio/')) target.pathname = url.pathname.replace('/api/admin/portfolio/', '/api/portfolio/');
  else if (url.pathname.startsWith('/api/admin/sink/')) target.pathname = url.pathname.replace('/api/admin/sink/', '/api/');
  const upstream = new Request(target, request);
  const headers = trustedHeaders(request, env);
  return proxyResponse(await env.ADMIN.fetch(new Request(upstream, { headers, redirect: 'manual' })));
}

export async function handleAnalyticsGateway(request, env) {
  const url = new URL(request.url);
  const local = LOCAL_HOSTS.has(url.hostname) && env.ALLOW_LOCAL_ANALYTICS === 'true';
  if (url.origin !== ADMIN_ORIGIN && !local) return reply(403, 'Analytics writes are disabled on this hostname');
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return reply(403, 'Cross-origin events are not accepted');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply(415, 'Expected application/json');
  if (!env.ADMIN || !env.PORTFOLIO_GATEWAY_TOKEN) return reply(503, 'Analytics service is not configured');
  const length = Number(request.headers.get('Content-Length'));
  if (length > 32768) return reply(413, 'Event batch is too large');
  const reader = request.body?.getReader();
  const chunks = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 32768) {
        await reader.cancel();
        return reply(413, 'Event batch is too large');
      }
      chunks.push(value);
    }
  }
  const bodyBytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bodyBytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(bodyBytes);
  if (env.EVENT_RATE_LIMITER && !(await env.EVENT_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' })).success) return reply(429, 'Too many event batches');
  const headers = trustedHeaders(request, env, true);
  headers.delete('Cf-Access-Jwt-Assertion');
  const cf = request.cf || {};
  headers.set('x-portfolio-meta', JSON.stringify({
    ip: request.headers.get('CF-Connecting-IP') || null,
    userAgent: request.headers.get('User-Agent') || '',
    country: cf.country || null, region: cf.region || null, city: cf.city || null,
    timezone: cf.timezone || null, latitude: cf.latitude || null, longitude: cf.longitude || null, colo: cf.colo || null,
  }));
  const target = new URL('/internal/events', url.origin);
  const response = await env.ADMIN.fetch(new Request(target, { method: 'POST', headers, body, redirect: 'manual' }));
  return proxyResponse(response);
}
