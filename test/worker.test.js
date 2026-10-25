import assert from 'node:assert/strict';
import test from 'node:test';

import { fetch as workerFetch } from '../worker/index.js';

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async all() {
    return this.db.execute(this.sql, this.params);
  }

  async first() {
    const result = await this.all();
    return result.results?.[0] ?? null;
  }

  async run() {
    return this.db.execute(this.sql, this.params);
  }
}

class FakeD1 {
  constructor({ categories = [], posts = [], profileMetrics = {} } = {}) {
    this.categories = categories;
    this.posts = posts;
    this.metrics = {
      profile_views: profileMetrics.profile_views ?? 0,
      post_impressions: profileMetrics.post_impressions ?? 0,
    };
    this.events = [];
    this.nextEventId = 1;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    return statements.map((statement) => this.execute(statement.sql, statement.params));
  }

  execute(sql, params) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('select profile_views')) {
      return { results: [{ ...this.metrics }] };
    }

    if (normalized.startsWith('select slug, name, color_class, sort_order')) {
      const rows = this.categories
        .filter((category) => category.is_active === 1 || category.is_active === true)
        .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
      return { results: rows.map((category) => ({
        slug: category.slug,
        name: category.name,
        color_class: category.color_class ?? null,
        sort_order: category.sort_order,
      })) };
    }

    if (normalized.includes('from blog_posts as p')) {
      const now = params[params.length - 1];
      const slug = params.length === 2 ? params[0] : undefined;
      const matching = this.posts
        .filter((post) => post.status === 'published')
        .filter((post) => post.published_at != null && post.published_at <= now)
        .filter((post) => slug === undefined || post.slug === slug)
        .sort((left, right) => right.published_at.localeCompare(left.published_at));
      const rows = matching.map((post) => {
        const category = this.categories.find((candidate) => candidate.id === post.category_id);
        return {
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          cover_image_url: post.cover_image_url ?? null,
          cover_image_alt: post.cover_image_alt ?? null,
          read_minutes: post.read_minutes,
          published_at: post.published_at,
          meta_title: post.meta_title ?? null,
          meta_description: post.meta_description ?? null,
          canonical_path: post.canonical_path ?? null,
          content_html: post.content_html,
          category_slug: category?.slug ?? null,
          category_name: category?.name ?? null,
          category_color_class: category?.color_class ?? null,
          category_sort_order: category?.sort_order ?? null,
        };
      });
      return { results: slug === undefined ? rows : rows.slice(0, 1) };
    }

    if (normalized.startsWith('insert into profile_page_events')) {
      const [pagePath, referrer, userAgent, createdAt] = params;
      this.events.push({
        id: this.nextEventId++,
        page_path: pagePath,
        referrer,
        user_agent: userAgent,
        created_at: createdAt,
      });
      return { results: [], success: true };
    }

    if (normalized.startsWith('update profile_metrics')) {
      const [postImpression, updatedAt] = params;
      this.metrics.profile_views += 1;
      this.metrics.post_impressions += postImpression;
      this.updatedAt = updatedAt;
      return { results: [], success: true };
    }

    throw new Error(`Unhandled fake D1 SQL: ${sql}`);
  }
}

class FakeAssets {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.requests = [];
  }

  async fetch(request) {
    const url = new URL(request.url);
    this.requests.push({ method: request.method, pathname: url.pathname, search: url.search });
    const body = this.files.get(url.pathname);
    if (body == null) {
      return new Response('asset missing', { status: 404 });
    }
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

class FakeR2 {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.calls = [];
  }

  entry(key) {
    return this.entries.get(key);
  }

  metadata(key) {
    const entry = this.entry(key);
    if (!entry) {
      return null;
    }
    return {
      size: entry.bytes.length,
      etag: entry.etag,
      uploaded: entry.uploaded,
      httpMetadata: { contentType: entry.contentType },
    };
  }

  async head(key) {
    this.calls.push({ operation: 'head', key });
    return this.metadata(key);
  }

  async get(key, options = {}) {
    this.calls.push({ operation: 'get', key, options });
    const entry = this.entry(key);
    if (!entry) {
      return null;
    }

    let bytes = entry.bytes;
    let range;
    if (options.range) {
      const offset = options.range.offset;
      const length = options.range.length;
      bytes = bytes.slice(offset, offset + length);
      range = { offset, length: bytes.length };
    }

    return {
      body: new Response(bytes).body,
      size: bytes.length,
      range,
      etag: entry.etag,
      uploaded: entry.uploaded,
      httpMetadata: { contentType: entry.contentType },
    };
  }
}

function request(path, {
  host = 'www.akmalalif.com',
  method = 'GET',
  headers = {},
  body,
} = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] ??= 'application/json';
  }
  return new Request(`https://${host}${path}`, init);
}

