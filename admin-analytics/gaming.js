/* Gaming analytics is intentionally separate from portfolio website events.
   Browser lifecycle rows are useful for funnels and client reported games;
   authoritative EXEPERT match summaries arrive from the room service only. */

export const GAMING_EVENT_TYPES = new Set([
  'gaming_session_start',
  'gaming_session_heartbeat',
  'gaming_session_end',
  'gaming_interaction',
  'gaming_performance',
  'gaming_identity_link',
  'gaming_client_result',
]);

export const GAMING_RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// Kept as a public duration for callers that use the legacy constant. The
// maintenance cutoff below is calendar based so month length does not move
// the retention boundary.
export const GAMING_SUMMARY_RETENTION_MS = 13 * 31 * 24 * 60 * 60 * 1000;
const MAX_DETAILS_BYTES = 2_048;
const MAX_TIMELINE_ROWS = 500;
const MAX_SESSION_ROWS = 1_000;
const MAX_PLAYER_ROWS = 500;
const MAX_PARTICIPANTS = 32;
const ARCADE_GAME_ID = 'arcade';
const ARCADE_ENTRYPOINT = 'contact-arcade';
const ARCADE_LINK_MAX_AGE_MS = 30 * 60 * 1000;
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const LIFECYCLE_STATUSES = new Set(['active', 'ended', 'completed', 'abandoned', 'idle', 'reset', 'disconnected']);

const DETAIL_KEYS = new Set([
  'capture', 'captures', 'contest', 'contests', 'deploy', 'deploys',
  'loot', 'loots', 'lift', 'lifts', 'extracted', 'extracted_value',
  'bank', 'bank_total', 'tickets', 'distance', 'high_score', 'zone', 'poi',
  'layer', 'audio', 'audio_track', 'end_reason', 'outcome', 'winner',
  'fps', 'rtt_ms', 'load_ms', 'error', 'error_code', 'source',
]);

function rowsFromResult(result) {
  return Array.isArray(result) ? result : result?.results ?? [];
}

function resultChanges(result) {
  const value = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function dbFor(env = {}) {
  return env?.NEWadminD1 ?? env?.newadminDB ?? env?.ADMIN_DB ?? env?.DB ?? null;
}

function clean(value, limit = 128) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, limit) : null;
}

function id(value, limit = 96) {
  const text = clean(value, limit);
  return text && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text) ? text : null;
}

function finite(value, minimum, maximum) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : null;
}

function integer(value, minimum, maximum) {
  const number = finite(value, minimum, maximum);
  return number == null ? null : Math.trunc(number);
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function eventPath(value) {
  const text = clean(value, 512) || '/video-games/';
  try {
    const url = new URL(text, 'https://www.akmalalif.com/');
    return (url.pathname || '/').slice(0, 512);
  } catch {
    return ('/' + text.replace(/^\/+/, '').split(/[?#]/, 1)[0]).slice(0, 512);
  }
}

function safeDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = Math.round(raw * 1000) / 1000;
    else if (typeof raw === 'boolean') result[key] = raw;
    else if (Array.isArray(raw)) {
      const values = raw.slice(0, 16).filter(item => typeof item === 'number' && Number.isFinite(item)).map(item => Math.round(item * 1000) / 1000);
      if (values.length) result[key] = values;
    }
    else if (typeof raw === 'string') result[key] = clean(raw, 160);
  }
  try {
    const encoded = JSON.stringify(result);
    return encoded && new TextEncoder().encode(encoded).byteLength <= MAX_DETAILS_BYTES ? encoded : null;
  } catch {
    return null;
  }
}

function stringField(value, limit = 64) {
  const text = clean(value, limit);
  return text && /^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/.test(text) ? text : null;
}

function lifecycleStatus(value) {
  const text = stringField(value, 32);
  return text && LIFECYCLE_STATUSES.has(text) ? text : null;
}

export function isGamingEventType(value) {
  return GAMING_EVENT_TYPES.has(String(value ?? ''));
}

export function normalizeGamingEvent(value, index = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: `events[${index}] must be an object` };
  }
  const eventId = id(value.id, 128);
  if (!eventId) return { error: `events[${index}].id is invalid` };
  const eventType = clean(value.type, 64);
  if (!GAMING_EVENT_TYPES.has(eventType)) return { error: `events[${index}].type is not allowed` };
  const runId = id(value.run_id ?? value.session_id, 96);
  if (!runId) return { error: `events[${index}].run_id is required` };
  const gameId = stringField(value.game_id, 48);
  if (!gameId) return { error: `events[${index}].game_id is required` };
  const details = safeDetails(value.details);
  const correlationToken = clean(value.correlation_token, 512);
  if (correlationToken && !/^v1\.gaming\.[A-Za-z0-9._:-]+\.[A-Za-z0-9._:-]+\.[0-9]+\.[A-Fa-f0-9]{64}$/.test(correlationToken)) {
    return { error: `events[${index}].correlation_token is invalid` };
  }
  return {
    eventId,
    eventType,
    path: eventPath(value.path),
    gameId,
    runId,
    matchId: id(value.match_id, 96),
    mode: stringField(value.mode, 48),
    sector: stringField(value.sector, 48),
    transport: stringField(value.transport, 32),
    entrypoint: stringField(value.entrypoint, 96),
    status: lifecycleStatus(value.status),
    outcome: stringField(value.outcome, 64),
    reason: stringField(value.reason, 96),
    action: stringField(value.action, 64),
    zone: stringField(value.zone, 64),
    poi: stringField(value.poi, 96),
    layer: stringField(value.layer, 64),
    audioTrack: stringField(value.audio_track ?? value.audio, 96),
    durationMs: integer(value.duration_ms, 0, 7 * 24 * 60 * 60 * 1000),
    activeMs: integer(value.active_ms, 0, 7 * 24 * 60 * 60 * 1000),
    score: integer(value.score, -1_000_000_000, 1_000_000_000),
    kills: integer(value.kills, 0, 1_000_000),
    deaths: integer(value.deaths, 0, 1_000_000),
    assists: integer(value.assists, 0, 1_000_000),
    distance: finite(value.distance, 0, 1_000_000_000),
    fps: finite(value.fps, 0, 1_000),
    rttMs: finite(value.rtt_ms, 0, 60_000),
    loadMs: finite(value.load_ms, 0, 120_000),
    correlationToken,
    details,
  };
}

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, value) {
  if (!secret || !globalThis.crypto?.subtle) return null;
  const key = await globalThis.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function sameString(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function gatewaySecret(env) {
  return clean(env?.PORTFOLIO_GATEWAY_TOKEN ?? env?.PORTFOLIO_ANALYTICS_GATEWAY_TOKEN, 512);
}

export async function verifyCorrelationToken(token, env, now = Date.now()) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 6 || parts[0] !== 'v1' || parts[1] !== 'gaming') return null;
  const matchId = id(parts[2], 96);
  const participantId = id(parts[3], 48);
  const expiresAt = Number(parts[4]);
  if (!matchId || !participantId || !Number.isFinite(expiresAt) || expiresAt < now - 60_000 || expiresAt > now + 14 * 24 * 3600_000) return null;
  const expected = await hmacHex(gatewaySecret(env), `gaming-correlation-v1|${matchId}|${participantId}|${expiresAt}`);
  return expected && sameString(expected, parts[5]) ? { matchId, participantId, expiresAt } : null;
}

async function stableKey(value, env, label) {
  const secret = clean(env?.ANALYTICS_ID_SECRET, 512);
  const raw = clean(value, 512);
  if (!raw || !secret) return null;
  const signature = await hmacHex(secret, `gaming-${label}-v1|${raw}`);
  return signature ? `g_${signature.slice(0, 32)}` : null;
}

function nowMs(env = {}, supplied) {
  if (Number.isFinite(Number(supplied))) return Math.trunc(Number(supplied));
  const value = env.GAMING_NOW ?? env.ANALYTICS_NOW ?? env.__analyticsNow;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return Date.parse(value);
  return Date.now();
}

