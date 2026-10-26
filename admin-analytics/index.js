const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const ANALYTICS_TIMEZONE = 'Asia/Kuala_Lumpur';
const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SUMMARY_RETENTION_MONTHS = 13;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 20;
const MAX_REPORT_ROWS = 50_000;
const MAX_HISTORY_ROWS = 100;
const MAINTENANCE_BATCH_SIZE = 1_000;
const MAX_PATH_LENGTH = 512;
const HLL_REGISTERS = 64;
const HLL_ALPHA = 0.709;
const MAX_PERFORMANCE_QUERY_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_CF_QUERY_TIMEOUT_MS = 5_000;
const PORTFOLIO_WORKER_SCRIPT = 'akmalalif-portfolio';
const ADMIN_WORKER_SCRIPT = 'akmalalif-admin';
const VISITOR_COOKIE = '__Host-portfolio-visitor';
const SESSION_COOKIE = '__Host-portfolio-session';
const VISITOR_COOKIE_MAX_AGE = 13 * 31 * 24 * 60 * 60;
const SESSION_COOKIE_MAX_AGE = 30 * 60;

class AnalyticsRangeLimitError extends Error {
  constructor() {
    super('Raw analytics detail exceeds the bounded report limit');
    this.code = 'REPORT_TOO_LARGE';
  }
}

class HistoryQueryError extends Error {
  constructor(message, status = 400, meta = undefined) {
    super(message);
    this.code = 'HISTORY_QUERY_INVALID';
    this.status = status;
    this.meta = meta;
  }
}

const EVENT_TYPES = new Set([
  'page_view',
  'heartbeat',
  'article_progress',
  'article_complete',
  'outbound_click',
  'download_start',
  'media_start',
  'media_progress',
  'media_complete',
  'playground_open',
  'contact_open',
  'contact_interaction',
]);

const REPORT_ROUTES = new Set([
  'overview',
  'traffic',
  'content',
  'engagement',
  'conversions',
  'realtime',
  'performance',
  'history',
]);

const CAMPAIGN_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

const INSERT_EVENT_SQL = [
  '  INSERT OR IGNORE INTO portfolio_analytics_events (',
  '    event_id, event_type, source_event_type, path, target, progress,',
  '    active_ms, media_id, media_kind, played_ms, duration_ms, referrer,',
  '    campaign_json, shortlink_slug, source, source_event_id, event_at,',
  '    received_at, visitor_key, session_key, session_started_at, ip,',
  '    user_agent, country, region, city, timezone, latitude, longitude,',
  '    colo, is_bot',
  '  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ''
].join('\n');

const REPORT_EVENT_SELECT = [
  '  SELECT',
  '    event_id, event_type, source_event_type, path, target, progress,',
  '    active_ms, media_id, media_kind, played_ms, duration_ms, referrer,',
  '    campaign_json, shortlink_slug, source, source_event_id, event_at,',
  '    received_at, visitor_key, session_key, session_started_at,',
  '    country, region, city, timezone, latitude, longitude, colo, is_bot',
  '  FROM portfolio_analytics_events'
].join('\n');

function analyticsDb(env) {
  // The standalone admin Worker binds the new D1 resource as DB. Keep the
  // explicit names for local tests and service-bound callers.
  return env?.NEWadminD1 ?? env?.newadminDB ?? env?.ADMIN_DB ?? env?.DB ?? null;
}

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': JSON_CONTENT_TYPE,
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    }),
  });
}

function errorResponse(status, message, meta = undefined) {
  return jsonResponse(meta ? { error: message, meta } : { error: message }, status);
}

function rowsFromResult(result) {
  return Array.isArray(result) ? result : result?.results ?? [];
}

function resultChanges(result) {
  const changes = result?.meta?.changes ?? result?.changes ?? 0;
  const number = Number(changes);
  return Number.isFinite(number) ? number : 0;
}

function nowMs(env = {}) {
  const supplied = env.ANALYTICS_NOW ?? env.__analyticsNow;
  if (typeof supplied === 'number' && Number.isFinite(supplied)) {
    return Math.trunc(supplied);
  }
  if (typeof supplied === 'string') {
    const parsed = Date.parse(supplied);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (typeof env.ANALYTICS_CLOCK === 'function') {
    const clockValue = env.ANALYTICS_CLOCK();
    if (typeof clockValue === 'number' && Number.isFinite(clockValue)) {
      return Math.trunc(clockValue);
    }
  }
  return Date.now();
}

function leftText(value, limit) {
  return Array.from(String(value ?? '')).slice(0, limit).join('');
}

function cleanText(value, limit) {
  if (value == null) {
    return null;
  }
  const cleaned = Array.from(String(value))
    .filter((character) => character >= ' ' && character !== '\u007f')
    .join('')
    .trim();
  return cleaned ? leftText(cleaned, limit) : null;
}

function finiteNumber(value, minimum, maximum) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(maximum, Math.max(minimum, number));
}

function finiteInteger(value, minimum, maximum) {
  const number = finiteNumber(value, minimum, maximum);
  return number == null ? null : Math.trunc(number);
}

function normalizePath(value) {
  const raw = cleanText(value, MAX_PATH_LENGTH);
  if (!raw || raw.startsWith('//')) {
    return '/';
  }

  try {
    const parsed = new URL(raw, 'https://www.akmalalif.com');
    if (!parsed.pathname.startsWith('/')) {
      return '/';
    }
    return leftText(parsed.pathname || '/', MAX_PATH_LENGTH);
  } catch {
    return '/';
  }
}

function normalizeUrlWithoutQuery(value, limit = 1024) {
  const raw = cleanText(value, limit);
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return leftText(parsed.origin + (parsed.pathname || '/'), limit);
  } catch {
    return null;
  }
}

