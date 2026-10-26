import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  ACTIVE_WINDOW_MS,
  EVENT_TYPES,
  estimateVisitorSketch,
  addVisitorToSketch,
  createVisitorSketch,
  handleAnalyticsRequest,
  importLegacyHistory,
  ingestEvents,
  recordShortlinkEvent,
  runAnalyticsMaintenance,
} from '../admin-analytics/index.js';

const schema = readFileSync(new URL('../admin-analytics/schema.sql', import.meta.url), 'utf8');
const now = Date.parse('2026-10-26T10:00:00.000Z');

class SQLiteStatement {
  constructor(statement) {
    this.statement = statement;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  all() {
    return { results: this.statement.all(...this.params) };
  }

  first() {
    return this.statement.get(...this.params) ?? null;
  }

  run() {
    return { success: true, meta: this.statement.run(...this.params) };
  }
}

class SQLiteD1 {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SQLiteStatement(this.database.prepare(sql));
  }

  batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(schema);
  return { database, d1: new SQLiteD1(database) };
}

function request(path, events, {
  host = 'www.akmalalif.com',
  token = 'test-gateway',
  meta = {
    ip: '203.0.113.8',
    userAgent: 'Mozilla/5.0',
    country: 'MY',
    region: '10',
    city: 'Kuala Lumpur',
    timezone: 'Asia/Kuala_Lumpur',
    latitude: 3.139,
    longitude: 101.6869,
    colo: 'KUL',
  },
  cookies = '',
} = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-portfolio-gateway': token,
    'x-portfolio-meta': JSON.stringify(meta),
  };
  if (cookies) {
    headers.Cookie = cookies;
  }
  return new Request('https://' + host + path, {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
  });
}

function environment(d1, extra = {}) {
  return {
    NEWadminD1: d1,
    PORTFOLIO_GATEWAY_TOKEN: 'test-gateway',
    ANALYTICS_ID_SECRET: 'test-id-secret',
    ANALYTICS_NOW: now,
    ...extra,
  };
}

test('schema creates prefixed raw, daily, and state tables', () => {
  const { database } = createDatabase();
  try {
    const names = database.prepare([
      'SELECT name FROM sqlite_master',
      "WHERE type = 'table' AND name LIKE 'portfolio_analytics_%'",
      'ORDER BY name',
    ].join('\n')).all().map((row) => row.name);
    assert.deepEqual(names, [
      'portfolio_analytics_daily',
      'portfolio_analytics_events',
      'portfolio_analytics_state',
    ]);
  } finally {
    database.close();
  }
});

test('ingestion normalizes, trusts gateway metadata, deduplicates atomically, and mirrors accepted rows', async () => {
  const { database, d1 } = createDatabase();
  const writes = [];
  try {
    const env = environment(d1, {
      PORTFOLIO_ANALYTICS: {
        writeDataPoint(point) {
          writes.push(point);
        },
      },
    });
    const events = [
      {
        id: 'evt-page',
        type: 'page_view',
        path: '/?password=discarded',
        referrer: 'https://ref.example.test/story?token=discarded',
        campaign: {
          utm_source: 'newsletter',
          utm_campaign: 'launch',
          password: 'must-not-store',
        },
      },
      {
        id: 'evt-article',
        type: 'article_progress',
        path: '/blog/hello?session=discarded',
        progress: 1.8,
        active_ms: 65000,
      },
    ];
    const first = await ingestEvents(request('/internal/events', events), env);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      accepted: 2,
      deduped: 0,
      server_time: '2026-10-26T10:00:00.000Z',
    });
    assert.match(first.headers.get('set-cookie') ?? '', /__Host-portfolio-visitor=/);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].indexes[0], 'page_view');
    assert.equal(writes[0].indexes.includes('203.0.113.8'), false);
    assert.equal(writes[0].indexes.includes('MY'), true);
    assert.match(writes[0].indexes[6], /^[0-9a-f]{8}$/);
    assert.equal(writes[0].blobs.some((value) => value.includes('Kuala Lumpur')), false);

    const stored = database.prepare([
      'SELECT event_id, path, progress, referrer, campaign_json, ip, user_agent,',
      '       country, region, city, latitude, longitude, event_at, is_bot',
      'FROM portfolio_analytics_events',
      'ORDER BY event_id',
    ].join('\n')).all();
    assert.equal(stored.length, 2);
    const page = stored.find((row) => row.event_id === 'evt-page');
    assert.deepEqual({
      path: page.path,
      progress: page.progress,
      campaign: JSON.parse(page.campaign_json),
      referrer: page.referrer,
      ip: page.ip,
      country: page.country,
      city: page.city,
      event_at: page.event_at,
      is_bot: page.is_bot,
    }, {
      path: '/',
      progress: null,
      campaign: { utm_source: 'newsletter', utm_campaign: 'launch' },
      referrer: 'https://ref.example.test/story',
      ip: '203.0.113.8',
      country: 'MY',
      city: 'Kuala Lumpur',
      event_at: now,
      is_bot: 0,
    });

    const duplicate = await ingestEvents(request('/internal/events', [events[0]]), env);
    assert.deepEqual(await duplicate.json(), {
      accepted: 0,
      deduped: 1,
      server_time: '2026-10-26T10:00:00.000Z',
    });
    assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 2);
    assert.equal(writes.length, 2);
  } finally {
    database.close();
  }
});

