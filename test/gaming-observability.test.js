import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ingestEvents,
  runGamingMaintenance,
} from '../admin-analytics/index.js';
import {
  ingestGamingSummary,
  normalizeGamingEvent,
  readGamingData,
} from '../admin-analytics/gaming.js';
import { createGamingAnalytics } from '../js/gaming-analytics.js';
import { createAnalyticsClient } from '../js/analytics.js';
import { issueCorrelationToken } from '../worker/exepert/telemetry.js';

const schema = readFileSync(new URL('../admin-analytics/schema.sql', import.meta.url), 'utf8');
const now = Date.parse('2026-10-31T00:00:00.000Z');

class Statement {
  constructor(statement) { this.statement = statement; this.params = []; }
  bind(...params) { this.params = params; return this; }
  all() { return { results: this.statement.all(...this.params) }; }
  first() { return this.statement.get(...this.params) ?? null; }
  run() { return { meta: this.statement.run(...this.params) }; }
}

class D1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new Statement(this.database.prepare(sql)); }
  batch(statements) {
    this.database.exec('BEGIN');
    try {
      const result = statements.map(statement => statement.run());
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function environment() {
  const database = new DatabaseSync(':memory:');
  database.exec(schema);
  return {
    database,
    env: {
      DB: new D1(database),
      ANALYTICS_ID_SECRET: 'test-identity-secret',
      PORTFOLIO_GATEWAY_TOKEN: 'test-gateway-secret',
      ANALYTICS_NOW: now,
    },
  };
}

function eventRequest(events, cookies = '') {
  return new Request('https://www.akmalalif.com/internal/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Portfolio-Gateway': 'test-gateway-secret',
      'X-Portfolio-Meta': JSON.stringify({ ip: '203.0.113.8', userAgent: 'Mozilla/5.0', country: 'MY', colo: 'KUL' }),
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({ events }),
  });
}

function responseCookies(response) {
  return (response.headers.getSetCookie?.() || [])
    .map(cookie => cookie.split(';', 1)[0])
    .join('; ');
}

test('gaming lifecycle events are segregated, deduplicated, and keep website counts unchanged', async () => {
  const { database, env } = environment();
  const response = await ingestEvents(eventRequest([
    { id: 'web-1', type: 'page_view', path: '/contact/' },
    { id: 'game-1', type: 'gaming_session_start', path: '/contact/', game_id: 'relay-run', run_id: 'run-1', transport: 'handheld' },
  ]), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: 2, deduped: 0, server_time: new Date(now).toISOString() });
  assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_events').get().count, 1);
  const stableCookies = (response.headers.getSetCookie?.() || []).map(cookie => cookie.split(';', 1)[0]).join('; ');
  assert.ok(stableCookies.includes('__Host-portfolio-visitor='));
  assert.ok(stableCookies.includes('__Host-portfolio-session='));
  const active = await ingestEvents(eventRequest([
    { id: 'game-heartbeat-1', type: 'gaming_session_heartbeat', path: '/contact/', game_id: 'relay-run', run_id: 'run-1', active_ms: 5_000 },
    { id: 'game-heartbeat-2', type: 'gaming_session_heartbeat', path: '/contact/', game_id: 'relay-run', run_id: 'run-1', active_ms: 7_000 },
  ], stableCookies), env);
  assert.deepEqual(await active.json(), { accepted: 2, deduped: 0, server_time: new Date(now).toISOString() });
  assert.equal(database.prepare('SELECT duration_seconds AS duration FROM gaming_sessions').get().duration, 12);
  const duplicate = await ingestEvents(eventRequest([{ id: 'game-1', type: 'gaming_session_start', path: '/contact/', game_id: 'relay-run', run_id: 'run-1' }], stableCookies), env);
  assert.deepEqual(await duplicate.json(), { accepted: 0, deduped: 1, server_time: new Date(now).toISOString() });
  assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 1);
});

