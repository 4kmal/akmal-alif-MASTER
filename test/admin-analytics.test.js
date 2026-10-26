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

function insertAnalyticsEvent(database, {
  id,
  type,
  path,
  target = null,
  referrer = null,
  eventAt = now,
  visitor = null,
  session = null,
  userAgent = null,
  source = 'portfolio',
}) {
  database.prepare([
    'INSERT INTO portfolio_analytics_events (',
    'event_id, event_type, path, target, referrer, source, event_at, received_at,',
    'visitor_key, session_key, user_agent, is_bot',
    ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
  ].join('\n')).run(
    id,
    type,
    path,
    target,
    referrer,
    source,
    eventAt,
    eventAt,
    visitor,
    session,
    userAgent,
  );
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
    assert.equal(database.prepare("SELECT count(*) AS count FROM pragma_table_info('portfolio_analytics_daily') WHERE name = 'session_hll'").get().count, 1);
  } finally {
    database.close();
  }
});

test('ingestion normalizes, trusts gateway metadata, deduplicates atomically, and mirrors accepted rows', async () => {
  const { database, d1 } = createDatabase();
  const writes = [];
  const nativeWrites = [];
  try {
    const env = environment(d1, {
      PORTFOLIO_ANALYTICS: {
        writeDataPoint(point) {
          writes.push(point);
        },
      },
      ANALYTICS: {
        writeDataPoint(point) {
          nativeWrites.push(point);
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
        progress: 101,
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
    assert.equal(nativeWrites.length, 0);
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
    const article = stored.find((row) => row.event_id === 'evt-article');
    assert.equal(article.progress, 100);
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
    assert.equal(nativeWrites.length, 0);
  } finally {
    database.close();
  }
});

test('history exposes bounded raw detail with stable cursors while reports and AE stay redacted', async () => {
  const { database, d1 } = createDatabase();
  const portfolioWrites = [];
  const nativeWrites = [];
  try {
    const env = environment(d1, {
      PORTFOLIO_ANALYTICS: {
        writeDataPoint(point) {
          portfolioWrites.push(point);
        },
      },
      ANALYTICS: {
        writeDataPoint(point) {
          nativeWrites.push(point);
        },
      },
    });
    const first = await ingestEvents(request('/internal/events', [
      { id: 'history-a', type: 'page_view', path: '/' },
      { id: 'history-b', type: 'article_progress', path: '/blog/story', progress: 50 },
    ]), env);
    assert.equal(first.status, 200);

    const page = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/history?range=24h&limit=1'),
      env,
    );
    const pageData = await page.json();
    assert.equal(page.status, 200);
    assert.equal(pageData.data.events.length, 1);
    assert.equal(pageData.data.has_more, true);
    assert.deepEqual({
      ip: pageData.data.events[0].ip,
      user_agent: pageData.data.events[0].user_agent,
      country: pageData.data.events[0].country,
      region: pageData.data.events[0].region,
      city: pageData.data.events[0].city,
      latitude: pageData.data.events[0].latitude,
      longitude: pageData.data.events[0].longitude,
      source: pageData.data.events[0].source,
      event_at: pageData.data.events[0].event_at,
    }, {
      ip: '203.0.113.8',
      user_agent: 'Mozilla/5.0',
      country: 'MY',
      region: '10',
      city: 'Kuala Lumpur',
      latitude: 3.139,
      longitude: 101.6869,
      source: 'portfolio',
      event_at: '2026-10-26T10:00:00.000Z',
    });
    assert.match(pageData.data.next_cursor, /^[A-Za-z0-9_-]+$/);

    const filtered = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/history?range=24h&source=portfolio&event_type=article_progress&path=%2Fblog%2Fstory'),
      env,
    );
    const filteredData = await filtered.json();
    assert.equal(filtered.status, 200);
    assert.deepEqual(filteredData.data.events.map((event) => event.event_id), ['history-b']);

    env.ANALYTICS_NOW = now + 1_000;
    const next = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/history?range=24h&limit=1&cursor=' + encodeURIComponent(pageData.data.next_cursor)),
      env,
    );
    const nextData = await next.json();
    assert.equal(next.status, 200);
    assert.equal(nextData.data.events.length, 1);
    assert.notEqual(nextData.data.events[0].event_id, pageData.data.events[0].event_id);
    assert.equal(nextData.data.has_more, false);

    const csv = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/history?range=24h&limit=2&format=csv'),
      env,
    );
    const csvText = await csv.text();
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(csvText, /event_id,.*user_agent/);
    assert.match(csvText, /203\.0\.113\.8/);
    assert.match(csvText, /Mozilla\/5\.0/);

    const tooOld = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/history?from=' + encodeURIComponent(new Date(now - (91 * 24 * 60 * 60 * 1000)).toISOString()) + '&to=' + encodeURIComponent(new Date(now).toISOString())),
      env,
    );
    assert.equal(tooOld.status, 416);

    for (const route of ['overview', 'traffic', 'realtime']) {
      const response = await handleAnalyticsRequest(
        new Request('https://www.akmalalif.com/api/portfolio/' + route + '?range=24h'),
        env,
      );
      const body = await response.text();
      assert.equal(body.includes('203.0.113.8'), false, route);
      assert.equal(body.includes('Mozilla/5.0'), false, route);
      assert.equal(body.includes('Kuala Lumpur'), false, route);
      assert.equal(body.includes('3.139'), false, route);
    }
    assert.equal(nativeWrites.length, 0);
    assert.equal(portfolioWrites.some((point) => JSON.stringify(point).includes('203.0.113.8')), false);
    assert.equal(portfolioWrites.some((point) => JSON.stringify(point).includes('Mozilla/5.0')), false);
    assert.equal(portfolioWrites.some((point) => JSON.stringify(point).includes('Kuala Lumpur')), false);
    assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 2);
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
    const localDisabled = { ...env, ALLOW_LOCAL_ANALYTICS: 'false', PORTFOLIO_GATEWAY_TOKEN: null };
    assert.equal((await ingestEvents(request('/internal/events', [], { host: 'localhost' }), localDisabled)).status, 403);
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

test('uses the production DB binding alias and fails closed without identity signing', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(undefined, { DB: d1 });
    delete env.NEWadminD1;
    const accepted = await ingestEvents(request('/internal/events', [
      { id: 'db-alias-event', type: 'page_view', path: '/' },
    ]), env);
    assert.equal(accepted.status, 200);
    assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 1);

    const missingSecret = { ...env };
    delete missingSecret.ANALYTICS_ID_SECRET;
    const rejected = await ingestEvents(request('/internal/events', [
      { id: 'unsigned-event', type: 'page_view', path: '/' },
    ]), missingSecret);
    assert.equal(rejected.status, 503);
    assert.deepEqual(await rejected.json(), {
      error: 'Analytics identity signing is unavailable',
      meta: {
        source: 'portfolio_analytics',
        coverage: {
          unavailable: true,
          identities_unavailable: true,
        },
      },
    });
    assert.equal(database.prepare('SELECT count(*) AS count FROM portfolio_analytics_events').get().count, 1);
  } finally {
    database.close();
  }
});