test('signed visitor and idle session cookies refresh without creating a pageview', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    const first = await ingestEvents(request('/internal/events', [
      { id: 'session-first', type: 'page_view', path: '/' },
    ]), env);
    const cookieHeader = first.headers.getSetCookie()
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    env.ANALYTICS_NOW = now + 5 * 60 * 1000;
    const second = await ingestEvents(request('/internal/events', [
      { id: 'session-heartbeat', type: 'heartbeat', path: '/', active_ms: 30000 },
    ], { cookies: cookieHeader }), env);
    assert.equal(second.status, 200);
    const rows = database.prepare([
      'SELECT event_type, visitor_key, session_key, session_started_at',
      'FROM portfolio_analytics_events ORDER BY event_id',
    ].join('\n')).all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].visitor_key, rows[1].visitor_key);
    assert.equal(rows[0].session_key, rows[1].session_key);
    assert.equal(rows[0].session_started_at, rows[1].session_started_at);
  } finally {
    database.close();
  }
});

test('ingestion rejects untrusted origins, gateway credentials, malformed metadata, and oversized batches', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    assert.equal((await ingestEvents(request('/internal/events', [], { host: 'preview.example.test' }), env)).status, 403);
    assert.equal((await ingestEvents(request('/internal/events', [], { token: 'wrong' }), env)).status, 401);
    const missingMeta = new Request('https://www.akmalalif.com/internal/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-portfolio-gateway': 'test-gateway',
      },
      body: JSON.stringify({ events: [] }),
    });
    assert.equal((await ingestEvents(missingMeta, env)).status, 400);
    const oversized = await ingestEvents(request('/internal/events', Array.from({ length: 21 }, (_, index) => ({
      id: 'too-many-' + index,
      type: 'page_view',
      path: '/',
    }))), env);
    assert.equal(oversized.status, 413);
    assert.equal(EVENT_TYPES.has('article_complete'), true);
    assert.equal(ACTIVE_WINDOW_MS, 300000);
  } finally {
    database.close();
  }
});

test('reports expose deterministic overview, content, conversions, realtime, and explicit performance availability', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    await ingestEvents(request('/internal/events', [
      { id: 'overview-page', type: 'page_view', path: '/' },
      { id: 'overview-article', type: 'article_complete', path: '/blog/hello', active_ms: 30000 },
      { id: 'overview-contact', type: 'contact_open', path: '/contact' },
    ]), env);
    const overviewResponse = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=24h'),
      env,
    );
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.equal(overview.meta.timezone, 'Asia/Kuala_Lumpur');
    assert.equal(overview.meta.coverage.has_data, true);
    assert.equal(overview.meta.detail, 'raw_90_day_events');
    assert.equal(overview.data.events, 3);
    assert.equal(overview.data.page_views, 1);
    assert.equal(overview.data.goals.find((goal) => goal.id === 'career_contact').conversions, 1);

    const content = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/content?range=24h'),
      env,
    );
    assert.deepEqual((await content.json()).data.content[0], {
      path: '/blog/hello',
      views: 0,
      progress_events: 0,
      average_progress: null,
      completions: 1,
      active_ms: 30000,
    });

    const realtime = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/realtime?range=24h'),
      env,
    );
    const realtimeData = await realtime.json();
    assert.equal(realtimeData.data.events.length, 3);
    assert.equal(realtimeData.data.events[0].timestamp, '2026-10-26T10:00:00.000Z');

    const performance = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/performance?range=24h'),
      env,
    );
    const performanceData = await performance.json();
    assert.equal(performance.status, 200);
    assert.equal(performanceData.meta.coverage.unavailable, true);
    assert.equal(performanceData.data.cloudflare, null);
  } finally {
    database.close();
  }
});