function dayKey(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

function identityKeys(identity, env) {
  return Promise.all([
    stableKey(identity?.visitorKey, env, 'player'),
    stableKey(identity?.sessionKey, env, 'session'),
  ]).then(([playerKey, sessionKey]) => ({ playerKey, sessionKey }));
}

function sessionParams(row) {
  return [
    row.id, row.playerKey, row.sessionKey, row.gameId, row.mode, row.sector, row.transport,
    row.entrypoint, row.startedAt, row.lastSeenAt, row.endedAt, row.status,
    row.durationSeconds, row.verification, row.score, row.kills, row.deaths, row.assists,
    row.detailsJson, row.matchId, row.source,
  ];
}

const SESSION_INSERT = `INSERT INTO gaming_sessions (
  id, player_key, session_key, game_id, mode, sector, transport, entrypoint,
  started_at, last_seen_at, ended_at, status, duration_seconds, verification,
  score, kills, deaths, assists, details_json, match_id, source
) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
WHERE changes() = 1
ON CONFLICT(id) DO UPDATE SET
  player_key=COALESCE(excluded.player_key, gaming_sessions.player_key),
  session_key=COALESCE(excluded.session_key, gaming_sessions.session_key),
  game_id=COALESCE(excluded.game_id, gaming_sessions.game_id),
  mode=COALESCE(excluded.mode, gaming_sessions.mode),
  sector=COALESCE(excluded.sector, gaming_sessions.sector),
  transport=COALESCE(excluded.transport, gaming_sessions.transport),
  entrypoint=COALESCE(excluded.entrypoint, gaming_sessions.entrypoint),
  last_seen_at=MAX(gaming_sessions.last_seen_at, excluded.last_seen_at),
  ended_at=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.ended_at ELSE COALESCE(excluded.ended_at, gaming_sessions.ended_at) END,
  status=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.status
    WHEN excluded.status IN ('ended', 'completed', 'abandoned', 'idle', 'reset') THEN excluded.status ELSE gaming_sessions.status END,
  duration_seconds=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.duration_seconds
    WHEN excluded.status IN ('ended', 'completed', 'abandoned', 'idle', 'reset') THEN COALESCE(excluded.duration_seconds, gaming_sessions.duration_seconds)
    WHEN excluded.duration_seconds IS NOT NULL THEN COALESCE(gaming_sessions.duration_seconds, 0) + excluded.duration_seconds
    ELSE gaming_sessions.duration_seconds END,
  verification=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.verification ELSE excluded.verification END,
  score=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.score ELSE COALESCE(excluded.score, gaming_sessions.score) END,
  kills=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.kills ELSE COALESCE(excluded.kills, gaming_sessions.kills) END,
  deaths=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.deaths ELSE COALESCE(excluded.deaths, gaming_sessions.deaths) END,
  assists=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.assists ELSE COALESCE(excluded.assists, gaming_sessions.assists) END,
  details_json=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.details_json ELSE COALESCE(excluded.details_json, gaming_sessions.details_json) END,
  match_id=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.match_id ELSE COALESCE(excluded.match_id, gaming_sessions.match_id) END,
  source=CASE WHEN gaming_sessions.verification='server_verified' THEN gaming_sessions.source ELSE COALESCE(excluded.source, gaming_sessions.source) END`;

async function scopedSessionId(runId, keys, env) {
  const owner = keys.playerKey || keys.sessionKey;
  const secret = clean(env?.ANALYTICS_ID_SECRET, 512);
  if (!owner || !secret) return runId;
  const digest = await hmacHex(secret, `gaming-session-v1|${owner}|${runId}`);
  return digest ? `s_${digest.slice(0, 48)}` : runId;
}

function rowFromGamingEvent(event, keys, now, sessionId) {
  const details = event.details ? JSON.parse(event.details) : {};
  const end = event.eventType === 'gaming_session_end' || event.eventType === 'gaming_client_result';
  const durationSeconds = event.durationMs == null
    ? (event.activeMs == null ? null : Math.round(event.activeMs / 1000))
    : Math.round(event.durationMs / 1000);
  return {
    id: sessionId,
    playerKey: keys.playerKey,
    sessionKey: keys.sessionKey,
    gameId: event.gameId,
    mode: event.mode,
    sector: event.sector,
    transport: event.transport || 'browser',
    entrypoint: event.entrypoint,
    startedAt: now,
    lastSeenAt: now,
    endedAt: end ? now : null,
    status: event.status || (end ? 'ended' : 'active'),
    durationSeconds,
    verification: 'client_reported',
    score: event.score,
    kills: event.kills,
    deaths: event.deaths,
    assists: event.assists,
    detailsJson: event.details || (Object.keys(details).length ? JSON.stringify(details) : null),
    matchId: event.matchId,
    source: 'browser',
  };
}

function timelineParams(event, keys, now, tokenDigest = null, sessionId = event.runId) {
  return [
    event.eventId, sessionId, event.matchId, keys.playerKey, event.eventType, now,
    event.gameId, event.mode, event.sector, event.action || event.outcome || event.reason,
    event.zone || event.poi || event.layer || event.audioTrack,
    event.durationMs, event.activeMs, event.score, event.kills, event.deaths, event.assists,
    event.distance, event.fps, event.rttMs, event.loadMs, event.details, tokenDigest,
  ];
}

async function tokenDigest(token, env) {
  const secret = clean(env?.ANALYTICS_ID_SECRET, 512);
  const digest = await hmacHex(secret, `gaming-token-v1|${token}`);
  return digest ? `t_${digest.slice(0, 40)}` : null;
}

async function executeBatch(db, statements) {
  if (!statements.length) return [];
  if (typeof db.batch === 'function') return db.batch(statements);
  const results = [];
  for (const statement of statements) results.push(await statement.run());
  return results;
}

export async function ingestGamingEvents(events, env = {}, identity = {}, now = Date.now()) {
  const db = dbFor(env);
  if (!db || !events?.length) return { accepted: 0, deduped: 0, unavailable: !db };
  const keys = await identityKeys(identity, env);
  const statements = [];
  const acceptedCandidates = [];
  const timelineIndexes = [];
  const seenEventIds = new Set();
  let skipped = 0;
  for (const event of events.slice(0, 20)) {
    if (!GAMING_EVENT_TYPES.has(event.eventType)) continue;
    if (seenEventIds.has(event.eventId)) { skipped += 1; continue; }
    seenEventIds.add(event.eventId);
    const tokenInfo = event.eventType === 'gaming_identity_link'
      ? await verifyCorrelationToken(event.correlationToken, env, now)
      : null;
    if (event.eventType === 'gaming_identity_link' && !tokenInfo) { skipped += 1; continue; }
    const digest = event.correlationToken ? await tokenDigest(event.correlationToken, env) : null;
    const sessionId = await scopedSessionId(event.runId, keys, env);
    if (!tokenInfo) event.matchId = null;
    const session = rowFromGamingEvent(event, keys, now, sessionId);
    if (tokenInfo) {
      session.matchId = tokenInfo.matchId;
      event.matchId = tokenInfo.matchId;
    }
    // Insert the timeline row first. The NOT EXISTS gate and the unique event
    // key are the atomic claim for this retry; the following session and
    // identity mutations are all gated by SQLite changes() in this batch.
    statements.push(db.prepare(`INSERT OR IGNORE INTO gaming_events (
      event_id, session_id, match_id, player_key, event_type, event_at, game_id, mode, sector,
      action, subject, duration_ms, active_ms, score, kills, deaths, assists, distance,
      fps, rtt_ms, load_ms, details_json, correlation_digest
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM gaming_events WHERE event_id = ?)`)
      .bind(...timelineParams(event, keys, now, digest, sessionId), event.eventId));
    timelineIndexes.push(statements.length - 1);
    statements.push(db.prepare(SESSION_INSERT).bind(...sessionParams(session)));
    acceptedCandidates.push(event);
    if (tokenInfo) {
      statements.push(db.prepare(`UPDATE gaming_participants
        SET player_key=COALESCE(player_key, ?), linked_session_id=COALESCE(linked_session_id, ?)
        WHERE changes() = 1 AND match_id=? AND participant_key=?`).bind(keys.playerKey, sessionId, tokenInfo.matchId, digest));
      // A Room summary may arrive before the browser's identity link. When
      // the order is reversed, promote that linked session from the already
      // stored authoritative participant without accepting browser stats.
      statements.push(db.prepare(`UPDATE gaming_sessions SET
        verification='server_verified', match_id=?,
        source='exepert-room',
        score=(SELECT score FROM gaming_participants WHERE match_id=? AND participant_key=?),
        kills=(SELECT kills FROM gaming_participants WHERE match_id=? AND participant_key=?),
        deaths=(SELECT deaths FROM gaming_participants WHERE match_id=? AND participant_key=?),
        assists=(SELECT assists FROM gaming_participants WHERE match_id=? AND participant_key=?),
        status=CASE WHEN status IN ('active', 'ended', 'completed', 'abandoned', 'disconnected', 'idle', 'reset')
          THEN (SELECT status FROM gaming_matches WHERE id=?) ELSE status END
        WHERE id IN (SELECT linked_session_id FROM gaming_participants
          WHERE match_id=? AND participant_key=? AND linked_session_id IS NOT NULL)
          AND changes() = 1
          AND EXISTS (SELECT 1 FROM gaming_matches WHERE id=? AND verification='server_verified')`)
        .bind(tokenInfo.matchId,
          tokenInfo.matchId, digest, tokenInfo.matchId, digest, tokenInfo.matchId, digest,
          tokenInfo.matchId, digest, tokenInfo.matchId, tokenInfo.matchId, digest, tokenInfo.matchId));
    }
  }
  if (!statements.length) return { accepted: 0, deduped: skipped };
  let results;
  try { results = await executeBatch(db, statements); } catch { return { accepted: 0, deduped: 0, unavailable: true }; }
  let accepted = 0;
  // Every event emits one gated timeline claim and one gated session upsert.
  for (let index = 0; index < acceptedCandidates.length; index += 1) {
    if (resultChanges(results[timelineIndexes[index]]) > 0) accepted += 1;
  }
  if (accepted > 0) await noteTrackingStarted(db, now, now);
  return { accepted, deduped: skipped + acceptedCandidates.length - accepted };
}

function authoritativeStatus(value) {
  return ['active', 'completed', 'abandoned', 'disconnected', 'idle', 'reset'].includes(value) ? value : 'completed';
}

function matchId(value) {
  return id(value, 96);
}

function summaryDetails(value) {
  return safeDetails(value) || '{}';
}

export async function ingestGamingSummary(summary, env = {}, now = Date.now()) {
  const db = dbFor(env);
  if (!db || !summary || typeof summary !== 'object' || summary.source !== 'exepert-room') {
    return { accepted: 0, unavailable: !db, error: 'Authoritative gaming source required' };
  }
  const mid = matchId(summary.match_id);
  const gameId = stringField(summary.game_id || 'exepert', 48);
  if (!mid || !gameId) return { accepted: 0, error: 'Invalid authoritative match summary' };
  const startedAt = Number.isFinite(Number(summary.started_at)) ? Number(summary.started_at) : now;
  const endedAt = Number.isFinite(Number(summary.ended_at)) ? Number(summary.ended_at) : now;
  const result = summary.result && typeof summary.result === 'object' ? summary.result : {};
  const participants = Array.isArray(summary.participants) ? summary.participants.slice(0, MAX_PARTICIPANTS) : [];
  let existingMatch = null;
  try {
    existingMatch = await db.prepare('SELECT status FROM gaming_matches WHERE id = ? LIMIT 1').bind(mid).first();
  } catch {
    return { accepted: 0, unavailable: true, error: 'Gaming summary read failed' };
  }
  const matchDetails = summaryDetails({
    winner: integer(result.winner, -1, 1_000_000),
    reason: stringField(result.reason, 96),
    bank: result.bank,
    tickets: result.tickets,
    captures: result.captures,
    contests: result.contests,
    deploys: result.deploys,
    loots: result.loots,
    lifts: result.lifts,
    extracted: result.extracted,
    extracted_value: result.extracted_value,
  });
  const matchStatement = db.prepare(`INSERT INTO gaming_matches (
    id, game_id, mode, sector, transport, started_at, last_seen_at, ended_at, status,
    verification, participant_count, human_count, bot_count, result_json, source
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'server_verified', ?, ?, ?, ?, 'exepert-room')
  ON CONFLICT(id) DO UPDATE SET
    last_seen_at=MAX(gaming_matches.last_seen_at, excluded.last_seen_at),
    ended_at=COALESCE(excluded.ended_at, gaming_matches.ended_at),
    status=excluded.status, participant_count=excluded.participant_count,
    human_count=excluded.human_count, bot_count=excluded.bot_count,
    result_json=excluded.result_json`)
    .bind(mid, gameId, stringField(summary.mode, 48), stringField(summary.sector, 48), 'websocket', startedAt,
      now, endedAt, authoritativeStatus(summary.status), participants.length,
      participants.filter(p => !p?.bot).length, participants.filter(p => p?.bot).length, matchDetails);
  const statements = [matchStatement];
  for (const participant of participants) {
    const participantId = id(participant?.participant_id, 48);
    if (!participantId) continue;
    const token = clean(participant?.correlation_token, 512);
    const tokenInfo = token ? await verifyCorrelationToken(token, env, now) : null;
    if (tokenInfo && tokenInfo.matchId !== mid) continue;
    const digest = token ? await tokenDigest(token, env) : null;
    statements.push(db.prepare(`INSERT INTO gaming_participants (
      id, match_id, participant_key, player_key, linked_session_id, bot, kills, deaths,
      assists, score, details_json, started_at, ended_at
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET bot=excluded.bot, kills=excluded.kills, deaths=excluded.deaths,
      assists=excluded.assists, score=excluded.score, details_json=excluded.details_json,
      ended_at=excluded.ended_at, participant_key=COALESCE(excluded.participant_key, gaming_participants.participant_key)`)
      .bind(`${mid}:${participantId}`, mid, digest, bool(participant?.bot), integer(participant?.kills, 0, 1_000_000),
        integer(participant?.deaths, 0, 1_000_000), integer(participant?.assists, 0, 1_000_000),
        integer(participant?.score, -1_000_000_000, 1_000_000_000), summaryDetails(participant?.details), startedAt, endedAt));
    if (tokenInfo && digest) {
      // The browser can link before the room summary exists. Resolve that
      // earlier link after inserting the authoritative participant, then copy
      // only the Room-owned result into the linked session.
      statements.push(db.prepare(`UPDATE gaming_participants
        SET player_key=COALESCE(player_key, (SELECT player_key FROM gaming_events
          WHERE event_type='gaming_identity_link' AND correlation_digest=? AND player_key IS NOT NULL
          ORDER BY event_at DESC LIMIT 1)),
            linked_session_id=COALESCE(linked_session_id, (SELECT session_id FROM gaming_events
          WHERE event_type='gaming_identity_link' AND correlation_digest=? ORDER BY event_at DESC LIMIT 1))
        WHERE match_id=? AND participant_key=?`).bind(digest, digest, mid, digest));
      statements.push(db.prepare(`UPDATE gaming_sessions SET
        verification='server_verified', match_id=?, source='exepert-room', score=?, kills=?, deaths=?, assists=?,
        status=CASE WHEN status IN ('active', 'ended', 'completed', 'disconnected', 'idle') THEN ? ELSE status END
        WHERE id IN (SELECT linked_session_id FROM gaming_participants WHERE match_id=? AND participant_key=?)`)
        .bind(mid, integer(participant?.score, -1_000_000_000, 1_000_000_000), integer(participant?.kills, 0, 1_000_000),
          integer(participant?.deaths, 0, 1_000_000), integer(participant?.assists, 0, 1_000_000), authoritativeStatus(summary.status), mid, digest));
    }
  }
  try {
    await executeBatch(db, statements);
    await noteTrackingStarted(db, startedAt, now);
    const nextStatus = authoritativeStatus(summary.status);
    const accepted = existingMatch == null || existingMatch.status !== nextStatus ? 1 : 0;
    return { accepted, deduped: accepted ? 0 : 1, match_id: mid, participants: participants.length };
  } catch {
    return { accepted: 0, unavailable: true, error: 'Gaming summary write failed' };
  }
}

function iso(value) {
  if (value == null || value === '') return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function playerLabel(key) {
  return key ? `PLAYER-${String(key).replace(/^g_/, '').slice(0, 8).toUpperCase()}` : null;
}

function sessionResponse(row) {
  const start = Number(row.started_at) || 0;
  const end = Number(row.ended_at || row.last_seen_at) || start;
  return {
    id: row.id,
    gameId: row.game_id,
    playerId: row.player_key || null,
    playerLabel: playerLabel(row.player_key),
    mode: row.mode || null,
    sector: row.sector || null,
    transport: row.transport || 'browser',
    entrypoint: row.entrypoint || null,
    startedAt: iso(start),
    lastSeenAt: iso(row.last_seen_at || start),
    endedAt: iso(row.ended_at),
    status: row.status || 'active',
    durationSeconds: Number(row.duration_seconds ?? Math.max(0, end - start) / 1000),
    verification: row.verification === 'server_verified' ? 'server_verified' : 'client_reported',
    score: row.score == null ? null : Number(row.score),
    kills: row.kills == null ? null : Number(row.kills),
    deaths: row.deaths == null ? null : Number(row.deaths),
    assists: row.assists == null ? null : Number(row.assists),
    details: row.details_json ? JSON.parse(row.details_json) : undefined,
  };
}

function metric(key, label, value, unit = 'count', detail) {
  return { key, label, value: value == null ? null : Number(value), unit, ...(detail ? { detail } : {}) };
}

function sessionCursor(value) {
  const text = clean(value, 192);
  if (!text) return null;
  const separator = text.indexOf(':');
  if (separator < 1) return null;
  const timestamp = Number(text.slice(0, separator));
  try {
    const sessionId = id(decodeURIComponent(text.slice(separator + 1)), 96);
    return Number.isFinite(timestamp) && sessionId ? { timestamp, sessionId } : null;
  } catch {
    return null;
  }
}

function nextSessionCursor(row) {
  return row?.started_at == null || !row?.id ? null : `${Number(row.started_at)}:${encodeURIComponent(row.id)}`;
}

function numeric(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? 0 : Number(value);
}

const GAMING_TRACKING_STATE_KEY = 'tracking_started_at';

function emptyDailySummary() {
  return {
    abandoned: 0,
    active: 0,
    serverVerified: 0,
    eventCount: 0,
    scoreTotal: 0,
    distance: 0,
    disconnects: 0,
    renderFailures: 0,
    fpsSum: 0,
    fpsCount: 0,
    rttSum: 0,
    rttCount: 0,
    loadSum: 0,
    loadCount: 0,
    arcadeLaunches: 0,
    arcadeLinkedChildStarts: 0,
    arcadeUnlinkedChildStarts: 0,
    endReasons: {},
    interactions: {},
    authoritative: {
      matches: 0,
      completed: 0,
      participants: 0,
      humans: 0,
      bots: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      captures: 0,
      contests: 0,
      deploys: 0,
      loots: 0,
      lifts: 0,
      extracted: 0,
      extracted_value: 0,
      humanKills: 0,
      humanDeaths: 0,
      humanAssists: 0,
      botKills: 0,
      botDeaths: 0,
      botAssists: 0,
    },
  };
}

function parseDailySummary(value) {
  const summary = emptyDailySummary();
  if (!value) return summary;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return summary;
    for (const key of ['abandoned', 'active', 'serverVerified', 'eventCount', 'scoreTotal', 'distance', 'disconnects', 'renderFailures', 'fpsSum', 'fpsCount', 'rttSum', 'rttCount', 'loadSum', 'loadCount', 'arcadeLaunches', 'arcadeLinkedChildStarts', 'arcadeUnlinkedChildStarts']) {
      summary[key] = numeric(parsed[key]);
    }
    for (const key of ['endReasons', 'interactions']) {
      if (parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])) {
        for (const [label, count] of Object.entries(parsed[key])) {
          if (label) summary[key][label] = numeric(count);
        }
      }
    }
    if (parsed.authoritative && typeof parsed.authoritative === 'object') {
      for (const key of Object.keys(summary.authoritative)) {
        summary.authoritative[key] = numeric(parsed.authoritative[key]);
      }
    }
  } catch {
    return summary;
  }
  return summary;
}