test('preserves missing trusted coordinates as unknown values', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    const response = await ingestEvents(request('/internal/events', [
      { id: 'missing-coordinates', type: 'page_view', path: '/' },
    ], {
      meta: {
        ip: '203.0.113.8',
        userAgent: 'Mozilla/5.0',
        country: 'MY',
        region: '10',
        city: 'Kuala Lumpur',
        timezone: 'Asia/Kuala_Lumpur',
        latitude: null,
        longitude: '',
        colo: 'KUL',
      },
    }), env);
    assert.equal(response.status, 200);
    const row = database.prepare([
      'SELECT latitude, longitude FROM portfolio_analytics_events',
    ].join('\n')).get();
    assert.equal(row.latitude, null);
    assert.equal(row.longitude, null);
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
      { id: 'overview-contact-interaction', type: 'contact_interaction', path: '/contact', target: '#form' },
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
    assert.equal(overview.data.events, 4);
    assert.equal(overview.data.page_views, 1);
    const contactGoal = overview.data.goals.find((goal) => goal.id === 'career_contact');
    assert.equal(contactGoal.label, 'Contact intent');
    assert.equal(contactGoal.conversions, 1);
    assert.equal(contactGoal.denominator_sessions, 1);
    assert.equal(contactGoal.conversion_rate, 1);

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
    assert.equal(realtimeData.data.events.length, 4);
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

test('traffic adds trusted audience buckets, session landing and exit pages, and path period changes', async () => {
  const { database, d1 } = createDatabase();
  try {
    insertAnalyticsEvent(database, {
      id: 'traffic-home',
      type: 'page_view',
      path: '/',
      visitor: 'visitor-1',
      session: 'session-1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      eventAt: now - 10_000,
    });
    insertAnalyticsEvent(database, {
      id: 'traffic-linkedin',
      type: 'outbound_click',
      path: '/work',
      target: 'https://www.linkedin.com/in/akmal',
      visitor: 'visitor-1',
      session: 'session-1',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      eventAt: now - 9_000,
    });
    insertAnalyticsEvent(database, {
      id: 'traffic-blog',
      type: 'page_view',
      path: '/blog/hello',
      visitor: 'visitor-2',
      session: 'session-2',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36',
      eventAt: now - 8_000,
    });
    insertAnalyticsEvent(database, {
      id: 'traffic-download',
      type: 'download_start',
      path: '/resume',
      target: '/assets/resume.pdf',
      visitor: 'visitor-2',
      session: 'session-2',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36',
      eventAt: now - 7_000,
    });
    insertAnalyticsEvent(database, {
      id: 'traffic-prior-home',
      type: 'page_view',
      path: '/',
      visitor: 'visitor-old',
      session: 'session-old',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0',
      eventAt: now - 25 * 60 * 60 * 1000,
    });
    insertAnalyticsEvent(database, {
      id: 'traffic-prior-old',
      type: 'page_view',
      path: '/old',
      visitor: 'visitor-old',
      session: 'session-old',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0',
      eventAt: now - 25 * 60 * 60 * 1000 + 1,
    });

    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/traffic?range=24h'),
      environment(d1),
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.devices.find((item) => item.device === 'mobile').count, 2);
    assert.equal(result.data.browsers.find((item) => item.browser === 'Chrome').count, 2);
    assert.equal(result.data.operating_systems.find((item) => item.operating_system === 'iOS').count, 2);
    assert.equal(result.data.landing_pages.find((item) => item.path === '/')?.count, 1);
    assert.equal(result.data.exit_pages.find((item) => item.path === '/blog/hello')?.count, 1);
    assert.equal(result.data.paths.find((item) => item.path === '/')?.trend, 'flat');
    assert.equal(result.data.paths.find((item) => item.path === '/old')?.trend, 'falling');
    const linkedin = (await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/conversions?range=24h'),
      environment(d1),
    )).json();
    const goals = (await linkedin).data.goals;
    const linkedinGoal = goals.find((goal) => goal.id === 'linkedin');
    const downloadGoal = goals.find((goal) => goal.id === 'download');
    assert.equal(linkedinGoal.conversions, 1);
    assert.equal(linkedinGoal.denominator_sessions, 2);
    assert.equal(linkedinGoal.conversion_rate, 0.5);
    assert.equal(downloadGoal.conversions, 1);
    assert.equal(downloadGoal.denominator_label, 'website_sessions');
  } finally {
    database.close();
  }
});