test('Sink events feed shortlink goals and remain source-labelled', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    const first = await recordShortlinkEvent({
      id: 'sink-click-1',
      slug: 'cv',
      campaign: { utm_source: 'linkedin', utm_campaign: 'career' },
      ip: '198.51.100.4',
      userAgent: 'Sink redirect',
    }, env);
    const second = await recordShortlinkEvent({
      id: 'sink-click-1',
      slug: 'cv',
      campaign: { utm_source: 'linkedin', utm_campaign: 'career' },
    }, env);
    assert.equal(first.accepted, 1);
    assert.equal(second.deduped, 1);
    assert.equal(database.prepare("SELECT source, shortlink_slug, ip FROM portfolio_analytics_events WHERE source = 'sink'").get().shortlink_slug, 'cv');

    const retryPayload = { slug: 'docs', target: '/docs', occurred_at: '2026-10-26T10:00:00.000Z' };
    const retry = await recordShortlinkEvent(retryPayload, env);
    const retryAgain = await recordShortlinkEvent(retryPayload, env);
    assert.equal(retry.accepted, 1);
    assert.equal(retryAgain.deduped, 1);
    assert.equal(retryAgain.event_id, retry.event_id);

    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/conversions?range=24h'),
      env,
    );
    const result = await response.json();
    assert.equal(result.data.shortlink_campaigns[0].slug, 'cv');
    assert.equal(result.data.goals.find((goal) => goal.id === 'shortlink_campaigns').conversions, 2);
  } finally {
    database.close();
  }
});

test('legacy import is idempotent, explicitly labelled, and excluded from new counts', async () => {
  const { database, d1 } = createDatabase();
  const legacyDatabase = new DatabaseSync(':memory:');
  legacyDatabase.exec([
    'CREATE TABLE profile_page_events (',
    'id INTEGER PRIMARY KEY,',
    'page_path TEXT NOT NULL,',
    'referrer TEXT,',
    'user_agent TEXT,',
    'created_at TEXT NOT NULL',
    ')',
  ].join('\n'));
  legacyDatabase.prepare([
    'INSERT INTO profile_page_events (id, page_path, referrer, user_agent, created_at)',
    'VALUES (?, ?, ?, ?, ?)',
  ].join('\n')).run(7, '/legacy', null, 'legacy browser', '2026-10-25T10:00:00.000Z');

  try {
    const env = environment(d1, { PORTFOLIO_DB: new SQLiteD1(legacyDatabase) });
    const first = await importLegacyHistory(env);
    const second = await importLegacyHistory(env);
    assert.equal(first.imported, 1);
    assert.equal(second.deduped, 1);
    assert.equal(database.prepare("SELECT source, visitor_key, session_key FROM portfolio_analytics_events WHERE source = 'legacy_page_event'").get().source, 'legacy_page_event');

    const report = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=7d'),
      env,
    );
    assert.equal((await report.json()).data.events, 0);
  } finally {
    database.close();
    legacyDatabase.close();
  }
});

test('maintenance recomputes mergeable daily sketches and prunes raw detail idempotently', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    await ingestEvents(request('/internal/events', [
      { id: 'maintenance-current', type: 'page_view', path: '/' },
    ]), env);
    database.prepare([
      'INSERT INTO portfolio_analytics_events (',
      'event_id, event_type, path, source, event_at, received_at, is_bot',
      ') VALUES (?, ?, ?, ?, ?, ?, ?)',
    ].join('\n')).run('maintenance-old', 'page_view', '/old', 'portfolio', now - (91 * 24 * 60 * 60 * 1000), now, 0);

    const result = await runAnalyticsMaintenance(env);
    assert.equal(result.daily_rows > 0, true);
    assert.equal(database.prepare("SELECT count(*) AS count FROM portfolio_analytics_events WHERE event_id = 'maintenance-old'").get().count, 0);
    const daily = database.prepare([
      "SELECT day, event_count, visitor_hll FROM portfolio_analytics_daily",
      "WHERE dimension = 'all' AND source = 'portfolio' ORDER BY day ASC",
    ].join('\n')).all();
    assert.equal(daily.length, 2);
    assert.equal(daily[0].event_count, 1);
    assert.equal(daily[1].event_count, 1);
    assert.equal(daily[0].visitor_hll.length, 128);
    assert.equal(daily[1].visitor_hll.length, 128);

    const dailyCount = database.prepare('SELECT count(*) AS count FROM portfolio_analytics_daily').get().count;
    const again = await runAnalyticsMaintenance(env);
    assert.equal(again.daily_rows < result.daily_rows, true);
    assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_daily').get().count, dailyCount);
  } finally {
    database.close();
  }
});

test('visitor sketches merge without exposing identifiers', () => {
  const first = createVisitorSketch();
  const second = createVisitorSketch();
  addVisitorToSketch(first, 'visitor-a');
  addVisitorToSketch(first, 'visitor-b');
  addVisitorToSketch(second, 'visitor-b');
  addVisitorToSketch(second, 'visitor-c');
  const estimate = estimateVisitorSketch(first);
  assert.equal(estimate > 0, true);
  for (let index = 0; index < second.length; index += 1) {
    first[index] = Math.max(first[index], second[index]);
  }
  assert.equal(estimateVisitorSketch(first) >= estimate, true);
});