function mergeDailySummary(target, source) {
  for (const key of ['abandoned', 'active', 'serverVerified', 'eventCount', 'scoreTotal', 'distance', 'disconnects', 'renderFailures', 'fpsSum', 'fpsCount', 'rttSum', 'rttCount', 'loadSum', 'loadCount', 'arcadeLaunches', 'arcadeLinkedChildStarts', 'arcadeUnlinkedChildStarts']) {
    target[key] = numeric(target[key]) + numeric(source[key]);
  }
  for (const key of ['endReasons', 'interactions']) {
    for (const [label, count] of Object.entries(source[key] || {})) {
      target[key][label] = numeric(target[key][label]) + numeric(count);
    }
  }
  for (const key of Object.keys(target.authoritative)) {
    target.authoritative[key] = numeric(target.authoritative[key]) + numeric(source.authoritative?.[key]);
  }
  return target;
}

function dailyDimensionKey(row) {
  return [row.day, row.game_id, row.mode || '', row.sector || '', row.transport || ''].join('\u001f');
}

function summaryDateFromDay(day) {
  const value = clean(day, 16);
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function calendarMonthsAgo(timestamp, months) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

async function noteTrackingStarted(db, timestamp, updatedAt = timestamp) {
  if (!db || !Number.isFinite(Number(timestamp))) return;
  try {
    await db.prepare(`INSERT INTO gaming_state (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=CASE WHEN CAST(gaming_state.value AS INTEGER) <= CAST(excluded.value AS INTEGER)
          THEN gaming_state.value ELSE excluded.value END,
        updated_at=excluded.updated_at`)
      .bind(GAMING_TRACKING_STATE_KEY, String(Math.trunc(Number(timestamp))), Math.trunc(Number(updatedAt))).run();
  } catch {
    // Older installations can be upgraded before the state table exists.
  }
}

async function trackingStarted(db) {
  try {
    const row = await db.prepare('SELECT value FROM gaming_state WHERE key = ? LIMIT 1').bind(GAMING_TRACKING_STATE_KEY).first();
    if (row?.value == null || row.value === '') return null;
    const timestamp = Number(row?.value);
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function emptyBreakdownExtra() {
  return { distance: 0, disconnects: 0, renderFailures: 0, endReasons: {}, interactions: {} };
}

function addBreakdownEvent(target, row) {
  const amount = Number.isFinite(Number(row.distance)) ? Number(row.distance) : 0;
  target.distance += amount;
  const action = clean(row.action, 96);
  const subject = clean(row.subject, 96);
  const interaction = [action, subject].filter(Boolean).join(':');
  if (row.event_type === 'gaming_interaction' && interaction) boundedMapIncrement(target.interactions, interaction);
  if (row.event_type === 'gaming_session_end' || row.event_type === 'gaming_client_result') {
    if (action) boundedMapIncrement(target.endReasons, action);
    if (action && /disconnect/i.test(action)) target.disconnects += 1;
  }
  if ((action && /render.*fail|fail.*render/i.test(action)) || (subject && /render.*fail|fail.*render/i.test(subject))) target.renderFailures += 1;
}

function mergeBreakdownExtra(target, source) {
  target.endReasons ||= {};
  target.interactions ||= {};
  target.distance = numeric(target.distance) + numeric(source.distance);
  target.disconnects = numeric(target.disconnects) + numeric(source.disconnects);
  target.renderFailures = numeric(target.renderFailures) + numeric(source.renderFailures);
  for (const key of ['endReasons', 'interactions']) {
    for (const [label, count] of Object.entries(source[key] || {})) target[key][label] = numeric(target[key][label]) + numeric(count);
  }
}

function arcadeParentPredicate(alias) {
  return `${alias}.game_id = '${ARCADE_GAME_ID}' AND ${alias}.entrypoint = '${ARCADE_ENTRYPOINT}'`;
}

function arcadeChildPredicate(alias) {
  return `${alias}.game_id <> '${ARCADE_GAME_ID}' AND ${alias}.entrypoint = '${ARCADE_ENTRYPOINT}'`;
}

function arcadeLinkedChildPredicate(childAlias = 'c') {
  return `${childAlias}.player_key IS NOT NULL AND ${childAlias}.session_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM gaming_sessions a
    WHERE ${arcadeParentPredicate('a')}
      AND a.player_key = ${childAlias}.player_key
      AND a.session_key = ${childAlias}.session_key
      AND ${childAlias}.started_at >= a.started_at
      AND ${childAlias}.started_at - a.started_at <= ${ARCADE_LINK_MAX_AGE_MS}
      AND NOT EXISTS (
        SELECT 1 FROM gaming_sessions newer
        WHERE ${arcadeParentPredicate('newer')}
          AND newer.player_key = a.player_key
          AND newer.session_key = a.session_key
          AND newer.started_at > a.started_at
          AND newer.started_at <= ${childAlias}.started_at
      )
  )`;
}

function addArcadeDimensionFilters(clauses, binds, alias, options = {}) {
  if (options.mode) {
    clauses.push(`${alias}.mode = ?`);
    binds.push(options.mode);
  }
  if (options.transport) {
    clauses.push(`${alias}.transport = ?`);
    binds.push(options.transport);
  }
}

async function readArcadeFunnel(db, from, now, options, dailyAggregate) {
  const result = {
    launches: numeric(dailyAggregate.arcadeLaunches),
    linkedChildStarts: numeric(dailyAggregate.arcadeLinkedChildStarts),
    unlinkedChildStarts: numeric(dailyAggregate.arcadeUnlinkedChildStarts),
  };
  if (!options.game || options.game === ARCADE_GAME_ID) {
    const launchClauses = [`a.started_at >= ? AND a.started_at <= ?`, arcadeParentPredicate('a')];
    const launchBinds = [from, now];
    addArcadeDimensionFilters(launchClauses, launchBinds, 'a', options);
    const launchRow = await db.prepare(`SELECT COUNT(*) AS count
      FROM gaming_sessions a WHERE ${launchClauses.join(' AND ')}`).bind(...launchBinds).first();
    result.launches += numeric(launchRow?.count);
  }
  if (!options.game || options.game !== ARCADE_GAME_ID) {
    const childClauses = [`c.started_at >= ? AND c.started_at <= ?`, arcadeChildPredicate('c')];
    const childBinds = [from, now];
    if (options.game) {
      childClauses.push('c.game_id = ?');
      childBinds.push(options.game);
    }
    addArcadeDimensionFilters(childClauses, childBinds, 'c', options);
    const childRow = await db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${arcadeLinkedChildPredicate('c')} THEN 1 ELSE 0 END) AS linked
      FROM gaming_sessions c WHERE ${childClauses.join(' AND ')}`).bind(...childBinds).first();
    const total = numeric(childRow?.total);
    result.linkedChildStarts += numeric(childRow?.linked);
    result.unlinkedChildStarts += Math.max(0, total - numeric(childRow?.linked));
  }
  return result;
}

export async function readGamingData(env = {}, options = {}) {
  const db = dbFor(env);
  if (!db) return { unavailable: true, reason: 'Gaming database is unavailable' };
  const now = nowMs(env, options.now);
  const requestedRange = Number(options.rangeDays);
  const rangeDays = [7, 30, 90, 365, 396].includes(requestedRange) ? requestedRange : 30;
  const from = now - rangeDays * 24 * 60 * 60 * 1000;
  const game = stringField(options.game, 48);
  const mode = stringField(options.mode, 48);
  const transport = stringField(options.transport, 32);
  try {
    const rawCutoff = now - GAMING_RAW_RETENTION_MS;
    const detailBoundaryDay = dayKey(rawCutoff);
    const detailBoundaryStart = summaryDateFromDay(detailBoundaryDay) ?? rawCutoff;
    const detailFrom = from < rawCutoff ? Math.max(from, detailBoundaryStart) : from;
    const baseClauses = ['started_at >= ? AND started_at <= ?'];
    const baseBinds = [detailFrom, now];
    if (game) { baseClauses.push('game_id = ?'); baseBinds.push(game); }
    if (mode) { baseClauses.push('mode = ?'); baseBinds.push(mode); }
    if (transport) { baseClauses.push('transport = ?'); baseBinds.push(transport); }
    const baseWhere = baseClauses.join(' AND ');
    const realBaseClauses = [...baseClauses, 'game_id <> ?'];
    const realBaseBinds = [...baseBinds, ARCADE_GAME_ID];
    const realBaseWhere = realBaseClauses.join(' AND ');
    const dailyClauses = ['day >= ? AND day <= ?'];
    const dailyBinds = [dayKey(from), dayKey(now)];
    if (game) { dailyClauses.push('game_id = ?'); dailyBinds.push(game); }
    if (mode) { dailyClauses.push('mode = ?'); dailyBinds.push(mode); }
    if (transport) { dailyClauses.push('transport = ?'); dailyBinds.push(transport); }
    const dailyRows = from < rawCutoff
      ? rowsFromResult(await db.prepare(`SELECT * FROM gaming_daily WHERE ${dailyClauses.join(' AND ')} ORDER BY day ASC`).bind(...dailyBinds).all())
      : [];
    // Expired daily rows preserve aggregate history after raw detail retention.
    // Their per-day player counts cannot be deduplicated across days, so any
    // report that uses them must mark unique-player totals as unavailable.
    const historicalAggregates = dailyRows.some(row => row.day && row.day < detailBoundaryDay);
    const dailyAggregate = { starts: 0, players: 0, completions: 0, playSeconds: 0, abandoned: 0, active: 0, serverVerified: 0, eventCount: 0, scoreTotal: 0, distance: 0, disconnects: 0, renderFailures: 0, fpsSum: 0, fpsCount: 0, rttSum: 0, rttCount: 0, loadSum: 0, loadCount: 0, arcadeLaunches: 0, arcadeLinkedChildStarts: 0, arcadeUnlinkedChildStarts: 0, endReasons: {}, interactions: {}, authoritative: emptyDailySummary().authoritative };
    const dailyBreakdowns = new Map();
    const dailySectors = new Map();
    const dailyByDate = new Map();
    for (const row of dailyRows) {
      // Rows covering the current raw detail window are intentionally left to
      // the live tables; the daily table is only the expired-history source.
      if (!row.day || row.day >= detailBoundaryDay) continue;
      const summary = parseDailySummary(row.summary_json);
      const arcadeLaunchRow = row.game_id === ARCADE_GAME_ID;
      if (!arcadeLaunchRow) {
        dailyAggregate.starts += numeric(row.starts);
        dailyAggregate.players += numeric(row.players);
        dailyAggregate.completions += numeric(row.completions);
        dailyAggregate.playSeconds += numeric(row.play_seconds);
      }
      mergeDailySummary(dailyAggregate, summary);
      if (arcadeLaunchRow) continue;
      const breakdownKey = `${row.game_id}\u001f${row.mode || ''}`;
      const breakdown = dailyBreakdowns.get(breakdownKey) || { gameId: row.game_id, modeId: row.mode || null, sector: row.sector || null, id: row.mode || row.game_id, label: row.mode || row.game_id, starts: 0, players: 0, completions: 0, playSeconds: 0, score: 0, distance: 0, disconnects: 0, renderFailures: 0, endReasons: {}, interactions: {}, authoritative: emptyDailySummary().authoritative };
      breakdown.starts += numeric(row.starts); breakdown.players += numeric(row.players); breakdown.completions += numeric(row.completions); breakdown.playSeconds += numeric(row.play_seconds);
      breakdown.score += numeric(summary.scoreTotal); breakdown.distance += numeric(summary.distance); breakdown.disconnects += numeric(summary.disconnects); breakdown.renderFailures += numeric(summary.renderFailures);
      for (const key of Object.keys(breakdown.authoritative)) breakdown.authoritative[key] += numeric(summary.authoritative[key]);
      for (const [label, count] of Object.entries(summary.endReasons)) breakdown.endReasons[label] = numeric(breakdown.endReasons[label]) + numeric(count);
      for (const [label, count] of Object.entries(summary.interactions)) breakdown.interactions[label] = numeric(breakdown.interactions[label]) + numeric(count);
      dailyBreakdowns.set(breakdownKey, breakdown);
      if (row.sector) {
        const sectorKey = `${row.game_id}\u001f${row.sector}`;
        const sector = dailySectors.get(sectorKey) || { id: row.sector, label: row.sector, starts: 0, players: 0, completions: 0, play_seconds: 0, score: 0, ...emptyBreakdownExtra() };
        sector.starts += numeric(row.starts); sector.players += numeric(row.players); sector.completions += numeric(row.completions); sector.play_seconds += numeric(row.play_seconds); sector.score += numeric(summary.scoreTotal);
        mergeBreakdownExtra(sector, summary);
        dailySectors.set(sectorKey, sector);
      }
      const day = dailyByDate.get(row.day) || { date: row.day, starts: 0, players: 0, completions: 0, playSeconds: 0 };
      day.starts += numeric(row.starts); day.players += numeric(row.players); day.completions += numeric(row.completions); day.playSeconds += numeric(row.play_seconds);
      dailyByDate.set(row.day, day);
    }
    const cursor = sessionCursor(options.cursor);
    const pageClauses = [...baseClauses];
    const pageBinds = [...baseBinds];
    if (cursor) {
      pageClauses.push('(started_at < ? OR (started_at = ? AND id < ?))');
      pageBinds.push(cursor.timestamp, cursor.timestamp, cursor.sessionId);
    }
    const pageRows = rowsFromResult(await db.prepare(`SELECT * FROM gaming_sessions WHERE ${pageClauses.join(' AND ')} ORDER BY started_at DESC, id DESC LIMIT ${MAX_SESSION_ROWS + 1}`).bind(...pageBinds).all());
    const hasMore = pageRows.length > MAX_SESSION_ROWS;
    if (hasMore) pageRows.pop();
    const sessions = pageRows.map(sessionResponse);
    const nextCursor = hasMore ? nextSessionCursor(pageRows.at(-1)) : null;
    if (options.sessionsOnly) {
      return { from, to: now, sessions, nextCursor, players: [], games: [], modes: [], daily: [], funnel: [], eventCount: 0, performance: { fps: null, rttMs: null, loadMs: null }, aggregate: {}, authoritative: {}, historicalAggregates: false, trackingStartedAt: null };
    }

    const aggregate = await db.prepare(`SELECT COUNT(*) AS starts,
      COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      SUM(CASE WHEN status='abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN status IN ('active', 'disconnected', 'idle') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN verification='server_verified' THEN 1 ELSE 0 END) AS server_verified,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds
      FROM gaming_sessions WHERE ${realBaseWhere}`).bind(...realBaseBinds).first() || {};
    const activePlayers = await db.prepare(`SELECT COUNT(DISTINCT player_key) AS count
      FROM gaming_sessions
      WHERE ${realBaseWhere}
        AND player_key IS NOT NULL
        AND status = 'active'
        AND last_seen_at >= ?
        AND last_seen_at <= ?`).bind(...realBaseBinds, now - 90_000, now).first() || {};
    aggregate.starts = numeric(aggregate.starts) + dailyAggregate.starts;
    aggregate.players = numeric(aggregate.players) + dailyAggregate.players;
    aggregate.completions = numeric(aggregate.completions) + dailyAggregate.completions;
    aggregate.abandoned = numeric(aggregate.abandoned) + dailyAggregate.abandoned;
    aggregate.active = numeric(aggregate.active) + dailyAggregate.active;
    aggregate.server_verified = numeric(aggregate.server_verified) + dailyAggregate.serverVerified;
    aggregate.play_seconds = numeric(aggregate.play_seconds) + dailyAggregate.playSeconds;
    const returning = await db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT player_key FROM gaming_sessions WHERE ${realBaseWhere} AND player_key IS NOT NULL
      GROUP BY player_key HAVING COUNT(*) > 1
    )`).bind(...realBaseBinds).first() || {};
    const firstSession = await db.prepare('SELECT MIN(started_at) AS started_at FROM gaming_sessions').first() || {};
    const games = rowsFromResult(await db.prepare(`SELECT game_id AS id, game_id AS label,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, SUM(score) AS score,
      SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnects
      FROM gaming_sessions WHERE ${realBaseWhere} GROUP BY game_id ORDER BY starts DESC`).bind(...realBaseBinds).all());
    const modes = rowsFromResult(await db.prepare(`SELECT mode AS id, mode AS label,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, SUM(score) AS score,
      SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnects
      FROM gaming_sessions WHERE ${realBaseWhere} AND mode IS NOT NULL GROUP BY mode ORDER BY starts DESC`).bind(...realBaseBinds).all());
    const daily = rowsFromResult(await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS date,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds
      FROM gaming_sessions WHERE ${realBaseWhere} GROUP BY date ORDER BY date ASC`).bind(...realBaseBinds).all());
    for (const row of dailyBreakdowns.values()) {
      const existing = games.find(item => item.id === row.gameId);
      if (existing) {
        existing.starts = numeric(existing.starts) + row.starts;
        existing.players = numeric(existing.players) + row.players;
        existing.completions = numeric(existing.completions) + row.completions;
        existing.play_seconds = numeric(existing.play_seconds) + row.playSeconds;
        existing.score = numeric(existing.score) + row.score;
      } else {
        games.push({ id: row.gameId, label: row.gameId, starts: row.starts, players: row.players, completions: row.completions, play_seconds: row.playSeconds, score: row.score });
      }
    }
    for (const row of dailyBreakdowns.values()) {
      if (!row.modeId) continue;
      const existing = modes.find(item => item.id === row.modeId);
      if (existing) {
        existing.starts = numeric(existing.starts) + row.starts;
        existing.players = numeric(existing.players) + row.players;
        existing.completions = numeric(existing.completions) + row.completions;
        existing.play_seconds = numeric(existing.play_seconds) + row.playSeconds;
        existing.score = numeric(existing.score) + row.score;
      } else {
        modes.push({ id: row.modeId, label: row.modeId, starts: row.starts, players: row.players, completions: row.completions, play_seconds: row.playSeconds, score: row.score });
      }
    }
    for (const row of dailyRows) {
      if (!row.day || row.day >= detailBoundaryDay) continue;
      if (row.game_id === ARCADE_GAME_ID) continue;
      // A daily row can be emitted for a sector/mode dimension even when a
      // session detail row has expired; merge it into the date series once.
      if (!dailyByDate.has(row.day)) dailyByDate.set(row.day, { date: row.day, starts: 0, players: 0, completions: 0, playSeconds: 0 });
    }
    for (const row of daily) {
      const existing = dailyByDate.get(row.date) || { date: row.date, starts: 0, players: 0, completions: 0, playSeconds: 0 };
      existing.starts += numeric(row.starts); existing.players += numeric(row.players); existing.completions += numeric(row.completions); existing.playSeconds += numeric(row.play_seconds);
      dailyByDate.set(row.date, existing);
    }
    const dailySeries = [...dailyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const players = rowsFromResult(await db.prepare(`SELECT player_key, COUNT(*) AS sessions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, MIN(started_at) AS first_seen_at,
      MAX(last_seen_at) AS last_seen_at
      FROM gaming_sessions WHERE ${realBaseWhere} AND player_key IS NOT NULL
      GROUP BY player_key ORDER BY last_seen_at DESC LIMIT ${MAX_PLAYER_ROWS}`).bind(...realBaseBinds).all());
    const eventClauses = ['e.event_at >= ? AND e.event_at <= ?'];
    const eventBinds = [from, now];
    if (game) { eventClauses.push('e.game_id = ?'); eventBinds.push(game); }
    if (mode) { eventClauses.push('e.mode = ?'); eventBinds.push(mode); }
    if (transport) { eventClauses.push('s.transport = ?'); eventBinds.push(transport); }
    const eventWhere = eventClauses.join(' AND ');
    const eventJoin = transport ? ' JOIN gaming_sessions s ON s.id = e.session_id' : '';
    const eventCount = numeric((await db.prepare(`SELECT COUNT(*) AS count FROM gaming_events e${eventJoin} WHERE ${eventWhere}`).bind(...eventBinds).first())?.count) + dailyAggregate.eventCount;
    const performance = rowsFromResult(await db.prepare(`SELECT SUM(e.fps) AS fps_sum, COUNT(e.fps) AS fps_count,
      SUM(e.rtt_ms) AS rtt_sum, COUNT(e.rtt_ms) AS rtt_count,
      SUM(e.load_ms) AS load_sum, COUNT(e.load_ms) AS load_count
      FROM gaming_events e${eventJoin} WHERE ${eventWhere} AND (e.fps IS NOT NULL OR e.rtt_ms IS NOT NULL OR e.load_ms IS NOT NULL)`).bind(...eventBinds).all())[0] || {};
    const rawFps = { sum: numeric(performance.fps_sum), count: numeric(performance.fps_count) };
    const rawRtt = { sum: numeric(performance.rtt_sum), count: numeric(performance.rtt_count) };
    const rawLoad = { sum: numeric(performance.load_sum), count: numeric(performance.load_count) };
    performance.fps = rawFps.count + dailyAggregate.fpsCount ? (rawFps.sum + dailyAggregate.fpsSum) / (rawFps.count + dailyAggregate.fpsCount) : null;
    performance.rtt_ms = rawRtt.count + dailyAggregate.rttCount ? (rawRtt.sum + dailyAggregate.rttSum) / (rawRtt.count + dailyAggregate.rttCount) : null;
    performance.load_ms = rawLoad.count + dailyAggregate.loadCount ? (rawLoad.sum + dailyAggregate.loadSum) / (rawLoad.count + dailyAggregate.loadCount) : null;
    const eventDimensionRows = rowsFromResult(await db.prepare(`SELECT e.game_id, COALESCE(e.mode, '') AS mode,
      COALESCE(e.sector, '') AS sector, e.event_type, e.action, e.subject, e.distance
      FROM gaming_events e${eventJoin} WHERE ${eventWhere}`).bind(...eventBinds).all());
    const gameExtras = new Map();
    const modeExtras = new Map();
    const sectorExtras = new Map();
    for (const row of eventDimensionRows) {
      const gameExtra = gameExtras.get(row.game_id) || emptyBreakdownExtra();
      addBreakdownEvent(gameExtra, row); gameExtras.set(row.game_id, gameExtra);
      if (row.mode) {
        const modeExtra = modeExtras.get(row.mode) || emptyBreakdownExtra();
        addBreakdownEvent(modeExtra, row); modeExtras.set(row.mode, modeExtra);
      }
      if (row.sector) {
        const sectorExtra = sectorExtras.get(row.sector) || emptyBreakdownExtra();
        addBreakdownEvent(sectorExtra, row); sectorExtras.set(row.sector, sectorExtra);
      }
    }
    for (const row of dailyBreakdowns.values()) {
      const gameExtra = gameExtras.get(row.gameId) || emptyBreakdownExtra();
      mergeBreakdownExtra(gameExtra, row); gameExtras.set(row.gameId, gameExtra);
      if (row.modeId) {
        const modeExtra = modeExtras.get(row.modeId) || emptyBreakdownExtra();
        mergeBreakdownExtra(modeExtra, row); modeExtras.set(row.modeId, modeExtra);
      }
    }
    for (const row of games) mergeBreakdownExtra(row, gameExtras.get(row.id) || emptyBreakdownExtra());
    for (const row of modes) mergeBreakdownExtra(row, modeExtras.get(row.id) || emptyBreakdownExtra());
    const sectorRows = rowsFromResult(await db.prepare(`SELECT sector AS id, sector AS label,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, SUM(score) AS score,
      SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnects
      FROM gaming_sessions WHERE ${realBaseWhere} AND sector IS NOT NULL GROUP BY sector ORDER BY starts DESC`).bind(...realBaseBinds).all());
    const sectors = sectorRows.map(row => ({ ...emptyBreakdownExtra(), ...row, starts: numeric(row.starts), players: numeric(row.players), completions: numeric(row.completions), play_seconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score), disconnects: numeric(row.disconnects) }));
    for (const row of sectors) mergeBreakdownExtra(row, sectorExtras.get(row.id) || emptyBreakdownExtra());
    for (const row of dailySectors.values()) {
      if (!row.id) continue;
      const sector = sectors.find(item => item.id === row.id);
      if (sector) {
        sector.starts += row.starts; sector.players += row.players; sector.completions += row.completions; sector.play_seconds += row.play_seconds; sector.score = numeric(sector.score) + row.score;
        mergeBreakdownExtra(sector, row);
      } else {
        sectors.push({ ...row });
      }
    }

    const matchClauses = ['m.started_at >= ? AND m.started_at <= ?'];
    const matchBinds = [from, now];
    if (game) { matchClauses.push('m.game_id = ?'); matchBinds.push(game); }
    if (mode) { matchClauses.push('m.mode = ?'); matchBinds.push(mode); }
    if (transport) { matchClauses.push('m.transport = ?'); matchBinds.push(transport); }
    const matchWhere = matchClauses.join(' AND ');
    const matchAggregate = await db.prepare(`SELECT COUNT(*) AS matches,
      SUM(CASE WHEN m.status='completed' THEN 1 ELSE 0 END) AS completed,
      COALESCE(SUM(m.participant_count), 0) AS participants,
      COALESCE(SUM(m.human_count), 0) AS humans,
      COALESCE(SUM(m.bot_count), 0) AS bots
      FROM gaming_matches m WHERE ${matchWhere}`).bind(...matchBinds).first() || {};
    matchAggregate.matches = numeric(matchAggregate.matches) + dailyAggregate.authoritative.matches;
    matchAggregate.completed = numeric(matchAggregate.completed) + dailyAggregate.authoritative.completed;
    matchAggregate.participants = numeric(matchAggregate.participants) + dailyAggregate.authoritative.participants;
    matchAggregate.humans = numeric(matchAggregate.humans) + dailyAggregate.authoritative.humans;
    matchAggregate.bots = numeric(matchAggregate.bots) + dailyAggregate.authoritative.bots;
    const matchModes = rowsFromResult(await db.prepare(`SELECT COALESCE(m.mode, 'unknown') AS mode,
      COUNT(*) AS matches, SUM(CASE WHEN m.status='completed' THEN 1 ELSE 0 END) AS completed,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.captures') AS REAL)), 0) AS captures,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.contests') AS REAL)), 0) AS contests,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.deploys') AS REAL)), 0) AS deploys,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.loots') AS REAL)), 0) AS loots,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.lifts') AS REAL)), 0) AS lifts,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.extracted') AS REAL)), 0) AS extracted,
      COALESCE(SUM(CAST(json_extract(m.result_json, '$.extracted_value') AS REAL)), 0) AS extracted_value
      FROM gaming_matches m WHERE ${matchWhere} GROUP BY m.mode`).bind(...matchBinds).all());
    const participantModes = rowsFromResult(await db.prepare(`SELECT m.mode, p.bot,
      COALESCE(SUM(p.kills), 0) AS kills, COALESCE(SUM(p.deaths), 0) AS deaths,
      COALESCE(SUM(p.assists), 0) AS assists, COALESCE(SUM(p.score), 0) AS score
      FROM gaming_participants p JOIN gaming_matches m ON m.id = p.match_id
      WHERE ${matchWhere} GROUP BY m.mode, p.bot`).bind(...matchBinds).all());
    const modeAuthority = new Map();
    const authoritativeMatches = numeric(matchAggregate.matches);
    const authoritativeCompleted = numeric(matchAggregate.completed);
    const authoritativeParticipants = numeric(matchAggregate.participants);
    const authoritativeHumans = numeric(matchAggregate.humans);
    const authoritativeBots = numeric(matchAggregate.bots);
    let authoritativeCounters = { kills: 0, deaths: 0, assists: 0, captures: 0, contests: 0, deploys: 0, loots: 0, lifts: 0, extracted: 0, extracted_value: 0 };
    for (const row of matchModes) {
      const key = row.mode || 'unknown';
      const item = {
        mode: key, matches: numeric(row.matches), completed: numeric(row.completed),
        captures: numeric(row.captures), contests: numeric(row.contests), deploys: numeric(row.deploys),
        loots: numeric(row.loots), lifts: numeric(row.lifts), extracted: numeric(row.extracted),
        extracted_value: numeric(row.extracted_value),
      };
      for (const counter of ['captures', 'contests', 'deploys', 'loots', 'lifts', 'extracted', 'extracted_value']) {
        authoritativeCounters[counter] += item[counter];
      }
      modeAuthority.set(key, item);
    }
    for (const row of participantModes) {
      const item = modeAuthority.get(row.mode || 'unknown') || {
        mode: row.mode || 'unknown', matches: 0, completed: 0,
        captures: 0, contests: 0, deploys: 0, loots: 0, lifts: 0, extracted: 0, extracted_value: 0,
      };
      item.kills = numeric(item.kills) + numeric(row.kills); item.deaths = numeric(item.deaths) + numeric(row.deaths); item.assists = numeric(item.assists) + numeric(row.assists); item.score = numeric(item.score) + numeric(row.score);
      const prefix = bool(row.bot) ? 'bot' : 'human';
      item[`${prefix}Kills`] = numeric(item[`${prefix}Kills`]) + numeric(row.kills);
      item[`${prefix}Deaths`] = numeric(item[`${prefix}Deaths`]) + numeric(row.deaths);
      item[`${prefix}Assists`] = numeric(item[`${prefix}Assists`]) + numeric(row.assists);
      authoritativeCounters.kills += numeric(row.kills); authoritativeCounters.deaths += numeric(row.deaths); authoritativeCounters.assists += numeric(row.assists);
      authoritativeCounters[`${prefix}Kills`] = numeric(authoritativeCounters[`${prefix}Kills`]) + numeric(row.kills);
      authoritativeCounters[`${prefix}Deaths`] = numeric(authoritativeCounters[`${prefix}Deaths`]) + numeric(row.deaths);
      authoritativeCounters[`${prefix}Assists`] = numeric(authoritativeCounters[`${prefix}Assists`]) + numeric(row.assists);
      modeAuthority.set(row.mode || 'unknown', item);
    }
    for (const row of dailyBreakdowns.values()) {
      const key = row.id || 'unknown';
      const item = modeAuthority.get(key) || {
        mode: key, matches: 0, completed: 0, captures: 0, contests: 0, deploys: 0,
        loots: 0, lifts: 0, extracted: 0, extracted_value: 0, kills: 0, deaths: 0, assists: 0,
        humanKills: 0, humanDeaths: 0, humanAssists: 0, botKills: 0, botDeaths: 0, botAssists: 0,
      };
      item.matches += numeric(row.authoritative.matches); item.completed += numeric(row.authoritative.completed);
      for (const counter of ['captures', 'contests', 'deploys', 'loots', 'lifts', 'extracted', 'extracted_value', 'kills', 'deaths', 'assists', 'humanKills', 'humanDeaths', 'humanAssists', 'botKills', 'botDeaths', 'botAssists']) {
        item[counter] = numeric(item[counter]) + numeric(row.authoritative[counter]);
        if (counter in authoritativeCounters) authoritativeCounters[counter] = numeric(authoritativeCounters[counter]) + numeric(row.authoritative[counter]);
      }
      modeAuthority.set(key, item);
    }
    const authoritative = {
      matches: authoritativeMatches, completed: authoritativeCompleted, participants: authoritativeParticipants,
      humans: authoritativeHumans, bots: authoritativeBots, ...authoritativeCounters,
      modes: [...modeAuthority.values()],
    };
    const arcadeFunnel = await readArcadeFunnel(db, detailFrom, now, { game, mode, transport }, dailyAggregate);
    const persistedTracking = await trackingStarted(db);
    const dailyTracking = dailyRows.map(row => summaryDateFromDay(row.day)).filter(Number.isFinite).sort((left, right) => left - right)[0];
    const firstSessionStartedAt = firstSession.started_at == null || firstSession.started_at === '' ? null : Number(firstSession.started_at);
    const firstTrackingCandidates = [persistedTracking, firstSessionStartedAt, dailyTracking].filter(Number.isFinite);
    const firstTracking = persistedTracking != null
      ? persistedTracking
      : (firstTrackingCandidates.length ? Math.min(...firstTrackingCandidates) : null);
    const interactions = [];
    const endReasons = [];
    for (const [gameId, extra] of gameExtras.entries()) {
      for (const [label, count] of Object.entries(extra.interactions)) interactions.push({ gameId, label, count: numeric(count) });
      for (const [reason, count] of Object.entries(extra.endReasons)) endReasons.push({ gameId, reason, count: numeric(count) });
    }
    return {
      from, to: now, sessions, nextCursor,
      players: players.map(row => ({
        id: row.player_key, label: playerLabel(row.player_key), sessions: numeric(row.sessions),
        playSeconds: numeric(row.play_seconds), firstSeenAt: iso(row.first_seen_at), lastSeenAt: iso(row.last_seen_at),
        returning: numeric(row.sessions) > 1,
      })),
      games: games.map(row => ({ id: row.id, label: row.label, starts: numeric(row.starts), players: historicalAggregates ? null : numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score), distance: numeric(row.distance), disconnects: numeric(row.disconnects), renderFailures: numeric(row.renderFailures), endReasons: row.endReasons || {}, interactions: row.interactions || {} })),
      modes: modes.map(row => ({ id: row.id, label: row.label, starts: numeric(row.starts), players: historicalAggregates ? null : numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score), distance: numeric(row.distance), disconnects: numeric(row.disconnects), renderFailures: numeric(row.renderFailures), endReasons: row.endReasons || {}, interactions: row.interactions || {} })),
      sectors: sectors.map(row => ({ id: row.id, label: row.label, starts: numeric(row.starts), players: historicalAggregates ? null : numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score), distance: numeric(row.distance), disconnects: numeric(row.disconnects), renderFailures: numeric(row.renderFailures), endReasons: row.endReasons || {}, interactions: row.interactions || {} })),
      interactions,
      endReasons,
      daily: dailySeries.map(row => ({ date: row.date, starts: numeric(row.starts), players: numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.playSeconds ?? row.play_seconds) })),
      historicalAggregates,
      playersCount: historicalAggregates ? null : numeric(aggregate.players),
      eventCount,
      performance: { fps: performance.fps == null ? null : Number(performance.fps), rttMs: performance.rtt_ms == null ? null : Number(performance.rtt_ms), loadMs: performance.load_ms == null ? null : Number(performance.load_ms) },
      aggregate: {
        starts: numeric(aggregate.starts), completions: numeric(aggregate.completions), abandoned: numeric(aggregate.abandoned),
        active: numeric(aggregate.active), activePlayers: numeric(activePlayers.count), serverVerified: numeric(aggregate.server_verified), playSeconds: numeric(aggregate.play_seconds),
        returningPlayers: historicalAggregates ? null : numeric(returning.count),
      },
      trackingStartedAt: Number.isFinite(firstTracking) ? iso(firstTracking) : null,
      authoritative,
      funnel: [
        { stage: 'launches', count: numeric(aggregate.starts) },
        { stage: 'arcade_launches', count: arcadeFunnel.launches },
        { stage: 'arcade_linked_child_starts', count: arcadeFunnel.linkedChildStarts },
        { stage: 'arcade_unlinked_child_starts', count: arcadeFunnel.unlinkedChildStarts },
        { stage: 'completed', count: numeric(aggregate.completions) },
        { stage: 'server_verified', count: numeric(aggregate.server_verified) },
        { stage: 'authoritative_matches', count: authoritativeMatches },
      ],
      timeline: pageRows.map(row => row.id),
    };
  } catch {
    return { unavailable: true, reason: 'Gaming analytics read failed' };
  }
}

export async function readGamingSession(env = {}, sessionId, options = {}) {
  const db = dbFor(env);
  if (!db || !id(sessionId)) return null;
  const row = await db.prepare('SELECT * FROM gaming_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
  if (!row) return null;
  const timelineCursor = sessionCursor(options.timelineCursor);
  const timelineClauses = ['session_id = ?'];
  const timelineBinds = [sessionId];
  if (timelineCursor) {
    timelineClauses.push('(event_at > ? OR (event_at = ? AND event_id > ?))');
    timelineBinds.push(timelineCursor.timestamp, timelineCursor.timestamp, timelineCursor.sessionId);
  }
  const timelineRows = rowsFromResult(await db.prepare(`SELECT event_id, event_at, event_type, action, subject, details_json
    FROM gaming_events WHERE ${timelineClauses.join(' AND ')} ORDER BY event_at ASC, event_id ASC LIMIT ${MAX_TIMELINE_ROWS + 1}`).bind(...timelineBinds).all());
  const timelineTruncated = timelineRows.length > MAX_TIMELINE_ROWS;
  if (timelineTruncated) timelineRows.pop();
  const timelineNextCursor = timelineTruncated ? nextSessionCursor({ started_at: timelineRows.at(-1)?.event_at, id: timelineRows.at(-1)?.event_id }) : null;
  const timelineTotal = numeric((await db.prepare('SELECT COUNT(*) AS count FROM gaming_events WHERE session_id = ?').bind(sessionId).first())?.count);
  const participants = rowsFromResult(await db.prepare(`SELECT participant_key, player_key, bot, kills, deaths, assists, score FROM gaming_participants WHERE match_id = ? ORDER BY bot ASC, id ASC LIMIT ${MAX_PLAYER_ROWS + 1}`).bind(row.match_id || '').all());
  const participantsTruncated = participants.length > MAX_PLAYER_ROWS;
  if (participantsTruncated) participants.pop();
  const participantsTotal = numeric((await db.prepare('SELECT COUNT(*) AS count FROM gaming_participants WHERE match_id = ?').bind(row.match_id || '').first())?.count);
  return {
    session: sessionResponse(row),
    timeline: timelineRows.map(item => ({ id: item.event_id, at: iso(item.event_at), kind: item.event_type, detail: item.details_json || item.action || item.subject || undefined })),
    timelineTotal,
    timelineLimit: MAX_TIMELINE_ROWS,
    timelineTruncated,
    timelineNextCursor,
    participantsTotal,
    participantsLimit: MAX_PLAYER_ROWS,
    participantsTruncated,
    participants: participants.map(item => ({ label: item.player_key ? playerLabel(item.player_key) : item.participant_key ? `PLAYER-${String(item.participant_key).slice(-8).toUpperCase()}` : 'BOT', bot: Boolean(item.bot), kills: item.kills == null ? undefined : Number(item.kills), deaths: item.deaths == null ? undefined : Number(item.deaths), assists: item.assists == null ? undefined : Number(item.assists), score: item.score == null ? undefined : Number(item.score) })),
  };
}

export async function readGamingPlayer(env = {}, playerId, options = {}) {
  const db = dbFor(env);
  if (!db || !id(playerId)) return null;
  const cursor = sessionCursor(options.cursor);
  const sessionClauses = ['player_key = ?'];
  const sessionBinds = [playerId];
  if (cursor) {
    sessionClauses.push('(started_at < ? OR (started_at = ? AND id < ?))');
    sessionBinds.push(cursor.timestamp, cursor.timestamp, cursor.sessionId);
  }
  const rows = rowsFromResult(await db.prepare(`SELECT * FROM gaming_sessions WHERE ${sessionClauses.join(' AND ')} ORDER BY started_at DESC, id DESC LIMIT ${MAX_PLAYER_ROWS + 1}`).bind(...sessionBinds).all());
  const sessionsTruncated = rows.length > MAX_PLAYER_ROWS;
  if (sessionsTruncated) rows.pop();
  if (!rows.length) return null;
  const sessions = rows.map(sessionResponse);
  const summary = await db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS play_seconds,
    MIN(started_at) AS first_seen_at, MAX(last_seen_at) AS last_seen_at
    FROM gaming_sessions WHERE player_key = ?`).bind(playerId).first() || {};
  return {
    player: { id: playerId, label: playerLabel(playerId), sessions: numeric(summary.sessions), playSeconds: numeric(summary.play_seconds), firstSeenAt: iso(summary.first_seen_at), lastSeenAt: iso(summary.last_seen_at), returning: numeric(summary.sessions) > 1 },
    sessions,
    sessionsTotal: numeric(summary.sessions),
    sessionsLimit: MAX_PLAYER_ROWS,
    sessionsTruncated,
    sessionsNextCursor: sessionsTruncated ? nextSessionCursor({ started_at: rows.at(-1)?.started_at, id: rows.at(-1)?.id }) : null,
  };
}