function normalizeTarget(value) {
  const raw = cleanText(value, 512);
  if (!raw) {
    return null;
  }
  if (raw.startsWith('/')) {
    return normalizePath(raw);
  }
  return normalizeUrlWithoutQuery(raw, 512) ?? leftText(raw.split(/[?#]/, 1)[0], 512);
}

function normalizeCampaign(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const result = {};
  for (const field of CAMPAIGN_FIELDS) {
    const item = cleanText(value[field], 120);
    if (item) {
      result[field] = item;
    }
  }
  return Object.keys(result).length ? result : null;
}

function parseCampaign(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return normalizeCampaign(value);
  }
  try {
    return normalizeCampaign(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeBrowserEvent(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'events[' + index + '] must be an object' };
  }

  const id = cleanText(value.id, 128);
  if (!id) {
    return { error: 'events[' + index + '].id is required' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    return { error: 'events[' + index + '].id is invalid' };
  }

  const type = cleanText(value.type, 48);
  if (!EVENT_TYPES.has(type)) {
    return { error: 'events[' + index + '].type is not allowed' };
  }

  const path = normalizePath(value.path);
  return {
    eventId: id,
    eventType: type,
    sourceEventType: type,
    path,
    target: normalizeTarget(value.target),
    progress: finiteNumber(value.progress, 0, 100),
    activeMs: finiteInteger(value.active_ms, 0, 24 * 60 * 60 * 1000),
    mediaId: cleanText(value.media_id, 160),
    mediaKind: cleanText(value.media_kind, 80),
    playedMs: finiteInteger(value.played_ms, 0, 7 * 24 * 60 * 60 * 1000),
    durationMs: finiteInteger(value.duration_ms, 0, 7 * 24 * 60 * 60 * 1000),
    referrer: normalizeUrlWithoutQuery(value.referrer, 1024),
    campaign: normalizeCampaign(value.campaign),
    shortlinkSlug: null,
    source: 'portfolio',
    sourceEventId: null,
  };
}

function parseCookies(value) {
  const cookies = {};
  for (const part of String(value ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (key && item) {
      cookies[key] = item;
    }
  }
  return cookies;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomIdentifier() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function hmacHex(secret, value) {
  if (!globalThis.crypto?.subtle || !secret) {
    return null;
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function sameString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  let different = 0;
  for (let index = 0; index < left.length; index += 1) {
    different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return different === 0;
}

async function verifyIdentifier(raw, kind, secret, now) {
  const parts = String(raw ?? '').split('.');
  const expectedLength = kind === 'visitor' ? 4 : 6;
  if (parts.length !== expectedLength || parts[0] !== 'v1') {
    return null;
  }

  const expectedKind = kind === 'visitor' ? 'v' : 's';
  if (parts[1] !== expectedKind) {
    return null;
  }

  const identifier = parts[2];
  const startedAt = kind === 'session' ? Number(parts[3]) : null;
  const lastSeenAt = kind === 'session' ? Number(parts[4]) : null;
  if (!identifier || (
    kind === 'session' &&
    (!Number.isFinite(startedAt) || !Number.isFinite(lastSeenAt) ||
      now - lastSeenAt > SESSION_IDLE_MS || lastSeenAt > now + 60_000 ||
      startedAt > now + 60_000 || startedAt > lastSeenAt)
  )) {
    return null;
  }

  const payload = parts.slice(0, -1).join('.');
  const expected = await hmacHex(secret, payload);
  if (!expected || !sameString(expected, parts.at(-1))) {
    return null;
  }

  return {
    identifier,
    createdAt: kind === 'session' ? startedAt : null,
    lastSeenAt: kind === 'session' ? lastSeenAt : null,
  };
}

async function signedIdentifier(kind, identifier, createdAt, lastSeenAt, secret) {
  const payload = kind === 'visitor'
    ? 'v1.v.' + identifier
    : 'v1.s.' + identifier + '.' + createdAt + '.' + lastSeenAt;
  const signature = await hmacHex(secret, payload);
  return signature ? payload + '.' + signature : null;
}

function cookieHeader(name, value, maxAge) {
  return name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}

async function resolveIdentity(request, env, now) {
  const secret = cleanText(env.ANALYTICS_ID_SECRET, 256);
  if (!secret) {
    return {
      visitorKey: null,
      sessionKey: null,
      sessionStartedAt: null,
      cookies: [],
    };
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const visitor = await verifyIdentifier(cookies[VISITOR_COOKIE], 'visitor', secret, now);
  const existingSession = await verifyIdentifier(cookies[SESSION_COOKIE], 'session', secret, now);
  const visitorId = visitor?.identifier ?? randomIdentifier();
  const session = existingSession ?? {
    identifier: randomIdentifier(),
    createdAt: now,
  };

  const visitorCookie = await signedIdentifier('visitor', visitorId, null, null, secret);
  const sessionCookie = await signedIdentifier('session', session.identifier, session.createdAt, now, secret);
  const setCookies = [];
  if (!visitor) {
    setCookies.push(cookieHeader(VISITOR_COOKIE, visitorCookie, VISITOR_COOKIE_MAX_AGE));
  }
  setCookies.push(cookieHeader(SESSION_COOKIE, sessionCookie, SESSION_COOKIE_MAX_AGE))

  return {
    visitorKey: visitorId,
    sessionKey: session.identifier,
    sessionStartedAt: session.createdAt,
    cookies: setCookies,
  };
}

function headerMeta(request) {
  const raw = request.headers.get('x-portfolio-meta');
  if (!raw) {
    return { error: 'Missing trusted request metadata' };
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: 'Trusted request metadata must be valid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Trusted request metadata must be an object' };
  }

  return {
    ip: cleanText(value.ip, 128),
    userAgent: cleanText(value.userAgent, 2048),
    country: cleanText(value.country, 128),
    region: cleanText(value.region, 128),
    city: cleanText(value.city, 128),
    timezone: cleanText(value.timezone, 128),
    latitude: finiteNumber(value.latitude, -90, 90),
    longitude: finiteNumber(value.longitude, -180, 180),
    colo: cleanText(value.colo, 64),
  };
}

function knownBot(userAgent) {
  return /bot|crawler|spider|slurp|headless|lighthouse|facebookexternalhit|semrush|ahrefs/i.test(userAgent ?? '');
}

function localAnalyticsEnabled(env) {
  const value = env?.ALLOW_LOCAL_ANALYTICS;
  return value === true || ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function allowedIngestHost(url, env) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'www.akmalalif.com' || hostname === 'go.akmalalif.com') {
    return true;
  }
  if (localAnalyticsEnabled(env) && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return true;
  }
  return false;
}

function expectedGatewayToken(env) {
  return env.PORTFOLIO_GATEWAY_TOKEN
    ?? env.PORTFOLIO_ANALYTICS_GATEWAY_TOKEN
    ?? env.ANALYTICS_GATEWAY_TOKEN
    ?? null;
}

function validateIngestRequest(request, env, url) {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method Not Allowed', { allow: 'POST' });
  }
  if (url.pathname !== '/internal/events') {
    return errorResponse(404, 'Not Found');
  }
  if (!allowedIngestHost(url, env)) {
    return errorResponse(403, 'Analytics ingestion is restricted to production origins');
  }
  const localRequest = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(localRequest && localAnalyticsEnabled(env))) {
    return errorResponse(403, 'Analytics ingestion requires HTTPS');
  }

  const expected = expectedGatewayToken(env);
  const provided = request.headers.get('x-portfolio-gateway');
  if (!expected && !localAnalyticsEnabled(env)) {
    return errorResponse(503, 'Analytics gateway is not configured');
  }
  if (expected && provided !== expected) {
    return errorResponse(401, 'Analytics gateway authentication failed');
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'Analytics payload is too large');
  }
  return null;
}

function eventParams(event) {
  return [
    event.eventId,
    event.eventType,
    event.sourceEventType,
    event.path,
    event.target,
    event.progress,
    event.activeMs,
    event.mediaId,
    event.mediaKind,
    event.playedMs,
    event.durationMs,
    event.referrer,
    event.campaign ? JSON.stringify(event.campaign) : null,
    event.shortlinkSlug,
    event.source,
    event.sourceEventId,
    event.eventAt,
    event.receivedAt,
    event.visitorKey,
    event.sessionKey,
    event.sessionStartedAt,
    event.ip,
    event.userAgent,
    event.country,
    event.region,
    event.city,
    event.timezone,
    event.latitude,
    event.longitude,
    event.colo,
    event.isBot ? 1 : 0,
  ];
}

function executeBatch(db, statements) {
  if (!statements.length) {
    return Promise.resolve([]);
  }
  if (typeof db.batch === 'function') {
    return Promise.resolve(db.batch(statements));
  }
  return statements.reduce(
    (promise, statement) => promise.then(async (results) => [...results, await statement.run()]),
    Promise.resolve([]),
  );
}

function insertStatements(db, events) {
  return events.map((event) => db.prepare(INSERT_EVENT_SQL).bind(...eventParams(event)));
}

function pseudonymousIpKey(ip, env) {
  const value = cleanText(ip, 128);
  const secret = cleanText(env?.ANALYTICS_ID_SECRET, 256);
  if (!value || !secret) {
    return '';
  }
  return fnv1a(secret + ':' + value).toString(16).padStart(8, '0');
}

async function sinkVisitorKey(ip, env) {
  const value = cleanText(ip, 128);
  const secret = cleanText(env?.ANALYTICS_ID_SECRET, 256);
  if (!value || !secret) {
    return null;
  }
  const signature = await hmacHex(secret, 'sink-ip-v1:' + value);
  return signature ? 'sink-ip-v1:' + signature : null;
}

function dataPointForEvent(event, env) {
  return {
    indexes: [
      event.eventType,
      event.path,
      event.source,
      event.country,
      event.region,
      event.colo,
      pseudonymousIpKey(event.ip, env),
    ].map((value) => leftText(value ?? '', 96)),
    blobs: [
      event.target ?? '',
      event.shortlinkSlug ?? '',
      event.campaign ? JSON.stringify(event.campaign) : '',
    ],
    doubles: [
      event.progress ?? 0,
      event.activeMs ?? 0,
      event.playedMs ?? 0,
      event.durationMs ?? 0,
    ],
  };
}

function mirrorEvents(events, env, ctx) {
  // Portfolio events use the prefixed payload contract. Native Sink owns its
  // ANALYTICS binding and writes its own legacy access-log shape in the app
  // wrapper; mirroring this payload there would corrupt that dataset.
  const bindings = [env.PORTFOLIO_ANALYTICS].filter(
    (binding) => binding && typeof binding.writeDataPoint === 'function',
  );
  const writes = [];
  for (const binding of bindings) {
    for (const event of events) {
      writes.push(Promise.resolve().then(() => binding.writeDataPoint(dataPointForEvent(event, env))));
    }
  }
  const task = Promise.allSettled(writes);
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task);
    return Promise.resolve();
  }
  return task;
}

function canonicalEvent(base, meta, identity, now) {
  return {
    ...base,
    eventAt: now,
    receivedAt: now,
    visitorKey: identity.visitorKey,
    sessionKey: identity.sessionKey,
    sessionStartedAt: identity.sessionStartedAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
    country: meta.country,
    region: meta.region,
    city: meta.city,
    timezone: meta.timezone,
    latitude: meta.latitude,
    longitude: meta.longitude,
    colo: meta.colo,
    isBot: knownBot(meta.userAgent),
  };
}

export async function ingestEvents(request, env = {}, ctx = null) {
  const url = new URL(request.url);
  const rejected = validateIngestRequest(request, env, url);
  if (rejected) {
    return rejected;
  }

  const metadata = headerMeta(request);
  if (metadata.error) {
    return errorResponse(400, metadata.error);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse(400, 'Analytics payload could not be read');
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'Analytics payload is too large');
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, 'Analytics payload must be valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.events)) {
    return errorResponse(400, 'Analytics payload must contain an events array');
  }
  if (body.events.length > MAX_EVENTS) {
    return errorResponse(413, 'Analytics payload cannot contain more than ' + MAX_EVENTS + ' events');
  }

  const normalized = [];
  for (let index = 0; index < body.events.length; index += 1) {
    const event = normalizeBrowserEvent(body.events[index], index);
    if (event.error) {
      return errorResponse(400, event.error);
    }
    normalized.push(event);
  }

  const db = analyticsDb(env);
  if (!db) {
    return errorResponse(503, 'Analytics database is unavailable');
  }

  if (!cleanText(env.ANALYTICS_ID_SECRET, 256)) {
    return errorResponse(503, 'Analytics identity signing is unavailable', {
      source: 'portfolio_analytics',
      coverage: {
        unavailable: true,
        identities_unavailable: true,
      },
    });
  }

  const now = nowMs(env);
  const identity = await resolveIdentity(request, env, now);
  const events = normalized.map((event) => canonicalEvent(event, metadata, identity, now));
  let results;
  try {
    results = await executeBatch(db, insertStatements(db, events));
  } catch {
    return errorResponse(503, 'Analytics database write failed');
  }

  const acceptedEvents = events.filter((_, index) => resultChanges(results[index]) > 0);
  await mirrorEvents(acceptedEvents, env, ctx);

  const response = jsonResponse({
    accepted: acceptedEvents.length,
    deduped: events.length - acceptedEvents.length,
    server_time: new Date(now).toISOString(),
  });
  for (const cookie of identity.cookies) {
    response.headers.append('Set-Cookie', cookie);
  }
  return response;
}
function fnv1a(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createVisitorSketch() {
  return new Uint8Array(HLL_REGISTERS);
}

export function addVisitorToSketch(sketch, value) {
  if (!(sketch instanceof Uint8Array) || sketch.length !== HLL_REGISTERS || !value) {
    return sketch;
  }
  const hash = fnv1a(value);
  const index = hash & (HLL_REGISTERS - 1);
  let remaining = hash >>> 6;
  let rank = 1;
  while (rank < 27 && (remaining & 1) === 0) {
    rank += 1;
    remaining >>>= 1;
  }
  sketch[index] = Math.max(sketch[index], rank);
  return sketch;
}

export function mergeVisitorSketch(target, source) {
  if (!(target instanceof Uint8Array) || target.length !== HLL_REGISTERS) {
    return target;
  }
  if (!(source instanceof Uint8Array) || source.length !== HLL_REGISTERS) {
    return target;
  }
  for (let index = 0; index < HLL_REGISTERS; index += 1) {
    target[index] = Math.max(target[index], source[index]);
  }
  return target;
}

export function estimateVisitorSketch(sketch) {
  if (!(sketch instanceof Uint8Array) || sketch.length !== HLL_REGISTERS) {
    return 0;
  }
  let inverseSum = 0;
  let zeroRegisters = 0;
  for (const register of sketch) {
    inverseSum += 2 ** -register;
    if (register === 0) {
      zeroRegisters += 1;
    }
  }
  if (!inverseSum) {
    return 0;
  }
  const estimate = HLL_ALPHA * HLL_REGISTERS * HLL_REGISTERS / inverseSum;
  if (estimate <= 2.5 * HLL_REGISTERS && zeroRegisters > 0) {
    return HLL_REGISTERS * Math.log(HLL_REGISTERS / zeroRegisters);
  }
  return estimate;
}

function encodeVisitorSketch(sketch) {
  return Array.from(sketch, (value) => value.toString(16).padStart(2, '0')).join('');
}

function decodeVisitorSketch(value) {
  const sketch = createVisitorSketch();
  const raw = String(value ?? '');
  if (raw.length !== HLL_REGISTERS * 2 || !/^[0-9a-f]+$/i.test(raw)) {
    return sketch;
  }
  for (let index = 0; index < HLL_REGISTERS; index += 1) {
    sketch[index] = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
  }
  return sketch;
}

function hasEncodedSketch(value) {
  return typeof value === 'string' && value.length === HLL_REGISTERS * 2 && /^[0-9a-f]+$/i.test(value);
}

function visitorEstimate(rows) {
  const sketch = createVisitorSketch();
  let hasVisitor = false;
  for (const row of rows) {
    if (row.visitor_key) {
      hasVisitor = true;
      addVisitorToSketch(sketch, row.visitor_key);
    }
  }
  return hasVisitor ? Math.round(estimateVisitorSketch(sketch)) : null;
}

function sketchHasValues(sketch) {
  return sketch instanceof Uint8Array && sketch.some((value) => value > 0);
}

function estimateSketch(sketch) {
  return sketchHasValues(sketch) ? Math.round(estimateVisitorSketch(sketch)) : null;
}

function websiteRows(rows) {
  return rows.filter((row) => row.source !== 'sink' && row.source !== 'legacy_page_event');
}

function visitorEstimates(rows) {
  const website = visitorEstimate(websiteRows(rows));
  const shortlinks = visitorEstimate(rows.filter((row) => row.source === 'sink'));
  return {
    website: {
      unique_visitors: website,
      method: 'Browser identifier',
    },
    shortlinks: {
      unique_visitors: shortlinks,
      method: 'IP estimate',
    },
  };
}

function visitorSummaryFields(rows) {
  const estimates = visitorEstimates(rows);
  const website = estimates.website.unique_visitors;
  const shortlinks = estimates.shortlinks.unique_visitors;
  let method = null;
  if (website != null && shortlinks == null) {
    method = 'Browser identifier';
  } else if (shortlinks != null && website == null) {
    method = 'IP estimate';
  } else if (website != null && shortlinks != null) {
    method = 'Mixed sources; estimates are not combined';
  } else if (rows.some((row) => row.source === 'sink')) {
    method = rows.some((row) => row.source !== 'sink' && row.source !== 'legacy_page_event')
      ? 'Mixed sources; estimates are not combined'
      : 'IP estimate';
  } else if (rows.some((row) => row.source !== 'legacy_page_event')) {
    method = 'Browser identifier';
  }
  return {
    unique_visitors: method === 'Mixed sources; estimates are not combined' ? null : (website ?? shortlinks),
    visitor_estimates: estimates,
    visitor_method: method,
  };
}

function distinctCount(rows, key) {
  const values = new Set(rows.map((row) => row[key]).filter(Boolean));
  return values.size;
}

function parseStoredRow(row) {
  return {
    ...row,
    event_at: Number(row.event_at),
    progress: row.progress == null ? null : Number(row.progress),
    active_ms: row.active_ms == null ? null : Number(row.active_ms),
    played_ms: row.played_ms == null ? null : Number(row.played_ms),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    is_bot: Number(row.is_bot ?? 0),
    campaign: parseCampaign(row.campaign_json),
  };
}

function sourceClause(includeBots) {
  return includeBots ? '' : ' AND is_bot = 0';
}

async function queryEvents(db, from, to, includeBots = false) {
  const result = await db.prepare([
    REPORT_EVENT_SELECT,
    '    WHERE event_at >= ? AND event_at <= ?',
    "      AND source <> 'legacy_page_event'",
    sourceClause(includeBots),
    '    ORDER BY event_at ASC, event_id ASC',
    '    LIMIT ' + (MAX_REPORT_ROWS + 1),
  ].join('\n')).bind(from, to).all();
  const rows = rowsFromResult(result);
  if (rows.length > MAX_REPORT_ROWS) {
    throw new AnalyticsRangeLimitError();
  }
  return rows.map(parseStoredRow);
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: ANALYTICS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year + '-' + values.month + '-' + values.day;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function addMonths(timestamp, count) {
  const date = new Date(timestamp);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.getTime();
}

function rangeFromRequest(url, now) {
  const preset = url.searchParams.get('range') ?? url.searchParams.get('preset') ?? '24h';
  const durations = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': RAW_RETENTION_MS,
  };

  let from;
  let to;
  if (preset === 'custom') {
    from = Date.parse(url.searchParams.get('from') ?? '');
    to = Date.parse(url.searchParams.get('to') ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return { error: 'Custom reports require valid from and to timestamps' };
    }
    if (to <= from) {
      return { error: 'Report to must be after from' };
    }
    to = Math.min(to, now);
  } else if (durations[preset]) {
    to = now;
    from = now - durations[preset];
  } else {
    return { error: 'Report range must be 24h, 7d, 30d, 90d, or custom' };
  }

  if (to <= from) {
    return { error: 'Report range does not contain any time' };
  }

  const duration = to - from;
  return {
    preset,
    from,
    to,
    duration,
    priorFrom: from - duration,
    priorTo: from,
    summaryFrom: addMonths(now, -SUMMARY_RETENTION_MONTHS),
  };
}

async function trackingStart(db) {
  const row = await db.prepare([
    'SELECT MIN(event_at) AS first_event_at',
    'FROM portfolio_analytics_events',
    "WHERE source <> 'legacy_page_event' AND is_bot = 0",
  ].join('\n')).first();
  if (row?.first_event_at != null) {
    return Number(row.first_event_at);
  }
  const daily = await db.prepare([
    'SELECT MIN(first_event_at) AS first_event_at',
    'FROM portfolio_analytics_daily',
    "WHERE source NOT LIKE '%_bot' AND source <> 'legacy_page_event'",
  ].join('\n')).first();
  return daily?.first_event_at == null ? null : Number(daily.first_event_at);
}

function reportMeta(range, rows, trackingStartedAt, now, overrides = {}) {
  const hasData = rows.length > 0;
  const latest = rows.reduce((value, row) => Math.max(
    value,
    Number(row.event_at ?? row.last_event_at ?? 0),
  ), 0);
  const stale = latest ? now - latest > 24 * 60 * 60 * 1000 : null;
  const { coverage: coverageOverrides, ...otherOverrides } = overrides;
  return {
    source: 'portfolio_analytics',
    timezone: ANALYTICS_TIMEZONE,
    range: {
      preset: range.preset,
      from: new Date(range.from).toISOString(),
      to: new Date(range.to).toISOString(),
    },
    prior_range: {
      from: new Date(range.priorFrom).toISOString(),
      to: new Date(range.priorTo).toISOString(),
    },
    coverage: {
      has_data: hasData,
      tracking_started_at: trackingStartedAt ? new Date(trackingStartedAt).toISOString() : null,
      raw_detail_until: new Date(now - RAW_RETENTION_MS).toISOString(),
      stale,
      unavailable: false,
      ...coverageOverrides,
    },
    ...otherOverrides,
  };
}

function dailyBuckets(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = dayKey(row.event_at);
    const bucket = buckets.get(key) ?? {
      day: key,
      events: 0,
      page_views: 0,
      article_completions: 0,
      active_ms: 0,
      website_visitors: createVisitorSketch(),
      shortlink_visitors: createVisitorSketch(),
      sessions: new Set(),
    };
    bucket.events += 1;
    if (row.event_type === 'page_view') {
      bucket.page_views += 1;
    }
    if (row.event_type === 'article_complete') {
      bucket.article_completions += 1;
    }
    bucket.active_ms += row.active_ms ?? 0;
    if (row.visitor_key) {
      addVisitorToSketch(
        row.source === 'sink' ? bucket.shortlink_visitors : bucket.website_visitors,
        row.visitor_key,
      );
    }
    if (row.session_key) {
      bucket.sessions.add(row.session_key);
    }
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((bucket) => ({
      day: bucket.day,
      events: bucket.events,
      page_views: bucket.page_views,
      article_completions: bucket.article_completions,
      active_ms: bucket.active_ms,
      unique_visitors: estimateSketch(bucket.website_visitors),
      shortlink_unique_visitors: estimateSketch(bucket.shortlink_visitors),
      visitor_estimates: {
        website: {
          unique_visitors: estimateSketch(bucket.website_visitors),
          method: 'Browser identifier',
        },
        shortlinks: {
          unique_visitors: estimateSketch(bucket.shortlink_visitors),
          method: 'IP estimate',
        },
      },
      sessions: bucket.sessions.size,
    }));
}

function buildGoals(rows) {
  const definitions = [
    {
      id: 'engagement',
      label: 'Engagement',
      types: new Set(['article_complete', 'media_complete', 'playground_open']),
    },
    {
      id: 'career_contact',
      label: 'Contact intent',
      types: new Set(['contact_open', 'contact_interaction']),
      sessionConversion: true,
    },
    {
      id: 'shortlink_campaigns',
      label: 'Shortlink campaigns',
      types: new Set(),
      source: 'sink',
    },
  ];

  const denominatorSessions = distinctCount(rows, 'session_key');
  return definitions.map((definition) => {
    const matching = rows.filter((row) => (
      (definition.source ? row.source === definition.source || row.shortlink_slug : definition.types.has(row.event_type))
    ));
    const conversions = definition.sessionConversion
      ? distinctCount(matching, 'session_key')
      : matching.length;
    return {
      id: definition.id,
      label: definition.label,
      conversions,
      sessions: distinctCount(matching, 'session_key'),
      ...visitorSummaryFields(matching),
      denominator_sessions: denominatorSessions,
      conversion_rate: denominatorSessions ? conversions / denominatorSessions : null,
    };
  });
}

function buildInsights(rows, goals) {
  const insights = [];
  const pathCounts = new Map();
  for (const row of rows) {
    pathCounts.set(row.path, (pathCounts.get(row.path) ?? 0) + 1);
  }
  const topPath = [...pathCounts.entries()].sort((left, right) => (
    right[1] - left[1] || left[0].localeCompare(right[0])
  ))[0];
  if (topPath) {
    insights.push('Most active path: ' + topPath[0] + ' (' + topPath[1] + ' events).');
  }
  const pageViews = rows.filter((row) => row.event_type === 'page_view').length;
  const completions = rows.filter((row) => row.event_type === 'article_complete').length;
  if (pageViews > 0 && completions > 0) {
    insights.push('Article completion rate: ' + Math.round((completions / pageViews) * 100) + '%.');
  }
  const contactGoal = goals.find((goal) => goal.id === 'career_contact');
  if (contactGoal?.conversions) {
    insights.push(
      contactGoal.conversions + ' contact intent session' +
      (contactGoal.conversions === 1 ? '' : 's') + ' recorded.',
    );
  }
  return insights;
}

function comparisonSummary(rows) {
  const website = websiteRows(rows);
  const visitors = visitorEstimates(rows);
  return {
    events: rows.length,
    page_views: rows.filter((row) => row.event_type === 'page_view').length,
    article_completions: rows.filter((row) => row.event_type === 'article_complete').length,
    unique_visitors: visitors.website.unique_visitors,
    shortlink_unique_visitors: visitors.shortlinks.unique_visitors,
    visitor_estimates: visitors,
    sessions: distinctCount(website, 'session_key'),
    goals: buildGoals(rows),
  };
}

function buildOverview(rows, range, now, priorSummary = null) {
  const goals = buildGoals(rows);
  const website = websiteRows(rows);
  const visitors = visitorEstimates(rows);
  const activeWebsite = website.filter((row) => row.event_at >= now - ACTIVE_WINDOW_MS);
  const activeShortlinks = rows.filter((row) => row.source === 'sink' && row.event_at >= now - ACTIVE_WINDOW_MS);
  return {
    events: rows.length,
    page_views: rows.filter((row) => row.event_type === 'page_view').length,
    article_completions: rows.filter((row) => row.event_type === 'article_complete').length,
    unique_visitors: visitors.website.unique_visitors,
    shortlink_unique_visitors: visitors.shortlinks.unique_visitors,
    visitor_estimates: visitors,
    sessions: distinctCount(website, 'session_key'),
    active_visitors_5m: visitorEstimate(activeWebsite),
    shortlink_active_visitors_5m: visitorEstimate(activeShortlinks),
    active_ms: rows.reduce((sum, row) => sum + (row.active_ms ?? 0), 0),
    daily: dailyBuckets(rows),
    goals,
    insights: buildInsights(rows, goals),
    comparison: priorSummary,
    period: {
      from: new Date(range.from).toISOString(),
      to: new Date(range.to).toISOString(),
    },
  };
}

function topCounts(rows, value) {
  const counts = new Map();
  for (const row of rows) {
    const item = row[value];
    if (item) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ [value]: key, count }))
    .sort((left, right) => right.count - left.count || left[value].localeCompare(right[value]))
    .slice(0, 50);
}