test('content report joins published portfolio metadata for page and category comparisons', async () => {
  const { database, d1 } = createDatabase();
  const catalogDatabase = new DatabaseSync(':memory:');
  const catalog = new SQLiteD1(catalogDatabase);
  catalogDatabase.exec([
    'CREATE TABLE blog_categories (id TEXT PRIMARY KEY, slug TEXT, name TEXT);',
    'CREATE TABLE blog_posts (slug TEXT PRIMARY KEY, title TEXT, canonical_path TEXT, category_id TEXT, status TEXT, published_at TEXT);',
    "INSERT INTO blog_categories VALUES ('cat-ml', 'machine-learning', 'Machine Learning');",
    "INSERT INTO blog_posts VALUES ('hello', 'Hello article', NULL, 'cat-ml', 'published', '2026-10-01T00:00:00.000Z');",
  ].join('\n'));
  try {
    insertAnalyticsEvent(database, {
      id: 'content-view',
      type: 'page_view',
      path: '/blog/hello',
      visitor: 'visitor-content',
      session: 'session-content',
      eventAt: now - 8_000,
    });
    insertAnalyticsEvent(database, {
      id: 'content-progress',
      type: 'article_progress',
      path: '/blog/hello',
      visitor: 'visitor-content',
      session: 'session-content',
      eventAt: now - 7_000,
    });
    insertAnalyticsEvent(database, {
      id: 'content-complete',
      type: 'article_complete',
      path: '/blog/hello',
      visitor: 'visitor-content',
      session: 'session-content',
      eventAt: now - 6_000,
    });
    insertAnalyticsEvent(database, {
      id: 'content-about',
      type: 'page_view',
      path: '/about',
      visitor: 'visitor-about',
      session: 'session-about',
      eventAt: now - 5_000,
    });
    insertAnalyticsEvent(database, {
      id: 'content-prior',
      type: 'page_view',
      path: '/blog/hello',
      visitor: 'visitor-old',
      session: 'session-old',
      eventAt: now - 25 * 60 * 60 * 1000,
    });

    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/content?range=24h'),
      environment(d1, { PORTFOLIO_DB: catalog }),
    );
    const result = await response.json();
    const page = result.data.pages.find((item) => item.path === '/blog/hello');
    const category = result.data.category_comparisons.find((item) => item.category_slug === 'machine-learning');
    assert.equal(response.status, 200);
    assert.equal(result.data.content_catalog.available, true);
    assert.equal(page.title, 'Hello article');
    assert.equal(page.category.slug, 'machine-learning');
    assert.equal(page.views, 1);
    assert.equal(page.previous_count, 1);
    assert.equal(page.trend, 'flat');
    assert.equal(category.views, 1);
    assert.equal(category.completions, 1);
  } finally {
    database.close();
    catalogDatabase.close();
  }
});