test('identity links require a server-issued token and never turn browser results into verified results', async () => {
  const { database, env } = environment();
  const token = await issueCorrelationToken(env, 'match-identity', '1', now + 3600_000);
  assert.ok(token);
  const valid = await ingestEvents(eventRequest([
    { id: 'link-1', type: 'gaming_identity_link', path: '/video-games/exepert/', game_id: 'exepert', run_id: 'run-identity', match_id: 'match-identity', correlation_token: token },
    { id: 'result-1', type: 'gaming_client_result', path: '/video-games/exepert/', game_id: 'exepert', run_id: 'run-identity', match_id: 'match-identity', status: 'completed', score: 999 },
  ], '__Host-portfolio-visitor=v; __Host-portfolio-session=s'), env);
  assert.equal(valid.status, 200);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_events').get().count, 2);
  const identitySession = database.prepare('SELECT id, verification FROM gaming_sessions').get();
  assert.ok(identitySession.id.startsWith('s_'));
  assert.equal(identitySession.verification, 'client_reported');
  const forged = await ingestEvents(eventRequest([
    { id: 'forged-1', type: 'gaming_identity_link', path: '/video-games/exepert/', game_id: 'exepert', run_id: 'run-forged', correlation_token: 'v1.gaming.match-identity.1.9999999999999.' + '0'.repeat(64) },
  ]), env);
  assert.deepEqual(await forged.json(), { accepted: 0, deduped: 1, server_time: new Date(now).toISOString() });
});

test('authoritative summaries count one match and separate participants across all EXEPERT modes', async () => {
  const { database, env } = environment();
  for (const [index, mode] of ['tdm', 'uplink', 'extraction'].entries()) {
    const result = await ingestGamingSummary({
      source: 'exepert-room', match_id: `match-${mode}`, game_id: 'exepert', mode, sector: mode === 'tdm' ? 'bastion' : 'full',
      started_at: now - 30_000, ended_at: now, status: 'completed', result: { winner: index, reason: 'TIME', bank: mode === 'extraction' ? [120, 80] : undefined },
      participants: Array.from({ length: 8 }, (_, participant) => ({ participant_id: String(participant + 1), bot: participant > 3, kills: participant, deaths: 1, assists: 2, score: participant * 100 })),
    }, env, now);
    assert.equal(result.accepted, 1);
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_matches').get().count, 3);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_participants').get().count, 24);
  assert.equal(database.prepare("SELECT count(*) AS count FROM gaming_matches WHERE verification = 'server_verified'").get().count, 3);
  assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 0);
  const report = await readGamingData(env, { rangeDays:90, now });
  assert.equal(report.authoritative.matches, 3);
  assert.equal(report.authoritative.participants, 24);
});

test('gaming maintenance prunes raw timeline while retaining bounded daily summaries', async () => {
  const { database, env } = environment();
  const old = now - 91 * 24 * 3600_000;
  const event = normalizeGamingEvent({ id: 'old-game', type: 'gaming_session_start', path: '/video-games/relay/', game_id: 'relay-run', run_id: 'old-run' });
  await (await import('../admin-analytics/gaming.js')).ingestGamingEvents([event], { ...env, GAMING_NOW: old }, { visitorKey: 'old-v', sessionKey: 'old-s' }, old);
  const current = normalizeGamingEvent({ id: 'new-game', type: 'gaming_session_start', path: '/video-games/relay/', game_id: 'relay-run', run_id: 'new-run' });
  await (await import('../admin-analytics/gaming.js')).ingestGamingEvents([current], env, { visitorKey: 'new-v', sessionKey: 'new-s' }, now);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_events').get().count, 2);
  await runGamingMaintenance(env, now);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_events').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_daily').get().count, 1);
  const report = await readGamingData(env, { rangeDays: 90, now });
  assert.equal(report.sessions.length, 1);
  assert.ok(report.sessions[0].id.startsWith('s_'));
});

