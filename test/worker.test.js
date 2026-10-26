import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { fetch as workerFetch } from '../worker/index.js';

const migrationSql = [
  readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../migrations/0002_blog_studio.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../migrations/0003_blog_audit.sql', import.meta.url), 'utf8'),
].join('\n');

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

  execute() {
    if (/^\s*(select|pragma|with)\b/i.test(this.statement.sourceSQL)) {
      return { results: this.statement.all(...this.params) };
    }
    return this.run();
  }
}

class SQLiteD1 {
  constructor(database) {
    this.database = database;
    this.failBatchAt = null;
  }

  prepare(sql) {
    return new SQLiteStatement(this.database.prepare(sql));
  }

  batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement, index) => {
        if (index === this.failBatchAt) {
          throw new Error('synthetic D1 batch failure');
        }
        return statement.execute();
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
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
      httpEtag: entry.httpEtag,
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
      httpEtag: entry.httpEtag,
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

function createDatabase(fixtures = null) {
  const database = new DatabaseSync(':memory:');
  database.exec(migrationSql);

  if (fixtures) {
    const insertCategory = database.prepare(`
      INSERT INTO blog_categories
        (id, slug, name, description, color_class, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const category of fixtures.categories) {
      insertCategory.run(
        category.id,
        category.slug,
        category.name,
        null,
        category.color_class,
        category.sort_order,
        category.is_active,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
    }

    const insertPost = database.prepare(`
      INSERT INTO blog_posts
        (id, slug, title, subtitle, excerpt, content_html, content_markdown,
         cover_image_url, cover_image_alt, category_id, status, featured, read_minutes,
         meta_title, meta_description, canonical_path, published_at, created_by, updated_by,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const post of fixtures.posts) {
      insertPost.run(
        `post-${post.slug}`,
        post.slug,
        post.title,
        null,
        post.excerpt,
        post.content_html,
        null,
        post.cover_image_url ?? null,
        post.cover_image_alt ?? null,
        post.category_id ?? null,
        post.status,
        0,
        post.read_minutes,
        post.meta_title ?? null,
        post.meta_description ?? null,
        post.canonical_path ?? null,
        post.published_at ?? null,
        null,
        null,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
    }
  }

  return { database, d1: new SQLiteD1(database) };
}

test('blog APIs return only active categories and currently published post fields', async (t) => {
  const { database, d1 } = createDatabase(blogFixtures());
  t.after(() => database.close());
  const env = environment(d1);

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

test('profile metrics preserve RPC normalization, blog prefix behavior, and atomic batches', async (t) => {
  const { database, d1 } = createDatabase();
  t.after(() => database.close());
  const env = environment(d1);
  const longPath = `/blog/${'x'.repeat(700)}`;
  const first = await workerFetch(request('/api/profile-metrics', {
    method: 'POST',
    body: { page_path: longPath, referrer: 'r'.repeat(1200), user_agent: '' },
  }), env);
  assert.deepEqual(await first.json(), { profile_views: 1, post_impressions: 1 });
  const firstEvent = database.prepare('SELECT page_path, referrer, user_agent FROM profile_page_events ORDER BY id LIMIT 1').get();
  assert.equal(firstEvent.page_path.length, 512);
  assert.equal(firstEvent.referrer.length, 1024);
  assert.equal(firstEvent.user_agent, null);

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
  assert.deepEqual({ ...database.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
    profile_views: 5,
    post_impressions: 3,
  });
  assert.equal(database.prepare('SELECT page_path FROM profile_page_events ORDER BY id DESC LIMIT 1').get().page_path, '/');

  const eventsBeforeSuppressedWrite = database.prepare('SELECT count(*) AS count FROM profile_page_events').get().count;
  const suppressed = await workerFetch(request('/api/profile-metrics', {
    host: 'akmal-alif.workers.dev',
    method: 'POST',
    body: { page_path: '/blog/ignored' },
  }), env);
  assert.deepEqual(await suppressed.json(), { profile_views: 5, post_impressions: 3 });
  assert.equal(database.prepare('SELECT count(*) AS count FROM profile_page_events').get().count, eventsBeforeSuppressedWrite);

  d1.failBatchAt = 1;
  const originalConsoleError = console.error;
  let failedBatch;
  console.error = () => {};
  try {
    failedBatch = await workerFetch(request('/api/profile-metrics', {
      method: 'POST', body: { page_path: '/blog/rolled-back' },
    }), env);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(failedBatch.status, 500);
  d1.failBatchAt = null;
  assert.deepEqual({ ...database.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
    profile_views: 5,
    post_impressions: 3,
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM profile_page_events').get().count, eventsBeforeSuppressedWrite);

  await Promise.all(Array.from({ length: 20 }, () => workerFetch(request('/api/profile-metrics', {
    method: 'POST', body: { page_path: '/blog/concurrent' },
  }), env)));
  assert.deepEqual({ ...database.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
    profile_views: 25,
    post_impressions: 23,
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM profile_page_events').get().count, eventsBeforeSuppressedWrite + 20);
});

test('clean routes redirect or rewrite to exact assets while preserving query strings', async (t) => {
  const { database, d1 } = createDatabase();
  t.after(() => database.close());
  const assets = new FakeAssets({
    '/index.html': 'home',
    '/blog.html': 'blog index',
    '/blog/hello.html': 'hello',
    '/contact/index.html': 'contact',
  });
  const env = environment(d1, assets);

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

test('published blog slugs use the shared article shell while missing slugs stay 404', async (t) => {
  const { database, d1 } = createDatabase(blogFixtures());
  t.after(() => database.close());
  const assets = new FakeAssets({ '/blog/article-template.html': '<html><body data-blog-template>template</body></html>' });
  const env = environment(d1, assets);

  const article = await workerFetch(request('/blog/new-post'), env);
  assert.equal(article.status, 200);
  assert.equal(await article.text(), '<html><body data-blog-template>template</body></html>');
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/blog/article-template.html', search: '' });

  for (const method of ['GET', 'HEAD']) {
    const canonical = await workerFetch(request('/blog/new-post/?source=share', { method }), env);
    assert.equal(canonical.status, 308);
    assert.equal(canonical.headers.get('Location'), 'https://www.akmalalif.com/blog/new-post?source=share');
  }

  const missing = await workerFetch(request('/blog/does-not-exist'), env);
  assert.equal(missing.status, 404);
  assert.deepEqual(assets.requests.at(-1), { method: 'GET', pathname: '/blog/does-not-exist.html', search: '' });
});

test('R2 media paths support metadata, conditional requests, full and ranged GET/HEAD, and missing objects', async (t) => {
  const { database, d1 } = createDatabase();
  t.after(() => database.close());
  const media = new FakeR2({
    'demo.bin': {
      bytes: new TextEncoder().encode('abcdef'),
      contentType: 'application/octet-stream',
      etag: 'demo',
      httpEtag: '"demo"',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
    'assets/video/zopo (@aesopcash).mp4': {
      bytes: new TextEncoder().encode('zopo'),
      contentType: 'video/mp4',
      etag: 'zopo',
      httpEtag: '"zopo"',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
    'fonts/demo.woff2': {
      bytes: new TextEncoder().encode('font'),
      etag: 'font',
      httpEtag: '"font"',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
    'blog/legacy/demo.mp4': {
      bytes: new TextEncoder().encode('legacy'),
      contentType: 'video/mp4',
      etag: 'legacy',
      uploaded: new Date('2025-01-01T00:00:00.000Z'),
    },
  });
  const env = environment(d1, new FakeAssets(), media);

  const full = await workerFetch(request('/media/demo.bin'), env);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'abcdef');
  assert.equal(full.headers.get('Content-Length'), '6');
  assert.equal(full.headers.get('ETag'), '"demo"');
  assert.equal(full.headers.get('Cache-Control'), 'public, max-age=86400');

  const callsBeforeNotModified = media.calls.length;
  const notModified = await workerFetch(request('/media/demo.bin', {
    headers: { 'If-None-Match': '"demo"' },
  }), env);
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), '');
  assert.equal(notModified.headers.get('ETag'), '"demo"');
  assert.equal(media.calls.length, callsBeforeNotModified + 1);
  assert.equal(media.calls.at(-1).operation, 'head');

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

  const font = await workerFetch(request('/media/fonts/demo.woff2'), env);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('Content-Type'), 'font/woff2');

  const legacyBlogMedia = await workerFetch(request('/media/blog/legacy/demo.mp4'), env);
  assert.equal(legacyBlogMedia.status, 200);
  assert.equal(await legacyBlogMedia.text(), 'legacy');

  const missing = await workerFetch(request('/media/nope.bin'), env);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Not Found');
});

test('new blog media is public only while referenced by a published post', async (t) => {
  const { database, d1 } = createDatabase(blogFixtures());
  t.after(() => database.close());
  const media = new FakeR2({
    'blog/originals/asset-one/photo.png': {
      bytes: new TextEncoder().encode('private-until-published'),
      contentType: 'image/png',
      etag: 'asset-one',
      httpEtag: '"asset-one"',
    },
  });
  database.prepare(`
    INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)
  `).run('asset-one', 'photo.png', 'image/png', 'image', 23, 'blog/originals/asset-one/photo.png', 'blog/originals/asset-one/photo.png', 'owner');
  database.prepare(`INSERT INTO blog_post_asset_refs (post_id, asset_id, scope) VALUES (?, ?, 'published')`).run('post-new-post', 'asset-one');
  const env = environment(d1, new FakeAssets(), media);

  const publicAsset = await workerFetch(request('/media/blog/asset-one'), env);
  assert.equal(publicAsset.status, 200);
  assert.equal(await publicAsset.text(), 'private-until-published');

  const callsBeforeOriginalGuess = media.calls.length;
  for (const path of [
    '/media/blog/originals/asset-one/photo.png',
    '/media/blog/%6friginals/asset-one/photo.png',
    '/media/blog/%256friginals/asset-one/photo.png',
  ]) {
    const originalGuess = await workerFetch(request(path), env);
    assert.equal(originalGuess.status, 404);
    assert.equal(await originalGuess.text(), 'Not Found');
  }
  assert.equal(media.calls.length, callsBeforeOriginalGuess);

  const guessed = await workerFetch(request('/media/blog/asset-missing'), env);
  assert.equal(guessed.status, 404);
  assert.equal(media.calls.filter(call => call.operation === 'head' && call.key === 'asset-missing').length, 0);

  database.prepare(`UPDATE blog_posts SET status = 'draft' WHERE id = ?`).run('post-new-post');
  const unpublished = await workerFetch(request('/media/blog/asset-one'), env);
  assert.equal(unpublished.status, 404);
});