test('performance queries Workers and RUM with bounded string ranges and source-specific coverage', async () => {
  const { database, d1 } = createDatabase();
  const calls = [];
  try {
    const env = environment(d1, {
      CF_ANALYTICS_TOKEN: 'graphql-token',
      CF_ACCOUNT_ID: 'account-tag',
      CF_WEB_ANALYTICS_SITE_TAG: 'site-tag',
      CF_ANALYTICS_QUERY: async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        if (payload.query.includes('PortfolioRumPerformance')) {
          return Response.json({
            data: {
              viewer: {
                accounts: [{
                  rumWebVitalsEventsAdaptiveGroups: [{
                    count: 4,
                    dimensions: {
                      datetimeHour: '2026-10-26T10:00:00Z',
                      siteTag: 'site-tag',
                      requestHost: 'www.akmalalif.com',
                      requestPath: '/',
                    },
                    avg: {
                      firstContentfulPaint: 90000,
                      timeToFirstByte: null,
                    },
                    quantiles: {
                      largestContentfulPaintP75: 123456,
                      interactionToNextPaintP75: 50000,
                      cumulativeLayoutShiftP75: 0.07,
                    },
                  }],
                }],
              },
            },
          });
        }
        const scriptName = payload.variables.scriptName;
        return Response.json({
          data: {
            viewer: {
              accounts: [{
                workersInvocationsAdaptive: [{
                  sum: { requests: 10, errors: 1, subrequests: 3 },
                  quantiles: { cpuTimeP50: 250, cpuTimeP99: 900 },
                  dimensions: {
                    datetime: '2026-10-26T10:00:00Z',
                    scriptName,
                    status: 'success',
                  },
                }],
              }],
            },
          },
        });
      },
    });
    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/performance?range=90d'),
      env,
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls.every((call) => call.query.includes('string!')), true);
    assert.equal(calls.some((call) => call.query.includes('Time!') || call.query.includes('Date!')), false);
    assert.equal(calls.every((call) => call.query.includes('accountTag: string!')), true);
    assert.equal(calls.every((call) => call.variables.datetimeStart === '2026-09-25T10:00:00.000Z'), true);
    assert.equal(calls.every((call) => call.variables.datetimeEnd === '2026-10-26T10:00:00.000Z'), true);
    assert.equal(calls.filter((call) => call.query.includes('PortfolioWorkerPerformance')).every((call) => call.query.includes('scriptName')), true);
    assert.equal(calls.some((call) => call.query.includes('siteTag: $siteTag')), true);
    assert.equal(calls.filter((call) => call.query.includes('PortfolioRumPerformance')).every((call) => call.query.includes('datetimeHour')), true);
    assert.equal(calls.filter((call) => call.query.includes('PortfolioRumPerformance')).every((call) => !call.query.includes('dimensions { datetime siteTag')), true);
    assert.equal(result.meta.coverage.unavailable, false);
    assert.equal(result.meta.coverage.workers['akmalalif-portfolio'].available, true);
    assert.equal(result.data.cloudflare.scripts['akmalalif-portfolio'].totals.requests, 10);
    assert.equal(result.data.cloudflare.scripts['akmalalif-admin'].rows[0].cpu_time_us.p99, 900);
    assert.equal(result.meta.coverage.rum_vitals.available, true);
    assert.equal(result.data.rum_vitals.series[0].metrics.lcp_ms_p75, 123.456);
    assert.equal(result.data.rum_vitals.series[0].metrics.inp_ms_p75, 50);
    assert.equal(result.data.rum_vitals.series[0].metrics.cls_p75, 0.07);
    assert.equal(result.data.rum_vitals.series[0].metrics.fcp_ms_avg, 90);
    assert.equal(result.data.rum_vitals.series[0].metrics.ttfb_ms_avg, null);
    assert.equal(result.data.rum_vitals.units.timings, 'milliseconds');

    const partial = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/performance?range=24h'),
      {
        ...env,
        CF_ANALYTICS_QUERY: async (_url, options) => {
          const payload = JSON.parse(options.body);
          if (payload.query.includes('PortfolioRumPerformance')) {
            return Response.json({ errors: [{ message: 'RUM unavailable' }] });
          }
          return Response.json({
            data: {
              viewer: {
                accounts: [{ workersInvocationsAdaptive: [] }],
              },
            },
          });
        },
      },
    );
    const partialResult = await partial.json();
    assert.equal(partialResult.meta.coverage.unavailable, false);
    assert.equal(partialResult.meta.coverage.rum_vitals.unavailable, true);
    assert.equal(partialResult.meta.coverage.workers['akmalalif-portfolio'].available, true);
    assert.equal(partialResult.meta.coverage.workers['akmalalif-portfolio'].has_data, false);

    const malformed = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/performance?range=24h'),
      {
        ...env,
        CF_ANALYTICS_QUERY: async () => Response.json({}),
      },
    );
    const malformedResult = await malformed.json();
    assert.equal(malformedResult.meta.coverage.unavailable, true);
    assert.equal(malformedResult.meta.coverage.rum_vitals.unavailable, true);
    assert.equal(malformedResult.meta.coverage.workers['akmalalif-portfolio'].unavailable, true);
  } finally {
    database.close();
  }
});

