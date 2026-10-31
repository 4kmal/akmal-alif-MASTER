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
export const GAMING_SUMMARY_RETENTION_MS = 13 * 31 * 24 * 60 * 60 * 1000;
const MAX_DETAILS_BYTES = 2_048;
const MAX_TIMELINE_ROWS = 500;
const MAX_SESSION_ROWS = 1_000;
const MAX_PLAYER_ROWS = 500;
const MAX_PARTICIPANTS = 32;
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
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  source=COALESCE(excluded.source, gaming_sessions.source)`;

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
    let existingEvent;
    try {
      existingEvent = await db.prepare('SELECT event_id FROM gaming_events WHERE event_id = ? LIMIT 1').bind(event.eventId).first();
    } catch {
      return { accepted: 0, deduped: 0, unavailable: true };
    }
    if (existingEvent) { skipped += 1; continue; }
    const digest = event.correlationToken ? await tokenDigest(event.correlationToken, env) : null;
    const sessionId = await scopedSessionId(event.runId, keys, env);
    if (!tokenInfo) event.matchId = null;
    const session = rowFromGamingEvent(event, keys, now, sessionId);
    if (tokenInfo) {
      session.matchId = tokenInfo.matchId;
      event.matchId = tokenInfo.matchId;
    }
    statements.push(db.prepare(SESSION_INSERT).bind(...sessionParams(session)));
    statements.push(db.prepare(`INSERT OR IGNORE INTO gaming_events (
      event_id, session_id, match_id, player_key, event_type, event_at, game_id, mode, sector,
      action, subject, duration_ms, active_ms, score, kills, deaths, assists, distance,
      fps, rtt_ms, load_ms, details_json, correlation_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...timelineParams(event, keys, now, digest, sessionId)));
    timelineIndexes.push(statements.length - 1);
    acceptedCandidates.push(event);
    if (tokenInfo) {
      statements.push(db.prepare(`UPDATE gaming_participants
        SET player_key=COALESCE(player_key, ?), linked_session_id=COALESCE(linked_session_id, ?)
        WHERE match_id=? AND participant_key=?`).bind(keys.playerKey, sessionId, tokenInfo.matchId, digest));
      // A Room summary may arrive before the browser's identity link. When
      // the order is reversed, promote that linked session from the already
      // stored authoritative participant without accepting browser stats.
      statements.push(db.prepare(`UPDATE gaming_sessions SET
        verification='server_verified', match_id=?,
        score=(SELECT score FROM gaming_participants WHERE match_id=? AND participant_key=?),
        kills=(SELECT kills FROM gaming_participants WHERE match_id=? AND participant_key=?),
        deaths=(SELECT deaths FROM gaming_participants WHERE match_id=? AND participant_key=?),
        assists=(SELECT assists FROM gaming_participants WHERE match_id=? AND participant_key=?),
        status=CASE WHEN status IN ('active', 'ended', 'completed', 'abandoned', 'disconnected', 'idle', 'reset')
          THEN (SELECT status FROM gaming_matches WHERE id=?) ELSE status END
        WHERE id IN (SELECT linked_session_id FROM gaming_participants
          WHERE match_id=? AND participant_key=? AND linked_session_id IS NOT NULL)
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
  // Every event emits one session upsert and one OR IGNORE timeline insert.
  for (let index = 0; index < acceptedCandidates.length; index += 1) {
    if (resultChanges(results[timelineIndexes[index]]) > 0) accepted += 1;
  }
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
        verification='server_verified', match_id=?, score=?, kills=?, deaths=?, assists=?,
        status=CASE WHEN status IN ('active', 'ended', 'completed', 'disconnected', 'idle') THEN ? ELSE status END
        WHERE id IN (SELECT linked_session_id FROM gaming_participants WHERE match_id=? AND participant_key=?)`)
        .bind(mid, integer(participant?.score, -1_000_000_000, 1_000_000_000), integer(participant?.kills, 0, 1_000_000),
          integer(participant?.deaths, 0, 1_000_000), integer(participant?.assists, 0, 1_000_000), authoritativeStatus(summary.status), mid, digest));
    }
  }
  try {
    await executeBatch(db, statements);
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

export async function readGamingData(env = {}, options = {}) {
  const db = dbFor(env);
  if (!db) return { unavailable: true, reason: 'Gaming database is unavailable' };
  const now = nowMs(env, options.now);
  const rangeDays = [7, 30, 90].includes(Number(options.rangeDays)) ? Number(options.rangeDays) : 30;
  const from = now - rangeDays * 24 * 60 * 60 * 1000;
  const game = stringField(options.game, 48);
  const mode = stringField(options.mode, 48);
  const transport = stringField(options.transport, 32);
  try {
    const baseClauses = ['started_at >= ? AND started_at <= ?'];
    const baseBinds = [from, now];
    if (game) { baseClauses.push('game_id = ?'); baseBinds.push(game); }
    if (mode) { baseClauses.push('mode = ?'); baseBinds.push(mode); }
    if (transport) { baseClauses.push('transport = ?'); baseBinds.push(transport); }
    const baseWhere = baseClauses.join(' AND ');
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

    const aggregate = await db.prepare(`SELECT COUNT(*) AS starts,
      COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      SUM(CASE WHEN status='abandoned' THEN 1 ELSE 0 END) AS abandoned,
      SUM(CASE WHEN status IN ('active', 'disconnected', 'idle') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN verification='server_verified' THEN 1 ELSE 0 END) AS server_verified,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds
      FROM gaming_sessions WHERE ${baseWhere}`).bind(...baseBinds).first() || {};
    const returning = await db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT player_key FROM gaming_sessions WHERE ${baseWhere} AND player_key IS NOT NULL
      GROUP BY player_key HAVING COUNT(*) > 1
    )`).bind(...baseBinds).first() || {};
    const firstSession = await db.prepare('SELECT MIN(started_at) AS started_at FROM gaming_sessions').first() || {};
    const games = rowsFromResult(await db.prepare(`SELECT game_id AS id, game_id AS label,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, SUM(score) AS score
      FROM gaming_sessions WHERE ${baseWhere} GROUP BY game_id ORDER BY starts DESC`).bind(...baseBinds).all());
    const modes = rowsFromResult(await db.prepare(`SELECT mode AS id, mode AS label,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, SUM(score) AS score
      FROM gaming_sessions WHERE ${baseWhere} AND mode IS NOT NULL GROUP BY mode ORDER BY starts DESC`).bind(...baseBinds).all());
    const daily = rowsFromResult(await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS date,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds
      FROM gaming_sessions WHERE ${baseWhere} GROUP BY date ORDER BY date ASC`).bind(...baseBinds).all());
    const players = rowsFromResult(await db.prepare(`SELECT player_key, COUNT(*) AS sessions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds, MIN(started_at) AS first_seen_at,
      MAX(last_seen_at) AS last_seen_at
      FROM gaming_sessions WHERE ${baseWhere} AND player_key IS NOT NULL
      GROUP BY player_key ORDER BY last_seen_at DESC LIMIT ${MAX_PLAYER_ROWS}`).bind(...baseBinds).all());
    const eventClauses = ['e.event_at >= ? AND e.event_at <= ?'];
    const eventBinds = [from, now];
    if (game) { eventClauses.push('e.game_id = ?'); eventBinds.push(game); }
    if (mode) { eventClauses.push('e.mode = ?'); eventBinds.push(mode); }
    if (transport) { eventClauses.push('s.transport = ?'); eventBinds.push(transport); }
    const eventWhere = eventClauses.join(' AND ');
    const eventJoin = transport ? ' JOIN gaming_sessions s ON s.id = e.session_id' : '';
    const eventCount = numeric((await db.prepare(`SELECT COUNT(*) AS count FROM gaming_events e${eventJoin} WHERE ${eventWhere}`).bind(...eventBinds).first())?.count);
    const performance = rowsFromResult(await db.prepare(`SELECT AVG(e.fps) AS fps, AVG(e.rtt_ms) AS rtt_ms, AVG(e.load_ms) AS load_ms
      FROM gaming_events e${eventJoin} WHERE ${eventWhere} AND (e.fps IS NOT NULL OR e.rtt_ms IS NOT NULL OR e.load_ms IS NOT NULL)`).bind(...eventBinds).all())[0] || {};

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
    const participantModes = rowsFromResult(await db.prepare(`SELECT m.mode,
      COALESCE(SUM(p.kills), 0) AS kills, COALESCE(SUM(p.deaths), 0) AS deaths,
      COALESCE(SUM(p.assists), 0) AS assists, COALESCE(SUM(p.score), 0) AS score
      FROM gaming_participants p JOIN gaming_matches m ON m.id = p.match_id
      WHERE ${matchWhere} GROUP BY m.mode`).bind(...matchBinds).all());
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
      item.kills = numeric(row.kills); item.deaths = numeric(row.deaths); item.assists = numeric(row.assists); item.score = numeric(row.score);
      authoritativeCounters.kills += item.kills; authoritativeCounters.deaths += item.deaths; authoritativeCounters.assists += item.assists;
      modeAuthority.set(row.mode || 'unknown', item);
    }
    const authoritative = {
      matches: authoritativeMatches, completed: authoritativeCompleted, participants: authoritativeParticipants,
      humans: authoritativeHumans, bots: authoritativeBots, ...authoritativeCounters,
      modes: [...modeAuthority.values()],
    };
    return {
      from, to: now, sessions, nextCursor,
      players: players.map(row => ({
        id: row.player_key, label: playerLabel(row.player_key), sessions: numeric(row.sessions),
        playSeconds: numeric(row.play_seconds), firstSeenAt: iso(row.first_seen_at), lastSeenAt: iso(row.last_seen_at),
        returning: numeric(row.sessions) > 1,
      })),
      games: games.map(row => ({ id: row.id, label: row.label, starts: numeric(row.starts), players: numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score) })),
      modes: modes.map(row => ({ id: row.id, label: row.label, starts: numeric(row.starts), players: numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds), score: row.score == null ? null : numeric(row.score) })),
      daily: daily.map(row => ({ date: row.date, starts: numeric(row.starts), players: numeric(row.players), completions: numeric(row.completions), playSeconds: numeric(row.play_seconds) })),
      playersCount: numeric(aggregate.players),
      eventCount,
      performance: { fps: performance.fps == null ? null : Number(performance.fps), rttMs: performance.rtt_ms == null ? null : Number(performance.rtt_ms), loadMs: performance.load_ms == null ? null : Number(performance.load_ms) },
      aggregate: {
        starts: numeric(aggregate.starts), completions: numeric(aggregate.completions), abandoned: numeric(aggregate.abandoned),
        active: numeric(aggregate.active), serverVerified: numeric(aggregate.server_verified), playSeconds: numeric(aggregate.play_seconds),
        returningPlayers: numeric(returning.count),
      },
      trackingStartedAt: iso(firstSession.started_at),
      authoritative,
      funnel: [
        { stage: 'launches', count: numeric(aggregate.starts) },
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

export async function readGamingSession(env = {}, sessionId) {
  const db = dbFor(env);
  if (!db || !id(sessionId)) return null;
  const row = await db.prepare('SELECT * FROM gaming_sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
  if (!row) return null;
  const events = rowsFromResult(await db.prepare(`SELECT event_id, event_at, event_type, action, subject, details_json FROM gaming_events WHERE session_id = ? ORDER BY event_at ASC LIMIT ${MAX_TIMELINE_ROWS}`).bind(sessionId).all());
  const participants = rowsFromResult(await db.prepare(`SELECT participant_key, player_key, bot, kills, deaths, assists, score FROM gaming_participants WHERE match_id = ? ORDER BY bot ASC, id ASC`).bind(row.match_id || '').all());
  return {
    session: sessionResponse(row),
    timeline: events.map(item => ({ id: item.event_id, at: iso(item.event_at), kind: item.event_type, detail: item.details_json || item.action || item.subject || undefined })),
    participants: participants.map(item => ({ label: item.player_key ? playerLabel(item.player_key) : item.participant_key ? `PLAYER-${String(item.participant_key).slice(-8).toUpperCase()}` : 'BOT', bot: Boolean(item.bot), kills: item.kills == null ? undefined : Number(item.kills), deaths: item.deaths == null ? undefined : Number(item.deaths), assists: item.assists == null ? undefined : Number(item.assists), score: item.score == null ? undefined : Number(item.score) })),
  };
}

export async function readGamingPlayer(env = {}, playerId) {
  const db = dbFor(env);
  if (!db || !id(playerId)) return null;
  const rows = rowsFromResult(await db.prepare('SELECT * FROM gaming_sessions WHERE player_key = ? ORDER BY started_at DESC LIMIT 500').bind(playerId).all());
  if (!rows.length) return null;
  const sessions = rows.map(sessionResponse);
  return {
    player: { id: playerId, label: playerLabel(playerId), sessions: sessions.length, playSeconds: sessions.reduce((sum, row) => sum + (row.durationSeconds || 0), 0), firstSeenAt: sessions.at(-1).startedAt, lastSeenAt: sessions[0].lastSeenAt, returning: sessions.length > 1 },
    sessions,
  };
}

export async function runGamingMaintenance(env = {}, suppliedNow) {
  const db = dbFor(env);
  if (!db) return { unavailable: true, reason: 'Gaming database is unavailable' };
  const now = nowMs(env, suppliedNow);
  const rawCutoff = now - GAMING_RAW_RETENTION_MS;
  const dailyCutoff = dayKey(now - GAMING_SUMMARY_RETENTION_MS);
  try {
    const results = await executeBatch(db, [
      db.prepare('DELETE FROM gaming_events WHERE event_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_sessions WHERE started_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_participants WHERE match_id IN (SELECT id FROM gaming_matches WHERE started_at < ?)').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_matches WHERE started_at < ?').bind(rawCutoff),
      db.prepare('DELETE FROM gaming_daily WHERE day < ?').bind(dailyCutoff),
    ]);
    const daily = await db.prepare(`SELECT substr(datetime(started_at / 1000, 'unixepoch', '+8 hours'), 1, 10) AS day,
      game_id, COALESCE(mode, '') AS mode, COALESCE(transport, '') AS transport,
      COUNT(*) AS starts, COUNT(DISTINCT player_key) AS players,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completions,
      COALESCE(SUM(duration_seconds), 0) AS play_seconds
      FROM gaming_sessions WHERE started_at >= ? GROUP BY day, game_id, mode, transport`).bind(now - GAMING_SUMMARY_RETENTION_MS).all();
    for (const row of rowsFromResult(daily)) {
      await db.prepare(`INSERT INTO gaming_daily (day, game_id, mode, transport, starts, players, completions, play_seconds, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day, game_id, mode, transport) DO UPDATE SET starts=excluded.starts, players=excluded.players,
          completions=excluded.completions, play_seconds=excluded.play_seconds, updated_at=excluded.updated_at`)
        .bind(row.day, row.game_id, row.mode, row.transport, Number(row.starts || 0), Number(row.players || 0), Number(row.completions || 0), Number(row.play_seconds || 0), now).run();
    }
    return { raw_pruned: results.reduce((sum, item) => sum + resultChanges(item), 0), daily_rows: rowsFromResult(daily).length, raw_detail_cutoff: new Date(rawCutoff).toISOString(), summary_cutoff: dailyCutoff };
  } catch {
    return { unavailable: true, reason: 'Gaming maintenance failed' };
  }
}

export const GAMING_SCHEMA_TABLES = ['gaming_sessions', 'gaming_matches', 'gaming_participants', 'gaming_events', 'gaming_daily'];