function campaignLabel(campaign) {
  if (!campaign) {
    return null;
  }
  return CAMPAIGN_FIELDS
    .map((field) => campaign[field] ? field.replace('utm_', '') + '=' + campaign[field] : null)
    .filter(Boolean)
    .join('&') || null;
}

function buildLocations(rows) {
  const locations = new Map();
  for (const row of rows) {
    const country = row.country ?? 'unknown';
    const region = row.region ?? 'unknown';
    const key = [country, region].join('|');
    const current = locations.get(key) ?? {
      country,
      region,
      count: 0,
    };
    current.count += 1;
    locations.set(key, current);
  }
  return [...locations.values()]
    .sort((left, right) => right.count - left.count ||
      left.country.localeCompare(right.country) ||
      left.region.localeCompare(right.region))
    .slice(0, 100);
}

function buildTraffic(rows) {
  const campaigns = new Map();
  for (const row of rows) {
    const label = campaignLabel(row.campaign);
    if (label) {
      campaigns.set(label, (campaigns.get(label) ?? 0) + 1);
    }
  }
  return {
    paths: topCounts(rows, 'path'),
    referrers: topCounts(rows, 'referrer'),
    locations: buildLocations(rows),
    campaigns: [...campaigns.entries()]
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((left, right) => right.count - left.count || left.campaign.localeCompare(right.campaign))
      .slice(0, 50),
    daily: dailyBuckets(rows),
  };
}