test('performance query timeout marks every source unavailable without hanging', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1, {
      CF_ANALYTICS_TOKEN: 'graphql-token',
      CF_ACCOUNT_ID: 'account-tag',
      CF_WEB_ANALYTICS_SITE_TAG: 'site-tag',
      CF_ANALYTICS_TIMEOUT_MS: 1_000,
      CF_ANALYTICS_QUERY: () => new Promise(() => {}),
    });
    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/performance?range=24h'),
      env,
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.meta.coverage.unavailable, true);
    assert.match(result.meta.coverage.rum_vitals.reason, /timed out/);
    assert.match(result.meta.coverage.workers['akmalalif-portfolio'].reason, /timed out/);
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
    const firstRow = database.prepare([
      "SELECT source, shortlink_slug, ip, visitor_key, session_key",
      "FROM portfolio_analytics_events WHERE source = 'sink' AND shortlink_slug = 'cv'",
    ].join('\n')).get();
    assert.equal(firstRow.source, 'sink');
    assert.equal(firstRow.shortlink_slug, 'cv');
    assert.equal(firstRow.visitor_key.startsWith('sink-ip-v1:'), true);
    assert.equal(firstRow.session_key, null);

    const retryPayload = { slug: 'docs', target: '/docs', occurred_at: '2026-10-26T10:00:00.000Z' };
    const retry = await recordShortlinkEvent(retryPayload, env);
    const retryAgain = await recordShortlinkEvent(retryPayload, env);
    assert.equal(retry.accepted, 1);
    assert.equal(retryAgain.deduped, 1);
    assert.equal(retryAgain.event_id, retry.event_id);

    const anonymous = await recordShortlinkEvent({ slug: 'anon', target: '/s/anon' }, env);
    const anonymousAgain = await recordShortlinkEvent({ slug: 'anon', target: '/s/anon' }, env);
    assert.equal(anonymous.accepted, 1);
    assert.equal(anonymousAgain.accepted, 1);
    assert.notEqual(anonymousAgain.event_id, anonymous.event_id);
    await ingestEvents(request('/internal/events', [
      { id: 'website-with-shortlink', type: 'page_view', path: '/' },
    ]), env);

    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/conversions?range=24h'),
      env,
    );
    const result = await response.json();
    assert.equal(result.data.shortlink_campaigns.find((campaign) => campaign.slug === 'cv')?.slug, 'cv');
    assert.equal(result.data.goals.find((goal) => goal.id === 'shortlink_campaigns').conversions, 4);
    assert.equal(result.data.shortlink_campaigns.find((campaign) => campaign.slug === 'cv')?.visitor_method, 'IP estimate');
    assert.equal(result.meta.detail, 'raw_90_day_events');
    const overviewResponse = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=24h'),
      env,
    );
    const overview = await overviewResponse.json();
    assert.equal(overview.data.unique_visitors, 1);
    assert.equal(overview.data.shortlink_unique_visitors, 1);
    assert.equal(overview.data.unique_visitors + overview.data.shortlink_unique_visitors, 2);
    assert.equal(overview.data.visitor_estimates.shortlinks.method, 'IP estimate');
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