function environment(db, assets = new FakeAssets(), media = new FakeR2()) {
  return { DB: db, ASSETS: assets, MEDIA: media };
}

function blogFixtures() {
  return {
    categories: [
      { id: 'cat-z', slug: 'zeta', name: 'Zeta', color_class: 'blue', sort_order: 1, is_active: 1 },
      { id: 'cat-a', slug: 'alpha', name: 'Alpha', color_class: null, sort_order: 1, is_active: 1 },
      { id: 'cat-off', slug: 'hidden', name: 'Hidden', color_class: 'muted', sort_order: 0, is_active: 0 },
    ],
    posts: [
      {
        slug: 'new-post', title: 'New post', excerpt: 'New excerpt', content_html: '<p>New</p>',
        cover_image_url: '/media/new.jpg', cover_image_alt: 'New cover', read_minutes: 4,
        published_at: '2025-06-01T00:00:00.000Z', meta_title: 'New title', meta_description: 'New meta',
        canonical_path: '/blog/new-post', category_id: 'cat-a', status: 'published',
      },
      {
        slug: 'old-post', title: 'Old post', excerpt: 'Old excerpt', content_html: '<p>Old</p>',
        cover_image_url: null, cover_image_alt: null, read_minutes: 1,
        published_at: '2024-01-01T00:00:00.000Z', meta_title: null, meta_description: null,
        canonical_path: null, category_id: null, status: 'published',
      },
      {
        slug: 'future-post', title: 'Future post', excerpt: 'Future excerpt', content_html: '<p>Future</p>',
        published_at: '2999-01-01T00:00:00.000Z', category_id: 'cat-z', status: 'published', read_minutes: 2,
      },
      {
        slug: 'draft-post', title: 'Draft post', excerpt: 'Draft excerpt', content_html: '<p>Draft</p>',
        published_at: '2025-05-01T00:00:00.000Z', category_id: 'cat-z', status: 'draft', read_minutes: 2,
      },
    ],
  };
}

test('blog APIs return only active categories and currently published post fields', async () => {
  const db = new FakeD1(blogFixtures());
  const env = environment(db);

  const categories = await workerFetch(request('/api/blog/categories'), env);
  assert.equal(categories.status, 200);
  assert.deepEqual(await categories.json(), [
    { slug: 'alpha', name: 'Alpha', color_class: null, sort_order: 1 },
    { slug: 'zeta', name: 'Zeta', color_class: 'blue', sort_order: 1 },
  ]);

  const posts = await workerFetch(request('/api/blog/posts'), env);
  assert.equal(posts.status, 200);
  assert.deepEqual(await posts.json(), [
    {
      slug: 'new-post', title: 'New post', excerpt: 'New excerpt', cover_image_url: '/media/new.jpg',
      cover_image_alt: 'New cover', read_minutes: 4, published_at: '2025-06-01T00:00:00.000Z',
      meta_title: 'New title', meta_description: 'New meta', canonical_path: '/blog/new-post',
      content_html: '<p>New</p>',
      blog_categories: { slug: 'alpha', name: 'Alpha', color_class: null, sort_order: 1 },
    },
    {
      slug: 'old-post', title: 'Old post', excerpt: 'Old excerpt', cover_image_url: null,
      cover_image_alt: null, read_minutes: 1, published_at: '2024-01-01T00:00:00.000Z',
      meta_title: null, meta_description: null, canonical_path: null, content_html: '<p>Old</p>',
      blog_categories: null,
    },
  ]);

  const detail = await workerFetch(request('/api/blog/posts/new-post'), env);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).slug, 'new-post');

  const unavailable = await workerFetch(request('/api/blog/posts/future-post'), env);
  assert.equal(unavailable.status, 200);
  assert.equal(await unavailable.text(), 'null');
  assert.match(posts.headers.get('Cache-Control'), /no-store/);
});

test('profile metrics preserve RPC normalization, blog prefix behavior, and atomic batches', async () => {
  const db = new FakeD1();
  const env = environment(db);
  const longPath = `/blog/${'x'.repeat(700)}`;
  const first = await workerFetch(request('/api/profile-metrics', {
    method: 'POST',
    body: { page_path: longPath, referrer: 'r'.repeat(1200), user_agent: '' },
  }), env);
  assert.deepEqual(await first.json(), { profile_views: 1, post_impressions: 1 });
  assert.equal(db.events[0].page_path.length, 512);
  assert.equal(db.events[0].referrer.length, 1024);
  assert.equal(db.events[0].user_agent, null);

  await workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: '/blogs/archive', referrer: '', user_agent: null },
  }), env);
  await workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: '/about' },
  }), env);
  await workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: '/blogger' },
  }), env);
  await workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: null },
  }), env);
  assert.deepEqual(db.metrics, { profile_views: 5, post_impressions: 3 });
  assert.equal(db.events.at(-1).page_path, '/');

  const eventsBeforeSuppressedWrite = db.events.length;
  const suppressed = await workerFetch(request('/api/profile-metrics', {
    host: 'akmal-alif.workers.dev',
    method: 'POST',
    body: { page_path: '/blog/ignored' },
  }), env);
  assert.deepEqual(await suppressed.json(), { profile_views: 5, post_impressions: 3 });
  assert.equal(db.events.length, eventsBeforeSuppressedWrite);

  await Promise.all(Array.from({ length: 20 }, () => workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: '/blog/concurrent' },
  }), env)));
  assert.deepEqual(db.metrics, { profile_views: 25, post_impressions: 23 });
  assert.equal(db.events.length, eventsBeforeSuppressedWrite + 20);
});