function buildContent(rows) {
  const content = new Map();
  for (const row of rows.filter((item) => item.path.startsWith('/blog') || item.event_type.startsWith('article_'))) {
    const bucket = content.get(row.path) ?? {
      path: row.path,
      views: 0,
      progress_events: 0,
      completions: 0,
      active_ms: 0,
      progress_total: 0,
    };
    if (row.event_type === 'page_view') {
      bucket.views += 1;
    }
    if (row.event_type === 'article_progress') {
      bucket.progress_events += 1;
      bucket.progress_total += row.progress ?? 0;
    }
    if (row.event_type === 'article_complete') {
      bucket.completions += 1;
    }
    bucket.active_ms += row.active_ms ?? 0;
    content.set(row.path, bucket);
  }

  return [...content.values()]
    .map((bucket) => ({
      path: bucket.path,
      views: bucket.views,
      progress_events: bucket.progress_events,
      average_progress: bucket.progress_events
        ? Math.round((bucket.progress_total / bucket.progress_events) * 100) / 100
        : null,
      completions: bucket.completions,
      active_ms: bucket.active_ms,
    }))
    .sort((left, right) => right.views - left.views || left.path.localeCompare(right.path));
}

function buildEngagement(rows) {
  const byType = new Map();
  for (const row of rows) {
    const current = byType.get(row.event_type) ?? {
      event_type: row.event_type,
      count: 0,
      active_ms: 0,
      played_ms: 0,
    };
    current.count += 1;
    current.active_ms += row.active_ms ?? 0;
    current.played_ms += row.played_ms ?? 0;
    byType.set(row.event_type, current);
  }
  const media = new Map();
  for (const row of rows.filter((item) => item.media_id)) {
    const current = media.get(row.media_id) ?? {
      media_id: row.media_id,
      media_kind: row.media_kind,
      events: 0,
      played_ms: 0,
      duration_ms: row.duration_ms,
    };
    current.events += 1;
    current.played_ms += row.played_ms ?? 0;
    if (row.duration_ms != null) {
      current.duration_ms = Math.max(current.duration_ms ?? 0, row.duration_ms);
    }
    media.set(row.media_id, current);
  }
  return {
    event_types: [...byType.values()].sort((left, right) => (
      right.count - left.count || left.event_type.localeCompare(right.event_type)
    )),
    media: [...media.values()].sort((left, right) => (
      right.played_ms - left.played_ms || left.media_id.localeCompare(right.media_id)
    )),
  };
}

function buildConversions(rows) {
  const campaigns = new Map();
  for (const row of rows.filter((item) => item.source === 'sink' || item.shortlink_slug)) {
    const slug = row.shortlink_slug ?? row.path;
    const label = campaignLabel(row.campaign);
    const key = slug + '\u0000' + (label ?? '');
    const bucket = campaigns.get(key) ?? {
      slug,
      campaign: label,
      clicks: 0,
      sessions: new Set(),
      websiteVisitors: createVisitorSketch(),
      shortlinkVisitors: createVisitorSketch(),
      visitorMethods: new Set(),
    };
    bucket.clicks += 1;
    if (row.session_key) {
      bucket.sessions.add(row.session_key);
    }
    if (row.visitor_key) {
      addVisitorToSketch(
        row.source === 'sink' ? bucket.shortlinkVisitors : bucket.websiteVisitors,
        row.visitor_key,
      );
    }
    bucket.visitorMethods.add(row.source === 'sink' ? 'IP estimate' : 'Browser identifier');
    campaigns.set(key, bucket);
  }

  return {
    goals: buildGoals(rows),
    shortlink_campaigns: [...campaigns.values()]
      .map((bucket) => ({
        slug: bucket.slug,
        campaign: bucket.campaign,
        clicks: bucket.clicks,
        sessions: bucket.sessions.size,
        unique_visitors: bucket.visitorMethods.size === 1
          ? (bucket.visitorMethods.has('IP estimate')
            ? estimateSketch(bucket.shortlinkVisitors)
            : estimateSketch(bucket.websiteVisitors))
          : null,
        visitor_estimates: {
          website: {
            unique_visitors: estimateSketch(bucket.websiteVisitors),
            method: 'Browser identifier',
          },
          shortlinks: {
            unique_visitors: estimateSketch(bucket.shortlinkVisitors),
            method: 'IP estimate',
          },
        },
        visitor_method: bucket.visitorMethods.size === 1
          ? [...bucket.visitorMethods][0]
          : 'Mixed sources; estimates are not combined',
      }))
      .sort((left, right) => right.clicks - left.clicks || left.slug.localeCompare(right.slug)),
  };
}

function safeRealtimeRow(row) {
  return {
    event_id: row.event_id,
    timestamp: new Date(row.event_at).toISOString(),
    event_type: row.event_type,
    path: row.path,
    target: row.target,
    source: row.source,
    shortlink_slug: row.shortlink_slug,
    campaign: row.campaign,
  };
}

const HISTORY_SOURCES = new Set(['portfolio', 'sink', 'legacy_page_event']);
const HISTORY_EVENT_TYPES = new Set([...EVENT_TYPES, 'legacy_page_event']);
const HISTORY_CSV_COLUMNS = [
  'event_id',
  'event_type',
  'source_event_type',
  'source',
  'source_event_id',
  'event_at',
  'received_at',
  'path',
  'target',
  'progress',
  'active_ms',
  'media_id',
  'media_kind',
  'played_ms',
  'duration_ms',
  'referrer',
  'campaign',
  'shortlink_slug',
  'ip',
  'user_agent',
  'country',
  'region',
  'city',
  'timezone',
  'latitude',
  'longitude',
  'colo',
  'is_bot',
];

function decodeBase64Url(value) {
  const normalized = String(value ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function historyFilterKey(range, filters) {
  return JSON.stringify({
    range: range.preset === 'custom'
      ? { preset: 'custom', from: range.from, to: range.to }
      : { preset: range.preset },
    source: filters.source,
    event_type: filters.eventType,
    path: filters.path,
    shortlink_slug: filters.shortlinkSlug,
    include_bots: filters.includeBots,
  });
}

function encodeHistoryCursor(range, filters, row) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify({
    v: 1,
    event_at: Number(row.event_at),
    event_id: row.event_id,
    filter: historyFilterKey(range, filters),
  })));
}

function decodeHistoryCursor(value, range, filters) {
  if (!value) {
    return null;
  }
  if (value.length > 2_048) {
    throw new HistoryQueryError('History cursor is too large');
  }
  let cursor;
  try {
    cursor = JSON.parse(decodeBase64Url(value));
  } catch {
    throw new HistoryQueryError('History cursor is invalid');
  }
  if (!cursor || cursor.v !== 1 || !Number.isSafeInteger(cursor.event_at) ||
      !cleanText(cursor.event_id, 128) || cursor.filter !== historyFilterKey(range, filters)) {
    throw new HistoryQueryError('History cursor does not match the requested filters');
  }
  return {
    eventAt: cursor.event_at,
    eventId: cursor.event_id,
  };
}

function historyRangeFromRequest(url, now) {
  const cutoff = now - RAW_RETENTION_MS;
  const explicitBounds = url.searchParams.has('from') || url.searchParams.has('to');
  let from;
  let to;
  let preset = url.searchParams.get('range') ?? url.searchParams.get('preset') ?? '24h';
  if (explicitBounds || preset === 'custom') {
    from = Date.parse(url.searchParams.get('from') ?? '');
    to = Date.parse(url.searchParams.get('to') ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw new HistoryQueryError('History detail requires valid from and to timestamps');
    }
    preset = 'custom';
  } else {
    const durations = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': RAW_RETENTION_MS,
    };
    if (!durations[preset]) {
      throw new HistoryQueryError('History range must be 24h, 7d, 30d, 90d, or custom');
    }
    to = now;
    from = now - durations[preset];
  }

  to = Math.min(to, now);
  if (to <= from) {
    throw new HistoryQueryError('History range does not contain any time');
  }
  if (from < cutoff) {
    throw new HistoryQueryError(
      'Raw history is retained for the last 90 days only',
      416,
      {
        raw_detail_cutoff: new Date(cutoff).toISOString(),
        requested_from: new Date(from).toISOString(),
      },
    );
  }
  return {
    preset,
    from,
    to,
  };
}

function historyFiltersFromRequest(url) {
  const source = cleanText(url.searchParams.get('source'), 32);
  if (source && !HISTORY_SOURCES.has(source)) {
    throw new HistoryQueryError('History source filter is invalid');
  }
  const eventType = cleanText(url.searchParams.get('event_type') ?? url.searchParams.get('type'), 48);
  if (eventType && !HISTORY_EVENT_TYPES.has(eventType)) {
    throw new HistoryQueryError('History event_type filter is invalid');
  }
  const pathValue = cleanText(url.searchParams.get('path'), MAX_PATH_LENGTH);
  const shortlinkSlug = cleanText(url.searchParams.get('shortlink_slug') ?? url.searchParams.get('slug'), 256);
  const limitValue = url.searchParams.get('limit');
  const limit = limitValue == null ? 50 : finiteInteger(limitValue, 1, MAX_HISTORY_ROWS);
  if (limit == null || (limitValue != null && String(limit) !== String(Number(limitValue)))) {
    throw new HistoryQueryError('History limit must be an integer from 1 to ' + MAX_HISTORY_ROWS);
  }
  return {
    source,
    eventType,
    path: pathValue ? normalizePath(pathValue) : null,
    shortlinkSlug,
    includeBots: url.searchParams.get('include_bots') === '1',
    limit,
    cursor: url.searchParams.get('cursor'),
  };
}