test('authoritative room summaries backfill early links and protect verified results from later browser retries', async () => {
  const { database, env } = environment();
  const token = await issueCorrelationToken(env, 'match-backfill', '1', now + 3600_000);
  const link = await ingestEvents(eventRequest([{
    id: 'backfill-link', type: 'gaming_identity_link', path: '/video-games/exepert/', game_id: 'exepert',
    run_id: 'backfill-run', match_id: 'match-backfill', correlation_token: token,
  }]), env);
  assert.equal(link.status, 200);
  const cookies = responseCookies(link);
  assert.ok(cookies.includes('__Host-portfolio-visitor='));
  assert.ok(cookies.includes('__Host-portfolio-session='));
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_sessions').get().count, 1);
  const summary = await ingestGamingSummary({
    source: 'exepert-room', match_id: 'match-backfill', game_id: 'exepert', mode: 'uplink', sector: 'full',
    started_at: now - 10_000, ended_at: now, status: 'completed', result: { winner: 0, captures: 3, contests: 2 },
    participants: [{ participant_id: '1', correlation_token: token, bot: false, kills: 4, deaths: 1, assists: 2, score: 450 }],
  }, env, now);
  assert.equal(summary.accepted, 1);
  const participant = database.prepare('SELECT player_key, linked_session_id FROM gaming_participants WHERE match_id = ?').get('match-backfill');
  assert.ok(participant.player_key);
  assert.ok(participant.linked_session_id);
  const verified = database.prepare('SELECT verification, score, kills, deaths, assists FROM gaming_sessions WHERE id = ?').get(participant.linked_session_id);
  assert.equal(verified.verification, 'server_verified');
  assert.equal(verified.score, 450);
  assert.equal(verified.kills, 4);
  assert.equal(verified.deaths, 1);
  assert.equal(verified.assists, 2);
  const browserEnd = await ingestEvents(eventRequest([{
    id: 'backfill-end', type: 'gaming_session_end', path: '/video-games/exepert/', game_id: 'exepert',
    run_id: 'backfill-run', match_id: 'match-backfill', status: 'abandoned', score: 999, kills: 99, deaths: 99, assists: 99,
  }], cookies), env);
  assert.equal(browserEnd.status, 200);
  const stillVerified = database.prepare('SELECT verification, score, kills, deaths, assists, status FROM gaming_sessions WHERE id = ?').get(participant.linked_session_id);
  assert.equal(stillVerified.verification, 'server_verified');
  assert.equal(stillVerified.score, 450);
  assert.equal(stillVerified.kills, 4);
  assert.equal(stillVerified.deaths, 1);
  assert.equal(stillVerified.assists, 2);
  assert.equal(stillVerified.status, 'completed');
  assert.equal(database.prepare('SELECT count(*) AS count FROM gaming_sessions').get().count, 1);
});