function dailyRollup(map, row) {
  const key = dailyDimensionKey(row);
  let value = map.get(key);
  if (!value) {
    value = {
      day: row.day,
      game_id: row.game_id,
      mode: row.mode || '',
      sector: row.sector || '',
      transport: row.transport || '',
      starts: 0,
      players: 0,
      completions: 0,
      play_seconds: 0,
      summary: emptyDailySummary(),
    };
    map.set(key, value);
  }
  return value;
}

function boundedMapIncrement(map, key, amount = 1) {
  const label = clean(key, 96);
  if (!label) return;
  if (!Object.prototype.hasOwnProperty.call(map, label) && Object.keys(map).length >= 128) return;
  map[label] = numeric(map[label]) + numeric(amount);
}

async function buildGamingDailyRollups(db, summaryStart, now) {
  const rollups = new Map();
  const sessions = rowsFromResult(await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      game_id, COALESCE(mode, '') AS mode, COALESCE(sector, '') AS sector, COALESCE(transport, '') AS transport,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds,
      SUM(CASE WHEN status='abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN status IN ('active', 'disconnected', 'idle') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnects,
      SUM(CASE WHEN verification='server_verified' THEN 1 ELSE 0 END) AS server_verified,
      COALESCE(SUM(score), 0) AS score_total
      FROM gaming_sessions WHERE started_at >= ? AND started_at <= ?
        AND NOT (${arcadeParentPredicate('gaming_sessions')})
      GROUP BY day, game_id, mode, sector, transport`).bind(summaryStart, now).all());
  for (const row of sessions) {
    const value = dailyRollup(rollups, row);
    value.starts = numeric(row.starts);
    value.players = numeric(row.players);
    value.completions = numeric(row.completions);
    value.play_seconds = numeric(row.play_seconds);
    value.summary.abandoned = numeric(row.abandoned);
    value.summary.active = numeric(row.active);
    value.summary.disconnects = numeric(row.disconnects);
    value.summary.serverVerified = numeric(row.server_verified);
    value.summary.scoreTotal = numeric(row.score_total);
  }

  const arcadeLaunches = rowsFromResult(await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      game_id, COALESCE(mode, '') AS mode, COALESCE(sector, '') AS sector, COALESCE(transport, '') AS transport,
      COUNT(*) AS launches
      FROM gaming_sessions
      WHERE started_at >= ? AND started_at <= ? AND ${arcadeParentPredicate('gaming_sessions')}
      GROUP BY day, game_id, mode, sector, transport`).bind(summaryStart, now).all());
  for (const row of arcadeLaunches) {
    dailyRollup(rollups, row).summary.arcadeLaunches += numeric(row.launches);
  }

  const arcadeChildren = rowsFromResult(await db.prepare(`SELECT substr(datetime(c.started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      c.game_id, COALESCE(c.mode, '') AS mode, COALESCE(c.sector, '') AS sector, COALESCE(c.transport, '') AS transport,
      COUNT(*) AS child_starts,
      SUM(CASE WHEN ${arcadeLinkedChildPredicate('c')} THEN 1 ELSE 0 END) AS linked_child_starts
      FROM gaming_sessions c
      WHERE c.started_at >= ? AND c.started_at <= ? AND ${arcadeChildPredicate('c')}
      GROUP BY day, c.game_id, mode, sector, transport`).bind(summaryStart, now).all());
  for (const row of arcadeChildren) {
    const summary = dailyRollup(rollups, row).summary;
    const total = numeric(row.child_starts);
    const linked = numeric(row.linked_child_starts);
    summary.arcadeLinkedChildStarts += linked;
    summary.arcadeUnlinkedChildStarts += Math.max(0, total - linked);
  }

  // Sparse client events carry the Relay distance/end reason and Kessler
  // zone/POI/layer/audio dimensions. They are folded before the 90-day rows
  // are removed, with a small bounded map per daily dimension.
  const events = rowsFromResult(await db.prepare(`SELECT substr(datetime(e.event_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      e.game_id, COALESCE(e.mode, '') AS mode, COALESCE(e.sector, s.sector, '') AS sector,
      COALESCE(s.transport, 'browser') AS transport, e.event_type, e.action, e.subject,
      e.distance, e.fps, e.rtt_ms, e.load_ms, e.details_json
      FROM gaming_events e LEFT JOIN gaming_sessions s ON s.id = e.session_id
      WHERE e.event_at >= ? AND e.event_at <= ?`).bind(summaryStart, now).all());
  for (const row of events) {
    const value = dailyRollup(rollups, row);
    const summary = value.summary;
    summary.eventCount += 1;
    if (Number.isFinite(Number(row.distance))) summary.distance += Number(row.distance);
    for (const [field, sumKey, countKey] of [['fps', 'fpsSum', 'fpsCount'], ['rtt_ms', 'rttSum', 'rttCount'], ['load_ms', 'loadSum', 'loadCount']]) {
      if (Number.isFinite(Number(row[field]))) {
        summary[sumKey] += Number(row[field]);
        summary[countKey] += 1;
      }
    }
    const action = clean(row.action, 96);
    const subject = clean(row.subject, 96);
    const interaction = [action, subject].filter(Boolean).join(':');
    if (row.event_type === 'gaming_interaction' && interaction) boundedMapIncrement(summary.interactions, interaction);
    if (row.event_type === 'gaming_session_end' || row.event_type === 'gaming_client_result') {
      if (action) boundedMapIncrement(summary.endReasons, action);
      if (action && /disconnect/i.test(action)) summary.disconnects += 1;
    }
    if ((action && /render.*fail|fail.*render/i.test(action)) || (subject && /render.*fail|fail.*render/i.test(subject))) {
      summary.renderFailures += 1;
    }
  }

  const matches = rowsFromResult(await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      game_id, COALESCE(mode, '') AS mode, COALESCE(sector, '') AS sector, COALESCE(transport, '') AS transport,
      COUNT(*) AS matches, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      COALESCE(SUM(participant_count), 0) AS participants, COALESCE(SUM(human_count), 0) AS humans,
      COALESCE(SUM(bot_count), 0) AS bots,
      COALESCE(SUM(CAST(json_extract(result_json, '$.captures') AS REAL)), 0) AS captures,
      COALESCE(SUM(CAST(json_extract(result_json, '$.contests') AS REAL)), 0) AS contests,
      COALESCE(SUM(CAST(json_extract(result_json, '$.deploys') AS REAL)), 0) AS deploys,
      COALESCE(SUM(CAST(json_extract(result_json, '$.loots') AS REAL)), 0) AS loots,
      COALESCE(SUM(CAST(json_extract(result_json, '$.lifts') AS REAL)), 0) AS lifts,
      COALESCE(SUM(CAST(json_extract(result_json, '$.extracted') AS REAL)), 0) AS extracted,
      COALESCE(SUM(CAST(json_extract(result_json, '$.extracted_value') AS REAL)), 0) AS extracted_value
      FROM gaming_matches WHERE started_at >= ? AND started_at <= ?
      GROUP BY day, game_id, mode, sector, transport`).bind(summaryStart, now).all());
  for (const row of matches) {
    const value = dailyRollup(rollups, row);
    const authority = value.summary.authoritative;
    for (const [key, source] of [['matches', 'matches'], ['completed', 'completed'], ['participants', 'participants'], ['humans', 'humans'], ['bots', 'bots'], ['captures', 'captures'], ['contests', 'contests'], ['deploys', 'deploys'], ['loots', 'loots'], ['lifts', 'lifts'], ['extracted', 'extracted'], ['extracted_value', 'extracted_value']]) {
      authority[key] = numeric(row[source]);
    }
  }
  const participants = rowsFromResult(await db.prepare(`SELECT substr(datetime(m.started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      m.game_id, COALESCE(m.mode, '') AS mode, COALESCE(m.sector, '') AS sector, COALESCE(m.transport, '') AS transport,
      p.bot, COALESCE(SUM(p.kills), 0) AS kills, COALESCE(SUM(p.deaths), 0) AS deaths,
      COALESCE(SUM(p.assists), 0) AS assists
      FROM gaming_participants p JOIN gaming_matches m ON m.id = p.match_id
      WHERE m.started_at >= ? AND m.started_at <= ? GROUP BY day, m.game_id, mode, sector, transport, p.bot`).bind(summaryStart, now).all());
  for (const row of participants) {
    const authority = dailyRollup(rollups, row).summary.authoritative;
    authority.kills += numeric(row.kills);
    authority.deaths += numeric(row.deaths);
    authority.assists += numeric(row.assists);
    const prefix = bool(row.bot) ? 'bot' : 'human';
    authority[`${prefix}Kills`] += numeric(row.kills);
    authority[`${prefix}Deaths`] += numeric(row.deaths);
    authority[`${prefix}Assists`] += numeric(row.assists);
  }
  return [...rollups.values()];
}

export async function runGamingMaintenance(env = {}, suppliedNow) {
  const db = dbFor(env);
  if (!db) return { unavailable: true, reason: 'Gaming database is unavailable' };
  const now = nowMs(env, suppliedNow);
  const rawCutoff = now - GAMING_RAW_RETENTION_MS;
  const summaryStart = calendarMonthsAgo(now, 13);
  const dailyCutoff = dayKey(summaryStart);
  try {
    const firstRaw = await db.prepare('SELECT MIN(started_at) AS started_at FROM gaming_sessions').first();
    const firstDaily = await db.prepare('SELECT MIN(day) AS day FROM gaming_daily').first();
    const rawStart = Number(firstRaw?.started_at);
    const dailyStart = summaryDateFromDay(firstDaily?.day);
    const starts = [rawStart, dailyStart].filter(Number.isFinite);
    if (starts.length) await noteTrackingStarted(db, Math.min(...starts), now);

    // Build and persist the 13-month rollup while all 90-day raw rows still
    // exist. Deletion follows this write so the boundary day is retained.
    const dailyRows = await buildGamingDailyRollups(db, summaryStart, now);
    const upsert = `INSERT INTO gaming_daily
      (day, game_id, mode, sector, transport, starts, players, completions, play_seconds, summary_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, game_id, mode, sector, transport) DO UPDATE SET
        starts=excluded.starts, players=excluded.players, completions=excluded.completions,
        play_seconds=excluded.play_seconds, summary_json=excluded.summary_json, updated_at=excluded.updated_at`;
    for (const row of dailyRows) {
      await db.prepare(upsert).bind(row.day, row.game_id, row.mode, row.sector, row.transport,
        row.starts, row.players, row.completions, row.play_seconds, JSON.stringify(row.summary), now).run();
    }
    const results = await executeBatch(db, [
      db.prepare('DELETE FROM gaming_events WHERE event_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_sessions WHERE started_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_participants WHERE match_id IN (SELECT id FROM gaming_matches WHERE started_at < ?)').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_matches WHERE started_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_daily WHERE day < ?').bind(dailyCutoff),
    ]);
    return {
      raw_pruned: results.reduce((sum, item) => sum + resultChanges(item), 0),
      daily_rows: dailyRows.length,
      raw_detail_cutoff: new Date(rawCutoff).toISOString(),
      summary_cutoff: dailyCutoff,
    };
  } catch {
    return { unavailable: true, reason: 'Gaming maintenance failed' };
  }
}

export const GAMING_SCHEMA_TABLES = ['gaming_sessions', 'gaming_matches', 'gaming_participants', 'gaming_events', 'gaming_daily'];