function historyDetailRow(row) {
  const stored = parseStoredRow(row);
  const eventAt = Number(stored.event_at);
  const receivedAt = Number(stored.received_at);
  return {
    event_id: stored.event_id,
    event_type: stored.event_type,
    source_event_type: stored.source_event_type,
    source: stored.source,
    source_event_id: stored.source_event_id,
    event_at: Number.isFinite(eventAt) ? new Date(eventAt).toISOString() : null,
    received_at: Number.isFinite(receivedAt) ? new Date(receivedAt).toISOString() : null,
    path: stored.path,
    target: stored.target,
    progress: stored.progress,
    active_ms: stored.active_ms,
    media_id: stored.media_id,
    media_kind: stored.media_kind,
    played_ms: stored.played_ms,
    duration_ms: stored.duration_ms,
    referrer: stored.referrer,
    campaign: stored.campaign,
    shortlink_slug: stored.shortlink_slug,
    ip: stored.ip,
    user_agent: stored.user_agent,
    country: stored.country,
    region: stored.region,
    city: stored.city,
    timezone: stored.timezone,
    latitude: stored.latitude,
    longitude: stored.longitude,
    colo: stored.colo,
    is_bot: Boolean(stored.is_bot),
  };
}

function csvCell(value) {
  if (value == null) {
    return '';
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function historyCsv(rows) {
  const lines = [HISTORY_CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(HISTORY_CSV_COLUMNS.map((column) => csvCell(row[column])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function historyReport(db, url, now) {
  const range = historyRangeFromRequest(url, now);
  const filters = historyFiltersFromRequest(url);
  const cursor = decodeHistoryCursor(filters.cursor, range, filters);
  const clauses = [
    'event_at >= ?',
    'event_at <= ?',
  ];
  const params = [range.from, range.to];
  if (!filters.includeBots) {
    clauses.push('is_bot = 0');
  }
  if (filters.source) {
    clauses.push('source = ?');
    params.push(filters.source);
  }
  if (filters.eventType) {
    clauses.push('event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.path) {
    clauses.push('path = ?');
    params.push(filters.path);
  }
  if (filters.shortlinkSlug) {
    clauses.push('shortlink_slug = ?');
    params.push(filters.shortlinkSlug);
  }
  if (cursor) {
    clauses.push('(event_at < ? OR (event_at = ? AND event_id < ?))');
    params.push(cursor.eventAt, cursor.eventAt, cursor.eventId);
  }

  const result = await db.prepare([
    'SELECT event_id, event_type, source_event_type, path, target, progress,',
    '       active_ms, media_id, media_kind, played_ms, duration_ms, referrer,',
    '       campaign_json, shortlink_slug, source, source_event_id, event_at,',
    '       received_at, ip, user_agent, country, region, city, timezone,',
    '       latitude, longitude, colo, is_bot',
    'FROM portfolio_analytics_events',
    'WHERE ' + clauses.join('\n  AND '),
    'ORDER BY event_at DESC, event_id DESC',
    'LIMIT ' + (filters.limit + 1),
  ].join('\n')).bind(...params).all();
  const rows = rowsFromResult(result).map(historyDetailRow);
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const nextCursor = hasMore
    ? encodeHistoryCursor(range, filters, {
      event_at: Date.parse(page.at(-1).event_at),
      event_id: page.at(-1).event_id,
    })
    : null;
  const meta = {
    source: 'portfolio_analytics_events',
    detail: 'raw_90_day_events',
    timezone: ANALYTICS_TIMEZONE,
    raw_detail_cutoff: new Date(now - RAW_RETENTION_MS).toISOString(),
    range: {
      preset: range.preset,
      from: new Date(range.from).toISOString(),
      to: new Date(range.to).toISOString(),
    },
    filters: {
      source: filters.source,
      event_type: filters.eventType,
      path: filters.path,
      shortlink_slug: filters.shortlinkSlug,
      include_bots: filters.includeBots,
    },
    limit: filters.limit,
    returned: page.length,
    has_more: hasMore,
    next_cursor: nextCursor,
  };
  if (url.searchParams.get('format') === 'csv') {
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="portfolio-analytics-history.csv"',
      'X-Content-Type-Options': 'nosniff',
      'X-Has-More': String(hasMore),
    });
    if (nextCursor) {
      headers.set('X-Next-Cursor', nextCursor);
    }
    return new Response(historyCsv(page), { status: 200, headers });
  }
  return jsonResponse({
    data: {
      events: page,
      next_cursor: nextCursor,
      has_more: hasMore,
    },
    meta,
  });
}

async function queryDaily(db, from, to, dimension = 'all') {
  const result = await db.prepare([
    'SELECT day, dimension, dimension_value, source, event_count, session_count,',
    '       session_hll, active_ms, visitor_hll, first_event_at, last_event_at',
    'FROM portfolio_analytics_daily',
    'WHERE day >= ? AND day <= ? AND dimension = ?',
    "  AND source NOT LIKE '%_bot'",
    "  AND source <> 'legacy_page_event'",
    'ORDER BY day ASC, dimension_value ASC, source ASC',
  ].join('\n')).bind(dayKey(from), dayKey(to), dimension).all();
  return rowsFromResult(result).map((row) => ({
    ...row,
    event_count: Number(row.event_count ?? 0),
    session_count: Number(row.session_count ?? 0),
    session_sketch: decodeVisitorSketch(row.session_hll),
    has_session_sketch: hasEncodedSketch(row.session_hll),
    active_ms: Number(row.active_ms ?? 0),
    sketch: decodeVisitorSketch(row.visitor_hll),
    has_visitor_sketch: hasEncodedSketch(row.visitor_hll),
  }));
}

function summarizeDaily(rows) {
  const websiteVisitorSketch = createVisitorSketch();
  const shortlinkVisitorSketch = createVisitorSketch();
  const sessionSketch = createVisitorSketch();
  let events = 0;
  let legacySessions = 0;
  let hasSessionSketch = false;
  let hasWebsiteVisitors = false;
  let hasShortlinkVisitors = false;
  let activeMs = 0;
  for (const row of rows) {
    events += row.event_count;
    legacySessions += row.session_count;
    activeMs += row.active_ms;
    if (row.has_visitor_sketch && sketchHasValues(row.sketch)) {
      if (row.source === 'sink') {
        hasShortlinkVisitors = true;
        mergeVisitorSketch(shortlinkVisitorSketch, row.sketch);
      } else {
        hasWebsiteVisitors = true;
        mergeVisitorSketch(websiteVisitorSketch, row.sketch);
      }
    }
    if (row.has_session_sketch && sketchHasValues(row.session_sketch)) {
      hasSessionSketch = true;
      mergeVisitorSketch(sessionSketch, row.session_sketch);
    }
  }
  return {
    events,
    sessions: hasSessionSketch ? Math.round(estimateVisitorSketch(sessionSketch)) : legacySessions,
    active_ms: activeMs,
    unique_visitors: hasWebsiteVisitors ? Math.round(estimateVisitorSketch(websiteVisitorSketch)) : null,
    shortlink_unique_visitors: hasShortlinkVisitors
      ? Math.round(estimateVisitorSketch(shortlinkVisitorSketch))
      : null,
    visitor_estimates: {
      website: {
        unique_visitors: hasWebsiteVisitors ? Math.round(estimateVisitorSketch(websiteVisitorSketch)) : null,
        method: 'Browser identifier',
      },
      shortlinks: {
        unique_visitors: hasShortlinkVisitors ? Math.round(estimateVisitorSketch(shortlinkVisitorSketch)) : null,
        method: 'IP estimate',
      },
    },
  };
}

function dailySummaryBuckets(rows, eventRows = []) {
  const eventByDay = new Map();
  for (const row of eventRows) {
    const bucket = eventByDay.get(row.day) ?? { page_views: 0, article_completions: 0 };
    if (row.dimension_value === 'page_view') bucket.page_views += row.event_count;
    if (row.dimension_value === 'article_complete') bucket.article_completions += row.event_count;
    eventByDay.set(row.day, bucket);
  }
  const buckets = new Map();
  for (const row of rows) {
    const bucket = buckets.get(row.day) ?? {
      day: row.day,
      events: 0,
      active_ms: 0,
      page_views: 0,
      article_completions: 0,
      visitor_sketch: createVisitorSketch(),
      shortlink_visitor_sketch: createVisitorSketch(),
      has_visitor_sketch: false,
      has_shortlink_visitor_sketch: false,
      session_sketch: createVisitorSketch(),
      session_count: 0,
      has_session_sketch: false,
    };
    bucket.events += row.event_count;
    bucket.active_ms += row.active_ms;
    if (row.has_visitor_sketch && sketchHasValues(row.sketch)) {
      if (row.source === 'sink') {
        bucket.has_shortlink_visitor_sketch = true;
        mergeVisitorSketch(bucket.shortlink_visitor_sketch, row.sketch);
      } else {
        bucket.has_visitor_sketch = true;
        mergeVisitorSketch(bucket.visitor_sketch, row.sketch);
      }
    }
    bucket.session_count += row.session_count;
    if (row.has_session_sketch && sketchHasValues(row.session_sketch)) {
      bucket.has_session_sketch = true;
      mergeVisitorSketch(bucket.session_sketch, row.session_sketch);
    }
    buckets.set(row.day, bucket);
  }
  return [...buckets.values()]
    .sort((left, right) => left.day.localeCompare(right.day))
    .map((bucket) => ({
      day: bucket.day,
      events: bucket.events,
      page_views: eventByDay.get(bucket.day)?.page_views ?? 0,
      article_completions: eventByDay.get(bucket.day)?.article_completions ?? 0,
      active_ms: bucket.active_ms,
      unique_visitors: bucket.has_visitor_sketch
        ? Math.round(estimateVisitorSketch(bucket.visitor_sketch))
        : null,
      shortlink_unique_visitors: bucket.has_shortlink_visitor_sketch
        ? Math.round(estimateVisitorSketch(bucket.shortlink_visitor_sketch))
        : null,
      visitor_estimates: {
        website: {
          unique_visitors: bucket.has_visitor_sketch
            ? Math.round(estimateVisitorSketch(bucket.visitor_sketch))
            : null,
          method: 'Browser identifier',
        },
        shortlinks: {
          unique_visitors: bucket.has_shortlink_visitor_sketch
            ? Math.round(estimateVisitorSketch(bucket.shortlink_visitor_sketch))
            : null,
          method: 'IP estimate',
        },
      },
      sessions: bucket.has_session_sketch
        ? Math.round(estimateVisitorSketch(bucket.session_sketch))
        : bucket.session_count,
    }));
}

function goalsFromDaily(eventRows, denominatorSessions) {
  const definitions = [
    {
      id: 'engagement',
      label: 'Engagement',
      types: new Set(['article_complete', 'media_complete', 'playground_open']),
    },
    {
      id: 'career_contact',
      label: 'Contact intent',
      types: new Set(['contact_open', 'contact_interaction']),
      sessionConversion: true,
    },
    {
      id: 'shortlink_campaigns',
      label: 'Shortlink campaigns',
      source: 'sink',
    },
  ];
  return definitions.map((definition) => {
    const matching = eventRows.filter((row) => (
      definition.source
        ? row.source === definition.source
        : definition.types.has(row.dimension_value)
    ));
    const websiteVisitorSketch = createVisitorSketch();
    const shortlinkVisitorSketch = createVisitorSketch();
    let hasWebsiteVisitors = false;
    let hasShortlinkVisitors = false;
    const sessionSketch = createVisitorSketch();
    let fallbackSessions = 0;
    let hasSessionSketch = false;
    let eventCount = 0;
    for (const row of matching) {
      eventCount += row.event_count;
      if (row.has_visitor_sketch && sketchHasValues(row.sketch)) {
        if (row.source === 'sink') {
          hasShortlinkVisitors = true;
          mergeVisitorSketch(shortlinkVisitorSketch, row.sketch);
        } else {
          hasWebsiteVisitors = true;
          mergeVisitorSketch(websiteVisitorSketch, row.sketch);
        }
      }
      fallbackSessions += row.session_count;
      if (row.has_session_sketch && sketchHasValues(row.session_sketch)) {
        hasSessionSketch = true;
        mergeVisitorSketch(sessionSketch, row.session_sketch);
      }
    }
    const sessions = hasSessionSketch
      ? Math.round(estimateVisitorSketch(sessionSketch))
      : fallbackSessions;
    const conversions = definition.sessionConversion ? sessions : eventCount;
    const websiteVisitors = hasWebsiteVisitors
      ? Math.round(estimateVisitorSketch(websiteVisitorSketch))
      : null;
    const shortlinkVisitors = hasShortlinkVisitors
      ? Math.round(estimateVisitorSketch(shortlinkVisitorSketch))
      : null;
    return {
      id: definition.id,
      label: definition.label,
      conversions,
      sessions,
      unique_visitors: websiteVisitors != null && shortlinkVisitors != null
        ? null
        : (websiteVisitors ?? shortlinkVisitors),
      visitor_estimates: {
        website: {
          unique_visitors: websiteVisitors,
          method: 'Browser identifier',
        },
        shortlinks: {
          unique_visitors: shortlinkVisitors,
          method: 'IP estimate',
        },
      },
      visitor_method: websiteVisitors != null && shortlinkVisitors != null
        ? 'Mixed sources; estimates are not combined'
        : (shortlinkVisitors != null || definition.source === 'sink' ? 'IP estimate' : 'Browser identifier'),
      denominator_sessions: denominatorSessions,
      conversion_rate: denominatorSessions ? conversions / denominatorSessions : null,
    };
  });
}

function summaryFromDaily(allRows, eventRows) {
  const summary = summarizeDaily(allRows);
  return {
    ...summary,
    page_views: eventRows
      .filter((row) => row.dimension_value === 'page_view')
      .reduce((sum, row) => sum + row.event_count, 0),
    article_completions: eventRows
      .filter((row) => row.dimension_value === 'article_complete')
      .reduce((sum, row) => sum + row.event_count, 0),
    goals: goalsFromDaily(eventRows, summary.sessions),
    daily: dailySummaryBuckets(allRows, eventRows),
  };
}

function comparisonFromDaily(summary) {
  return {
    events: summary.events,
    page_views: summary.page_views,
    article_completions: summary.article_completions,
    unique_visitors: summary.unique_visitors,
    shortlink_unique_visitors: summary.shortlink_unique_visitors,
    visitor_estimates: summary.visitor_estimates,
    sessions: summary.sessions,
    goals: summary.goals,
  };
}

function performanceQueryRange(range) {
  const to = range.to;
  return {
    from: Math.max(range.from, to - MAX_PERFORMANCE_QUERY_MS),
    to,
  };
}

function isoRange(range) {
  return {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
  };
}

function unavailableSource(reason) {
  return {
    available: false,
    unavailable: true,
    has_data: false,
    reason,
  };
}

function availableSource(hasData) {
  return {
    available: true,
    unavailable: false,
    has_data: hasData,
  };
}

async function queryCloudflareGraphql(env, query, variables) {
  const fetcher = env.CF_ANALYTICS_QUERY ?? globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw new Error('CF GraphQL query function is unavailable');
  }

  const timeoutValue = finiteInteger(env.CF_ANALYTICS_TIMEOUT_MS, 1_000, 10_000);
  const timeoutMs = timeoutValue ?? DEFAULT_CF_QUERY_TIMEOUT_MS;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId = null;
  const request = Promise.resolve()
    .then(() => fetcher('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + cleanText(env.CF_ANALYTICS_TOKEN, 512),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      ...(controller ? { signal: controller.signal } : {}),
    }))
    .then(async (response) => {
      if (!response?.ok) {
        throw new Error('CF GraphQL request failed');
      }
      const body = await response.json();
      if (body?.errors?.length) {
        throw new Error('CF GraphQL response contained errors');
      }
      if (!body?.data || typeof body.data !== 'object') {
        throw new Error('CF GraphQL response did not include data');
      }
      return body.data;
    });
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort?.();
      reject(new Error('CF GraphQL query timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function numberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function microsecondsToMilliseconds(value) {
  const number = numberOrNull(value);
  return number == null ? null : Math.round((number / 1_000) * 1000) / 1000;
}

function workerRows(data, scriptName) {
  const account = data?.viewer?.accounts?.[0];
  const rows = Array.isArray(account?.workersInvocationsAdaptive)
    ? account.workersInvocationsAdaptive.slice(0, 1_000)
    : [];
  const series = rows.map((row) => ({
    timestamp: row?.dimensions?.datetime ?? null,
    status: row?.dimensions?.status ?? null,
    requests: numberOrNull(row?.sum?.requests),
    errors: numberOrNull(row?.sum?.errors),
    subrequests: numberOrNull(row?.sum?.subrequests),
    cpu_time_us: {
      p50: numberOrNull(row?.quantiles?.cpuTimeP50),
      p99: numberOrNull(row?.quantiles?.cpuTimeP99),
    },
  }));
  return {
    script_name: scriptName,
    rows: series,
    totals: {
      requests: series.reduce((sum, row) => sum + (row.requests ?? 0), 0),
      errors: series.reduce((sum, row) => sum + (row.errors ?? 0), 0),
      subrequests: series.reduce((sum, row) => sum + (row.subrequests ?? 0), 0),
    },
  };
}

function rumRows(data, siteTag) {
  const account = data?.viewer?.accounts?.[0];
  const rows = Array.isArray(account?.rumWebVitalsEventsAdaptiveGroups)
    ? account.rumWebVitalsEventsAdaptiveGroups.slice(0, 1_000)
    : [];
  const series = rows.map((row) => ({
    samples: numberOrNull(row?.count) ?? 0,
    dimensions: {
      timestamp: row?.dimensions?.datetime ?? null,
      site_tag: row?.dimensions?.siteTag ?? siteTag,
      host: row?.dimensions?.requestHost ?? null,
      path: row?.dimensions?.requestPath ?? null,
    },
    metrics: {
      lcp_ms_p75: microsecondsToMilliseconds(row?.quantiles?.largestContentfulPaintP75),
      inp_ms_p75: microsecondsToMilliseconds(row?.quantiles?.interactionToNextPaintP75),
      cls_p75: numberOrNull(row?.quantiles?.cumulativeLayoutShiftP75),
      fcp_ms_avg: microsecondsToMilliseconds(row?.avg?.firstContentfulPaint),
      ttfb_ms_avg: microsecondsToMilliseconds(row?.avg?.timeToFirstByte),
    },
  }));
  return {
    site_tag: siteTag,
    samples: series.reduce((sum, row) => sum + row.samples, 0),
    units: {
      timings: 'milliseconds',
      cpu_time: 'microseconds',
      cls: 'unitless',
    },
    series,
  };
}

async function performanceReport(env, range) {
  const requestedRange = isoRange(range);
  const queryRange = performanceQueryRange(range);
  const queryRangeMeta = isoRange(queryRange);
  const token = cleanText(env.CF_ANALYTICS_TOKEN, 512);
  const accountId = cleanText(env.CF_ACCOUNT_ID, 128);
  const siteTag = cleanText(env.CF_WEB_ANALYTICS_SITE_TAG, 256);
  const portfolioScript = cleanText(env.CF_PORTFOLIO_WORKER_NAME, 128) || PORTFOLIO_WORKER_SCRIPT;
  const adminScript = cleanText(env.CF_ADMIN_WORKER_NAME, 128) || ADMIN_WORKER_SCRIPT;
  const sourceMeta = {
    source: 'cloudflare_graphql',
    timezone: ANALYTICS_TIMEZONE,
    range: requestedRange,
    query_range: queryRangeMeta,
  };

  const unavailable = (workers, rum) => ({
    data: {
      cloudflare: null,
      rum_vitals: null,
    },
    meta: {
      ...sourceMeta,
      coverage: {
        has_data: false,
        unavailable: true,
        stale: false,
        workers,
        rum_vitals: rum,
      },
    },
  });

  if (!token || !accountId) {
    return unavailable(
      unavailableSource('CF GraphQL token or account ID is unavailable'),
      unavailableSource('CF GraphQL token or account ID is unavailable'),
    );
  }

  const workerQuery = [
    'query PortfolioWorkerPerformance($accountTag: string!, $datetimeStart: string!, $datetimeEnd: string!, $scriptName: string!) {',
    '  viewer {',
    '    accounts(filter: {accountTag: $accountTag}) {',
    '      workersInvocationsAdaptive(',
    '        limit: 1000',
    '        filter: {scriptName: $scriptName, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}',
    '      ) {',
    '        sum { requests errors subrequests }',
    '        quantiles { cpuTimeP50 cpuTimeP99 }',
    '        dimensions { datetime scriptName status }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const rumQuery = [
    'query PortfolioRumPerformance($accountTag: string!, $datetimeStart: string!, $datetimeEnd: string!, $siteTag: string!) {',
    '  viewer {',
    '    accounts(filter: {accountTag: $accountTag}) {',
    '      rumWebVitalsEventsAdaptiveGroups(',
    '        limit: 1000',
    '        filter: {siteTag: $siteTag, datetime_geq: $datetimeStart, datetime_leq: $datetimeEnd}',
    '      ) {',
    '        count',
    '        dimensions { datetime siteTag requestHost requestPath }',
    '        avg { largestContentfulPaint interactionToNextPaint cumulativeLayoutShift firstContentfulPaint timeToFirstByte }',
    '        quantiles { largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  const variables = {
    accountTag: accountId,
    datetimeStart: queryRangeMeta.from,
    datetimeEnd: queryRangeMeta.to,
  };

  const queryWorker = async (scriptName) => {
    try {
      const data = await queryCloudflareGraphql(env, workerQuery, { ...variables, scriptName });
      const value = workerRows(data, scriptName);
      return {
        value,
        status: availableSource(value.rows.length > 0),
      };
    } catch (error) {
      return {
        value: null,
        status: unavailableSource(error instanceof Error ? error.message : 'CF Workers metrics unavailable'),
      };
    }
  };

  const [portfolio, admin, rum] = await Promise.all([
    queryWorker(portfolioScript),
    queryWorker(adminScript),
    (async () => {
      if (!siteTag) {
        return {
          value: null,
          status: unavailableSource('CF Web Analytics site tag is unavailable'),
        };
      }
      try {
        const data = await queryCloudflareGraphql(env, rumQuery, { ...variables, siteTag });
        const value = rumRows(data, siteTag);
        return {
          value,
          status: availableSource(value.series.length > 0),
        };
      } catch (error) {
        return {
          value: null,
          status: unavailableSource(error instanceof Error ? error.message : 'CF Web Analytics RUM unavailable'),
        };
      }
    })(),
  ]);

  const workers = {
    scripts: {
      [portfolioScript]: portfolio.value,
      [adminScript]: admin.value,
    },
    units: {
      cpu_time: 'microseconds',
    },
  };
  const hasData = portfolio.status.has_data || admin.status.has_data || rum.status.has_data;
  return {
    data: {
      cloudflare: portfolio.value || admin.value ? workers : null,
      rum_vitals: rum.value,
    },
    meta: {
      ...sourceMeta,
      coverage: {
        has_data: hasData,
        unavailable: !portfolio.status.available && !admin.status.available && !rum.status.available,
        stale: false,
        workers: {
          [portfolioScript]: portfolio.status,
          [adminScript]: admin.status,
        },
        rum_vitals: rum.status,
      },
    },
  };
}

async function reportData(route, db, range, env, now, url) {
  if (route === 'performance') {
    return performanceReport(env, range);
  }

  const includeBots = url.searchParams.get('include_bots') === '1';
  const trackingStartedAt = await trackingStart(db);
  const rawCutoff = now - RAW_RETENTION_MS;
  const summaryCutoff = range.summaryFrom;
  if (range.to < summaryCutoff) {
    return {
      data: null,
      meta: reportMeta(range, [], trackingStartedAt, now, {
        detail: 'unavailable',
        coverage: {
          unavailable: true,
          reason: 'Requested period is outside the retained 13-month analytics history.',
          available_from: new Date(summaryCutoff).toISOString(),
        },
      }),
    };
  }

  const detailAvailable = range.from >= rawCutoff;
  const rows = detailAvailable
    ? await queryEvents(db, range.from, range.to, includeBots)
    : [];
  let priorSummary = null;
  if (range.priorFrom >= rawCutoff) {
    priorSummary = comparisonSummary(await queryEvents(db, range.priorFrom, range.priorTo, includeBots));
  } else if (range.priorTo >= summaryCutoff) {
    const priorFrom = Math.max(range.priorFrom, summaryCutoff);
    const priorDaily = await queryDaily(db, priorFrom, range.priorTo);
    const priorEventDaily = await queryDaily(db, priorFrom, range.priorTo, 'event_type');
    priorSummary = comparisonFromDaily(summaryFromDaily(priorDaily, priorEventDaily));
  }

  if (!detailAvailable) {
    const availableFrom = Math.max(range.from, summaryCutoff);
    const daily = await queryDaily(db, availableFrom, range.to);
    const eventDaily = await queryDaily(db, availableFrom, range.to, 'event_type');
    const summary = summaryFromDaily(daily, eventDaily);
    const meta = reportMeta(range, daily, trackingStartedAt, now, {
      detail: 'daily_rollup',
      coverage: {
        truncated: availableFrom > range.from,
        available_from: new Date(availableFrom).toISOString(),
        prior_available: Boolean(priorSummary),
      },
    });
    if (route === 'overview') {
      return {
        data: {
          ...summary,
          active_visitors_5m: null,
          insights: ['This period is available from 13-month daily summaries; event detail has expired.'],
          comparison: priorSummary,
        },
        meta,
      };
    }
    if (route === 'traffic') {
      const pathRows = await queryDaily(db, availableFrom, range.to, 'path');
      const campaignRows = await queryDaily(db, availableFrom, range.to, 'campaign');
      return {
        data: {
          paths: pathRows.map((row) => ({
            path: row.dimension_value,
            count: row.event_count,
          })),
          referrers: [],
          campaigns: campaignRows.map((row) => ({
            campaign: row.dimension_value,
            count: row.event_count,
          })),
          daily: summary.daily,
        },
        meta,
      };
    }
    if (route === 'conversions') {
      const shortlinkRows = await queryDaily(db, availableFrom, range.to, 'shortlink');
      return {
        data: {
          goals: summary.goals,
          shortlink_campaigns: shortlinkRows.map((row) => ({
            slug: row.dimension_value,
            campaign: null,
            clicks: row.event_count,
            sessions: row.has_session_sketch && sketchHasValues(row.session_sketch)
              ? Math.round(estimateVisitorSketch(row.session_sketch))
              : row.session_count,
            unique_visitors: sketchHasValues(row.sketch)
              ? Math.round(estimateVisitorSketch(row.sketch))
              : null,
            visitor_estimates: {
              website: {
                unique_visitors: row.source === 'sink' ? null : (sketchHasValues(row.sketch)
                  ? Math.round(estimateVisitorSketch(row.sketch))
                  : null),
                method: 'Browser identifier',
              },
              shortlinks: {
                unique_visitors: row.source === 'sink' && sketchHasValues(row.sketch)
                  ? Math.round(estimateVisitorSketch(row.sketch))
                  : null,
                method: 'IP estimate',
              },
            },
            visitor_method: row.source === 'sink' ? 'IP estimate' : 'Browser identifier',
          })),
        },
        meta,
      };
    }
    return {
      data: {
        detail: 'Daily summaries retain totals; this report has no raw event detail for the requested period.',
        summary,
      },
      meta,
    };
  }

  const meta = reportMeta(range, rows, trackingStartedAt, now, {
    detail: 'raw_90_day_events',
    prior_period: priorSummary,
    coverage: {
      prior_available: Boolean(priorSummary),
      prior_detail: range.priorFrom >= rawCutoff ? 'raw_90_day_events' : 'daily_rollup',
    },
  });
  switch (route) {
    case 'overview':
      return { data: buildOverview(rows, range, now, priorSummary), meta };
    case 'traffic':
      return { data: buildTraffic(rows), meta };
    case 'content':
      return { data: { content: buildContent(rows) }, meta };
    case 'engagement':
      return { data: buildEngagement(rows), meta };
    case 'conversions':
      return { data: buildConversions(rows), meta };
    case 'realtime': {
      const realtimeRows = rows.filter((row) => row.event_at >= now - ACTIVE_WINDOW_MS);
      const realtimeWebsite = websiteRows(realtimeRows);
      const realtimeShortlinks = realtimeRows.filter((row) => row.source === 'sink');
      return {
        data: {
          active_5m: visitorEstimate(realtimeWebsite) ?? distinctCount(realtimeWebsite, 'session_key'),
          shortlink_active_5m: visitorEstimate(realtimeShortlinks),
          visitor_estimates: visitorEstimates(realtimeRows),
          events: realtimeRows.slice(-100).map(safeRealtimeRow),
          as_of: new Date(now).toISOString(),
        },
        meta,
      };
    }
    default:
      return { data: {}, meta };
  }
}

export async function handleAnalyticsRequest(request, env = {}, ctx = null) {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    return errorResponse(405, 'Method Not Allowed', { allow: 'GET' });
  }

  const prefix = '/api/portfolio/';
  if (!url.pathname.startsWith(prefix)) {
    return errorResponse(404, 'Not Found');
  }
  const route = url.pathname.slice(prefix.length).replace(/\/$/, '');
  if (!REPORT_ROUTES.has(route)) {
    return errorResponse(404, 'Not Found');
  }

  const now = nowMs(env);
  if (route === 'history') {
    const db = analyticsDb(env);
    if (!db) {
      return errorResponse(503, 'Analytics database is unavailable', {
        source: 'portfolio_analytics_events',
        timezone: ANALYTICS_TIMEZONE,
        coverage: { unavailable: true },
      });
    }
    try {
      return await historyReport(db, url, now);
    } catch (error) {
      if (error?.code === 'HISTORY_QUERY_INVALID') {
        return errorResponse(error.status ?? 400, error.message, error.meta);
      }
      return errorResponse(503, 'Analytics history is unavailable', {
        source: 'portfolio_analytics_events',
        timezone: ANALYTICS_TIMEZONE,
        coverage: { unavailable: true },
      });
    }
  }

  const range = rangeFromRequest(url, now);
  if (range.error) {
    return errorResponse(400, range.error);
  }

  try {
    if (route === 'performance') {
      return jsonResponse(await reportData(route, null, range, env, now, url));
    }
    const db = analyticsDb(env);
    if (!db) {
      return errorResponse(503, 'Analytics database is unavailable', {
        source: 'portfolio_analytics',
        timezone: ANALYTICS_TIMEZONE,
        coverage: { unavailable: true },
      });
    }
    return jsonResponse(await reportData(route, db, range, env, now, url));
  } catch (error) {
    if (error?.code === 'REPORT_TOO_LARGE') {
      return errorResponse(503, 'Analytics detail exceeds the bounded report limit', {
        source: 'portfolio_analytics',
        timezone: ANALYTICS_TIMEZONE,
        coverage: {
          unavailable: true,
          reason: 'Use a narrower raw-detail range or the retained daily summaries.',
        },
      });
    }
    return errorResponse(503, 'Analytics report is unavailable', {
      source: 'portfolio_analytics',
      timezone: ANALYTICS_TIMEZONE,
      coverage: { unavailable: true },
    });
  }
}

function stableSourceId(data) {
  const campaign = normalizeCampaign(data.campaign);
  const sourceIdentity = [
    data.request_id,
    data.trace_id,
    data.delivery_id,
    data.occurred_at,
    data.timestamp,
    data.created_at,
  ].map((value) => cleanText(value, 256)).find(Boolean);
  if (!sourceIdentity) {
    return 'sink:' + randomIdentifier();
  }
  const fields = [
    data.slug ?? data.shortlink_slug,
    data.path,
    data.type ?? data.event_type,
    data.target,
    campaign ? JSON.stringify(campaign) : '',
    sourceIdentity,
  ];
  return 'sink:' + fnv1a(fields.map((value) => String(value ?? '')).join('|')).toString(16);
}

async function sinkEvent(data, env, now) {
  const slug = cleanText(data.slug ?? data.shortlink_slug, 256);
  const originalType = cleanText(data.type ?? data.event_type, 80) ?? 'shortlink_click';
  const eventType = EVENT_TYPES.has(originalType) ? originalType : 'outbound_click';
  const meta = {
    ip: cleanText(data.ip, 128),
    userAgent: cleanText(data.userAgent ?? data.user_agent, 2048),
    country: cleanText(data.country, 128),
    region: cleanText(data.region, 128),
    city: cleanText(data.city, 128),
    timezone: cleanText(data.timezone, 128),
    latitude: finiteNumber(data.latitude, -90, 90),
    longitude: finiteNumber(data.longitude, -180, 180),
    colo: cleanText(data.colo, 64),
  };
  const campaign = normalizeCampaign(data.campaign);
  const sourceEventId = cleanText(data.event_id ?? data.id, 128) ?? stableSourceId(data);
  const visitorKey = cleanText(data.visitor_key, 256) ?? await sinkVisitorKey(meta.ip, env);
  return {
    eventId: sourceEventId,
    eventType,
    sourceEventType: originalType,
    path: normalizePath(data.path ?? (slug ? '/s/' + slug : '/')),
    target: normalizeTarget(data.target ?? (slug ? '/s/' + slug : null)),
    progress: null,
    activeMs: null,
    mediaId: null,
    mediaKind: null,
    playedMs: null,
    durationMs: null,
    referrer: normalizeUrlWithoutQuery(data.referrer, 1024),
    campaign,
    shortlinkSlug: slug,
    source: 'sink',
    sourceEventId,
    eventAt: now,
    receivedAt: now,
    visitorKey,
    sessionKey: cleanText(data.session_key, 256),
    sessionStartedAt: finiteInteger(data.session_started_at, 0, now),
    ...meta,
    isBot: knownBot(meta.userAgent),
  };
}

export async function recordShortlinkEvent(data, env = {}, ctx = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { accepted: 0, deduped: 0, error: 'Shortlink event must be an object' };
  }
  const db = analyticsDb(env);
  if (!db) {
    return { accepted: 0, deduped: 0, unavailable: true };
  }

  const event = await sinkEvent(data, env, nowMs(env));
  let results;
  try {
    results = await executeBatch(db, insertStatements(db, [event]));
  } catch {
    return { accepted: 0, deduped: 0, unavailable: true };
  }
  const accepted = resultChanges(results[0]) > 0 ? 1 : 0;
  await mirrorEvents(accepted ? [event] : [], env, ctx);
  return {
    accepted,
    deduped: accepted ? 0 : 1,
    event_id: event.eventId,
    source: 'sink',
  };
}

function dailyAggregate(rows, aggregates = new Map()) {
  const add = (row, dimension, dimensionValue) => {
    const source = row.is_bot ? row.source + '_bot' : row.source;
    const day = dayKey(row.event_at);
    const key = [day, dimension, dimensionValue, source].join('\u0001');
    let bucket = aggregates.get(key);
    if (!bucket) {
      bucket = {
        day,
        dimension,
        dimensionValue,
        source,
        eventCount: 0,
        sessionKeys: new Set(),
        sessionSketch: createVisitorSketch(),
        activeMs: 0,
        sketch: createVisitorSketch(),
        firstEventAt: row.event_at,
        lastEventAt: row.event_at,
      };
      aggregates.set(key, bucket);
    }
    bucket.eventCount += 1;
    bucket.activeMs += row.active_ms ?? 0;
    bucket.firstEventAt = Math.min(bucket.firstEventAt, row.event_at);
    bucket.lastEventAt = Math.max(bucket.lastEventAt, row.event_at);
    if (row.session_key) {
      bucket.sessionKeys.add(row.session_key);
      addVisitorToSketch(bucket.sessionSketch, row.session_key);
    }
    if (row.visitor_key) {
      addVisitorToSketch(bucket.sketch, row.visitor_key);
    }
  };

  for (const row of rows) {
    add(row, 'all', 'all');
    add(row, 'event_type', row.event_type);
    add(row, 'path', row.path);
    const campaign = campaignLabel(row.campaign);
    if (campaign) {
      add(row, 'campaign', campaign);
    }
    if (row.shortlink_slug) {
      add(row, 'shortlink', row.shortlink_slug);
    }
  }
  return aggregates;
}

function dailyParams(bucket, updatedAt) {
  return [
    bucket.day,
    bucket.dimension,
    bucket.dimensionValue,
    bucket.source,
    bucket.eventCount,
    bucket.sessionKeys.size,
    encodeVisitorSketch(bucket.sessionSketch),
    bucket.activeMs,
    encodeVisitorSketch(bucket.sketch),
    bucket.firstEventAt,
    bucket.lastEventAt,
    updatedAt,
  ];
}

async function pruneAndRollup(db, now) {
  const rawCutoff = now - RAW_RETENTION_MS;
  const summaryStartMs = addMonths(now, -SUMMARY_RETENTION_MONTHS);
  const summaryCutoff = dayKey(addMonths(now, -SUMMARY_RETENTION_MONTHS));
  const rollupFrom = dayKey(rawCutoff);

  const aggregates = new Map();
  let cursorAt = summaryStartMs;
  let cursorId = '';
  while (true) {
    const result = await db.prepare([
      'SELECT event_id, event_type, path, active_ms, campaign_json, shortlink_slug,',
      '       source, event_at, session_key, visitor_key, is_bot',
      'FROM portfolio_analytics_events',
      'WHERE event_at >= ? AND event_at <= ?',
      '  AND (event_at > ? OR (event_at = ? AND event_id > ?))',
      'ORDER BY event_at ASC, event_id ASC',
      'LIMIT ' + MAINTENANCE_BATCH_SIZE,
    ].join('\n')).bind(summaryStartMs, now, cursorAt, cursorAt, cursorId).all();
    const rows = rowsFromResult(result).map(parseStoredRow);
    if (!rows.length) break;
    dailyAggregate(rows, aggregates);
    if (rows.length < MAINTENANCE_BATCH_SIZE) break;
    const last = rows.at(-1);
    cursorAt = last.event_at;
    cursorId = last.event_id;
  }

  const dailyCleanup = [
    db.prepare('DELETE FROM portfolio_analytics_daily WHERE day < ?').bind(summaryCutoff),
    db.prepare('DELETE FROM portfolio_analytics_daily WHERE day >= ?').bind(rollupFrom),
  ];
  const dailyCleanupResults = await executeBatch(db, dailyCleanup);
  const aggregateRows = [...aggregates.values()];
  const updatedAt = now;
  const insertSql = [
    'INSERT INTO portfolio_analytics_daily (',
    '  day, dimension, dimension_value, source, event_count, session_count,',
    '  session_hll, active_ms, visitor_hll, first_event_at, last_event_at, updated_at',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ].join('\n');
  for (let index = 0; index < aggregateRows.length; index += 100) {
    const statements = aggregateRows.slice(index, index + 100)
      .map((bucket) => db.prepare(insertSql).bind(...dailyParams(bucket, updatedAt)));
    await executeBatch(db, statements);
  }

  const rawCleanup = await executeBatch(db, [
    db.prepare('DELETE FROM portfolio_analytics_events WHERE event_at < ?').bind(rawCutoff),
  ]);

  await executeBatch(db, [
    db.prepare([
      'INSERT INTO portfolio_analytics_state (key, value, updated_at)',
      "VALUES ('last_rollup_at', ?, ?)",
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ].join('\n')).bind(new Date(now).toISOString(), now),
    db.prepare([
      'INSERT INTO portfolio_analytics_state (key, value, updated_at)',
      "VALUES ('last_maintenance_at', ?, ?)",
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ].join('\n')).bind(new Date(now).toISOString(), now),
  ]);

  return {
    raw_pruned: resultChanges(rawCleanup[0]),
    daily_pruned: resultChanges(dailyCleanupResults[0]) + resultChanges(dailyCleanupResults[1]),
    daily_rows: aggregateRows.length,
    rollup_from: new Date(summaryStartMs).toISOString(),
    rollup_to: new Date(now).toISOString(),
    raw_detail_cutoff: new Date(rawCutoff).toISOString(),
    summary_cutoff: summaryCutoff,
  };
}

export async function runAnalyticsMaintenance(env = {}, ctx = null) {
  const db = analyticsDb(env);
  if (!db) {
    return { unavailable: true, reason: 'Analytics database is unavailable' };
  }
  const task = pruneAndRollup(db, nowMs(env));
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(task);
    return { scheduled: true };
  }
  try {
    return await task;
  } catch {
    return { unavailable: true, reason: 'Analytics maintenance failed' };
  }
}

function legacyEvent(row, now) {
  const eventId = cleanText(row.id, 128);
  if (!eventId) {
    return null;
  }
  const timestamp = Date.parse(row.created_at);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const userAgent = cleanText(row.user_agent, 2048);
  return {
    eventId: 'legacy_page_event:' + eventId,
    eventType: 'page_view',
    sourceEventType: 'legacy_page_event',
    path: normalizePath(row.page_path),
    target: null,
    progress: null,
    activeMs: null,
    mediaId: null,
    mediaKind: null,
    playedMs: null,
    durationMs: null,
    referrer: normalizeUrlWithoutQuery(row.referrer, 1024),
    campaign: null,
    shortlinkSlug: null,
    source: 'legacy_page_event',
    sourceEventId: eventId,
    eventAt: timestamp,
    receivedAt: now,
    visitorKey: null,
    sessionKey: null,
    sessionStartedAt: null,
    ip: null,
    userAgent,
    country: null,
    region: null,
    city: null,
    timezone: null,
    latitude: null,
    longitude: null,
    colo: null,
    isBot: knownBot(userAgent),
  };
}

export async function importLegacyHistory(env = {}) {
  const destination = analyticsDb(env);
  const legacyDb = env.PORTFOLIO_DB;
  if (!destination || !legacyDb) {
    return {
      imported: 0,
      deduped: 0,
      unavailable: true,
      reason: 'Legacy or analytics database is unavailable',
    };
  }

  let rows;
  try {
    rows = rowsFromResult(await legacyDb.prepare([
      'SELECT id, page_path, referrer, user_agent, created_at',
      'FROM profile_page_events',
      'ORDER BY id ASC',
    ].join('\n')).all());
  } catch {
    return {
      imported: 0,
      deduped: 0,
      unavailable: true,
      reason: 'Legacy profile events are unavailable',
    };
  }

  const now = nowMs(env);
  const events = rows.map((row) => legacyEvent(row, now)).filter(Boolean);
  let imported = 0;
  let deduped = 0;
  for (let index = 0; index < events.length; index += 100) {
    const chunk = events.slice(index, index + 100);
    try {
      const results = await executeBatch(destination, insertStatements(destination, chunk));
      for (const result of results) {
        if (resultChanges(result) > 0) {
          imported += 1;
        } else {
          deduped += 1;
        }
      }
    } catch {
      return {
        imported,
        deduped,
        unavailable: true,
        reason: 'Legacy history import failed',
      };
    }
  }

  return {
    imported,
    deduped,
    source: 'legacy_page_event',
    identities_invented: 0,
  };
}

export {
  ANALYTICS_TIMEZONE,
  EVENT_TYPES,
  MAX_BODY_BYTES,
  MAX_EVENTS,
  RAW_RETENTION_MS,
  SESSION_IDLE_MS,
  ACTIVE_WINDOW_MS,
  dayKey,
  normalizePath,
};