test('report aggregates cover all sessions while the session list stays cursor paginated', async () => {
  const { database, env } = environment();
  const insert = database.prepare(`INSERT INTO gaming_sessions
    (id, player_key, session_key, game_id, mode, sector, transport, started_at, last_seen_at, status, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let index = 0; index < 1_005; index += 1) {
    const started = now - index * 1_000;
    insert.run(`session-${index}`, `player-${index % 10}`, null, 'relay-run', 'endless', null, 'handheld', started, started + 500, index % 4 === 0 ? 'completed' : 'abandoned', 1);
  }
  const first = await readGamingData(env, { rangeDays:90, now });
  assert.equal(first.aggregate.starts, 1_005);
  assert.equal(first.aggregate.returningPlayers, 10);
  assert.equal(first.sessions.length, 1_000);
  assert.ok(first.nextCursor);
  assert.equal(first.games[0].starts, 1_005);
  const second = await readGamingData(env, { rangeDays:90, now, cursor:first.nextCursor });
  assert.equal(second.sessions.length, 5);
  assert.equal(second.nextCursor, null);
});

test('identity links that arrive after an authoritative summary promote the linked session', async () => {
  const { database, env } = environment();
  const token = await issueCorrelationToken(env, 'match-forward-link', '1', now + 3600_000);
  const summary = await ingestGamingSummary({
    source: 'exepert-room', match_id: 'match-forward-link', game_id: 'exepert', mode: 'tdm', sector: 'bastion',
    started_at: now - 10_000, ended_at: now, status: 'completed', result: { winner: 0 },
    participants: [{ participant_id: '1', correlation_token: token, bot: false, kills: 7, deaths: 2, assists: 1, score: 700 }],
  }, env, now);
  assert.equal(summary.accepted, 1);
  const linked = await ingestEvents(eventRequest([{
    id: 'forward-link', type: 'gaming_identity_link', path: '/video-games/exepert/', game_id: 'exepert',
    run_id: 'forward-run', correlation_token: token,
  }], '__Host-portfolio-visitor=v; __Host-portfolio-session=s'), env);
  assert.equal(linked.status, 200);
  const participant = database.prepare('SELECT player_key, linked_session_id FROM gaming_participants WHERE match_id = ?').get('match-forward-link');
  assert.ok(participant.player_key);
  assert.ok(participant.linked_session_id);
  const session = database.prepare('SELECT verification, match_id, status, score, kills, deaths, assists FROM gaming_sessions WHERE id = ?').get(participant.linked_session_id);
  assert.deepEqual({ ...session }, {
    verification: 'server_verified', match_id: 'match-forward-link', status: 'completed',
    score: 700, kills: 7, deaths: 2, assists: 1,
  });
});

test('GPC and DNT opt out before any gaming event can enter the shared queue', () => {
  const events = [];
  const windowRef = { location:{ hostname:'www.akmalalif.com', pathname:'/video-games/exepert/', href:'https://www.akmalalif.com/video-games/exepert/' }, addEventListener(){}, removeEventListener(){} };
  const documentRef = { visibilityState:'visible', addEventListener(){}, removeEventListener(){} };
  const optedOut = createAnalyticsClient({ windowRef, documentRef, navigatorRef:{ globalPrivacyControl:true }, forceEnabled:true, fetchImpl:async () => ({ ok:true, status:204 }) });
  assert.equal(optedOut.getState().enabled, false);
  const dnt = createAnalyticsClient({ windowRef, documentRef, navigatorRef:{ doNotTrack:'1' }, forceEnabled:true, fetchImpl:async () => ({ ok:true, status:204 }) });
  assert.equal(dnt.getState().enabled, false);
  const facade = createGamingAnalytics({
    analytics:{ track:(type, fields) => { events.push({ type, fields }); }, flush:async () => true },
    gameId:'relay-run', runId:'run-optout', autoStart:false,
  });
  facade.start({ transport:'handheld' });
  facade.interaction('start');
  facade.end({ status:'abandoned' });
  assert.deepEqual(events.map(event => event.type), ['gaming_session_start', 'gaming_interaction', 'gaming_session_end']);
  assert.equal(events.some(event => event.fields.position || event.fields.frame || event.fields.shot), false);
});

test('gaming performance leaves missing measurements unavailable instead of recording zero', () => {
  const events = [];
  const facade = createGamingAnalytics({
    analytics: { track: (type, fields) => { events.push({ type, fields }); }, flush: async () => true },
    gameId: 'exepert', runId: 'run-performance', autoStart: false,
  });
  facade.start();
  facade.performance({ fps: 60 });
  facade.end();
  const performance = events.find(event => event.type === 'gaming_performance');
  assert.equal(performance.fields.fps, 60);
  assert.equal(performance.fields.rtt_ms, null);
  assert.equal(performance.fields.load_ms, null);
  const normalized = normalizeGamingEvent({
    id: 'performance-1', type: 'gaming_performance', game_id: 'exepert', run_id: 'run-performance',
    fps: 60, rtt_ms: null, load_ms: null,
  });
  assert.equal(normalized.fps, 60);
  assert.equal(normalized.rttMs, null);
  assert.equal(normalized.loadMs, null);
  assert.equal(normalizeGamingEvent({
    id: 'forged-status', type: 'gaming_session_end', game_id: 'exepert', run_id: 'run-performance', status: 'server_verified',
  }).status, null);
});

test('gaming sessions count visible play time and flush when the tab hides', () => {
  let clock = 1_000;
  let flushes = 0;
  const listeners = new Map();
  const documentRef = {
    visibilityState: 'visible',
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
  };
  const events = [];
  const facade = createGamingAnalytics({
    analytics: { track: (type, fields) => { events.push({ type, fields }); }, flush: async () => { flushes += 1; } },
    documentRef, gameId: 'relay-run', runId: 'run-active-time', autoStart: false, now: () => clock,
  });
  facade.start();
  clock = 4_000;
  facade.heartbeat();
  documentRef.visibilityState = 'hidden';
  listeners.get('visibilitychange')();
  clock = 9_000;
  documentRef.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  clock = 10_000;
  facade.end();
  const end = events.find(event => event.type === 'gaming_session_end');
  assert.equal(end.fields.duration_ms, 4_000);
  assert.ok(flushes >= 2);
});

test('a reported client result keeps a later page exit from rewriting completion', () => {
  const events = [];
  const facade = createGamingAnalytics({
    analytics: { track: (type, fields) => { events.push({ type, fields }); }, flush: async () => true },
    gameId: 'exepert', runId: 'run-result-exit', autoStart: false,
  });
  facade.start();
  facade.result({ status: 'completed', score: 10 });
  facade.end({ status: 'abandoned', reason: 'leave' });
  assert.equal(events.find(event => event.type === 'gaming_session_end').fields.status, 'completed');
});