test('daily history merges sessions across midnight and remains available for prior comparisons', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    const day = 24 * 60 * 60 * 1000;
    const oldRows = [
      ['summary-old-a', now - (101 * day), '/old-a'],
      ['summary-old-b', now - (100 * day), '/old-b'],
    ];
    const insert = database.prepare([
      'INSERT INTO portfolio_analytics_events (',
      'event_id, event_type, path, source, event_at, received_at, visitor_key, session_key, is_bot',
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ].join('\n'));
    for (const [eventId, eventAt, path] of oldRows) {
      insert.run(eventId, 'page_view', path, 'portfolio', eventAt, eventAt, 'visitor-old', 'session-cross-day', 0);
    }

    const maintenance = await runAnalyticsMaintenance(env);
    assert.equal(maintenance.raw_pruned, 2);
    const daily = database.prepare([
      "SELECT day, session_count, session_hll FROM portfolio_analytics_daily",
      "WHERE dimension = 'all' AND source = 'portfolio' ORDER BY day ASC",
    ].join('\n')).all();
    assert.equal(daily.length, 2);
    assert.equal(daily[0].session_count, 1);
    assert.equal(daily[1].session_count, 1);
    assert.equal(daily[0].session_hll.length, 128);
    assert.equal(daily[1].session_hll.length, 128);

    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=90d'),
      env,
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data.comparison.events, 2);
    assert.equal(result.data.comparison.page_views, 2);
    assert.equal(result.data.comparison.sessions, 1);
    assert.equal(result.data.comparison.unique_visitors, 1);
    assert.equal(result.meta.coverage.prior_detail, 'daily_rollup');
    assert.equal(result.meta.coverage.tracking_started_at, new Date(now - (101 * day)).toISOString());
  } finally {
    database.close();
  }
});

test('reports mark periods beyond daily retention unavailable instead of returning zero totals', async () => {
  const { database, d1 } = createDatabase();
  try {
    const env = environment(d1);
    const from = new Date(Date.UTC(2025, 1, 1)).toISOString();
    const to = new Date(Date.UTC(2025, 2, 1)).toISOString();
    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=custom&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)),
      env,
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.data, null);
    assert.equal(result.meta.coverage.unavailable, true);
    assert.match(result.meta.coverage.reason, /13-month/);
  } finally {
    database.close();
  }
});

test('raw report detail refuses an oversized result instead of silently truncating', async () => {
  const { database, d1 } = createDatabase();
  try {
    const originalPrepare = d1.prepare.bind(d1);
    d1.prepare = (sql) => {
      if (sql.includes('LIMIT 50001')) {
        return {
          bind() {
            return this;
          },
          all() {
            return { results: Array.from({ length: 50_001 }, () => ({})) };
          },
        };
      }
      return originalPrepare(sql);
    };
    const response = await handleAnalyticsRequest(
      new Request('https://www.akmalalif.com/api/portfolio/overview?range=24h'),
      environment(d1),
    );
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.match(result.error, /bounded report limit/);
    assert.equal(result.meta.coverage.unavailable, true);
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