test('clean routes redirect or rewrite to exact assets while preserving query strings', async () => {
  const db = new FakeD1();
  const assets = new FakeAssets({
    '/index.html': 'home',
    '/blog.html': 'blog index',
    '/blog/hello.html': 'hello',
    '/contact/index.html': 'contact',
  });
  const env = environment(db, assets);

  const blogRedirect = await workerFetch(request('/blog.html?view=all'), env);
  assert.equal(blogRedirect.status, 308);
  assert.equal(blogRedirect.headers.get('Location'), 'https://www.akmalalif.com/blogs?view=all');

  const indexRedirect = await workerFetch(request('/index.html?ref=legacy'), env);
  assert.equal(indexRedirect.status, 308);
  assert.equal(indexRedirect.headers.get('Location'), 'https://www.akmalalif.com/?ref=legacy');

  const articleRedirect = await workerFetch(request('/blog/hello.html?utm=1'), env);
  assert.equal(articleRedirect.status, 308);
  assert.equal(articleRedirect.headers.get('Location'), 'https://www.akmalalif.com/blog/hello?utm=1');

  const blogIndex = await workerFetch(request('/blogs/?page=2'), env);
  assert.equal(blogIndex.status, 200);
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/blog.html', search: '?page=2' });

  const article = await workerFetch(request('/blog/hello?utm=2'), env);
  assert.equal(article.status, 200);
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/blog/hello.html', search: '?utm=2' });

  const directory = await workerFetch(request('/contact/?tab=about'), env);
  assert.equal(directory.status, 200);
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/contact/index.html', search: '?tab=about' });

  const missing = await workerFetch(request('/missing?x=1'), env);
  assert.equal(missing.status, 404);
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/missing/index.html', search: '?x=1' });
});

test('R2 media paths support metadata, full and ranged GET/HEAD, and missing objects', async () => {
  const db = new FakeD1();
  const media = new FakeR2({
    'demo.bin': {
      bytes: new TextEncoder().encode('abcdef'),
      contentType: 'application/octet-stream',
      etag: '"demo"',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
    'assets/video/zopo (@aesopcash).mp4': {
      bytes: new TextEncoder().encode('zopo'),
      contentType: 'video/mp4',
      etag: '"zopo"',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
  });
  const env = environment(db, new FakeAssets(), media);

  const full = await workerFetch(request('/media/demo.bin'), env);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'abcdef');
  assert.equal(full.headers.get('Content-Length'), '6');
  assert.equal(full.headers.get('ETag'), '"demo"');
  assert.match(full.headers.get('Cache-Control'), /immutable/);

  const head = await workerFetch(request('/media/demo.bin', { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Length'), '6');
  assert.equal(media.calls.at(-1).operation, 'head');

  const range = await workerFetch(request('/media/demo.bin', {
    headers: { Range: 'bytes=1-3' },
  }), env);
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'bcd');
  assert.equal(range.headers.get('Content-Range'), 'bytes 1-3/6');
  assert.equal(range.headers.get('Content-Length'), '3');
  assert.equal(range.headers.get('Cache-Control'), 'no-store');

  const rangeHead = await workerFetch(request('/media/demo.bin', {
    method: 'HEAD', headers: { Range: 'bytes=2-' },
  }), env);
  assert.equal(rangeHead.status, 206);
  assert.equal(rangeHead.headers.get('Content-Range'), 'bytes 2-5/6');
  assert.equal(await rangeHead.text(), '');

  const invalidRange = await workerFetch(request('/media/demo.bin', {
    headers: { Range: 'bytes=99-100' },
  }), env);
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('Content-Range'), 'bytes */6');

  const encodedDirectPath = await workerFetch(request('/assets/video/zopo%20(@aesopcash).mp4'), env);
  assert.equal(encodedDirectPath.status, 200);
  assert.equal(await encodedDirectPath.text(), 'zopo');

  const missing = await workerFetch(request('/media/nope.bin'), env);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Not Found');
});
