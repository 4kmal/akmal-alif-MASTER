import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildConsoleChunks,
  buildImportSql,
  convertDirectory,
  DEFAULT_CONSOLE_CHUNK_BYTES,
  normalizeTimestamptz,
  parseSqlInserts,
  rewriteCloudFrontUrls,
} from '../scripts/import-supabase.mjs';

const migrationSql = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');

test('parser handles PostgreSQL tuples, doubled quotes, newlines, backslashes, and scalar literals', () => {
  const source = String.raw`
    -- INSERT INTO fake_table (ignored) VALUES ('inside a comment');
    INSERT INTO public.blog_posts (id, slug, title, content_html, published_at, featured, read_minutes)
    VALUES
      ('post-1', 'hello''s', 'line
value', 'C:\tmp\file <p>(ok)</p>', '2025-01-01 01:02:03.123456+08:00', true, 42),
      ('post-2', 'second', 'plain', NULL, NULL, false, -1);
  `;

  const [statement] = parseSqlInserts(source, 'blog_posts');
  assert.deepEqual(statement.columns, ['id', 'slug', 'title', 'content_html', 'published_at', 'featured', 'read_minutes']);
  assert.deepEqual(statement.rows, [
    ['post-1', "hello's", 'line\nvalue', 'C:\\tmp\\file <p>(ok)</p>', '2025-01-01 01:02:03.123456+08:00', true, 42],
    ['post-2', 'second', 'plain', null, null, false, -1],
  ]);
});

test('timestamp normalization preserves microseconds while converting offsets to UTC', () => {
  assert.equal(
    normalizeTimestamptz('2025-01-01 01:02:03.123456+08:00'),
    '2024-12-31T17:02:03.123456Z',
  );
  assert.equal(
    normalizeTimestamptz('2025-01-01 01:02:03.123456+0000'),
    '2025-01-01T01:02:03.123456Z',
  );
  assert.equal(
    normalizeTimestamptz('2025-01-01 01:02:03+00'),
    '2025-01-01T01:02:03.000Z',
  );
});

test('CloudFront URL rewriting targets the media route and preserves encoded paths', () => {
  const rewritten = rewriteCloudFrontUrls(
    '<img src="https://d111111abcdef8.cloudfront.net/images/cover%20one.jpg">',
  );
  assert.deepEqual(rewritten, {
    value: '<img src="/media/images/cover%20one.jpg">',
    replacements: 1,
  });
});

test('single-line SQL preserves CRLF values with SQLite char concatenation', () => {
  const tableStatements = new Map([
    ['blog_posts', [{ columns: ['content_html'], rows: [['before\r\nafter']] }]],
  ]);
  const result = buildImportSql(tableStatements, { singleLine: true });
  assert.equal(/[\r\n]/.test(result.sql), false);
  assert.match(result.sql, /char\(13\) \|\| char\(10\)/);
});

test('console chunks stay on statement boundaries and reject oversized statements', () => {
  const tableStatements = new Map([
    ['blog_posts', [{ columns: ['content_html'], rows: [['article; <p>line\nvalue</p>']] }]],
  ]);
  const result = buildConsoleChunks(tableStatements, { maxBytes: 4096 });
  assert.equal(result.chunks.length, 1);
  assert.equal(Buffer.byteLength(result.chunks[0]) <= 4096, true);
  assert.equal(/[\r\n]/.test(result.chunks[0]), false);
  assert.equal(/\b(?:BEGIN|COMMIT);/.test(result.chunks[0]), false);
  assert.match(result.chunks[0], /^.*;$/);
  assert.throws(
    () => buildConsoleChunks(tableStatements, { maxBytes: 20 }),
    /exceeds 20 byte console chunk limit/,
  );
  assert.equal(DEFAULT_CONSOLE_CHUNK_BYTES, 40 * 1024);
});

test('converter emits ordered import SQL that executes against the real migration', async () => {
  const inputDir = await mkdtemp(path.join(os.tmpdir(), 'supabase-export-'));
  const outputPath = path.join(inputDir, 'private.sql');
  const consoleOutputPath = path.join(inputDir, 'd1-import-console.sql');
  const chunksDir = path.join(inputDir, 'd1-console');
  try {
    await writeFile(path.join(inputDir, 'blog_categories_rows.sql'), String.raw`
      INSERT INTO public.blog_categories (id, slug, name, description, color_class, sort_order, is_active, created_at, updated_at)
      VALUES ('cat-1', 'news', 'News', NULL, 'blue', 1, true, '2025-01-01 00:00:00+00:00', '2025-01-01 00:00:00+00:00');
    `);
    await writeFile(path.join(inputDir, 'blog_tags_rows.sql'), String.raw`
      INSERT INTO public.blog_tags (id, slug, name, created_at, updated_at)
      VALUES ('tag-1', 'cloud', 'Cloud', '2025-01-01 00:00:00+00:00', '2025-01-01 00:00:00+00:00');
    `);
    await writeFile(path.join(inputDir, 'blog_admins_rows.sql'), '-- no rows');
    await writeFile(path.join(inputDir, 'blog_posts_rows.sql'), String.raw`
      INSERT INTO public.blog_posts
        (id, slug, title, subtitle, excerpt, content_html, content_markdown, cover_image_url,
         cover_image_alt, category_id, status, featured, read_minutes, meta_title,
         meta_description, canonical_path, published_at, created_by, updated_by, created_at, updated_at)
      VALUES ('post-1', 'hello', 'Hello', NULL, 'Excerpt', '<p>Bob''s
 article; C:\tmp</p>', NULL,
        'https://d111111abcdef8.cloudfront.net/images/cover.jpg', 'Cover', 'cat-1', 'published', false, 3,
        NULL, NULL, '/blog/hello', '2025-01-01 00:00:00+00:00', NULL, NULL, '2025-01-01 00:00:00+00:00', '2025-01-01 00:00:00+00:00');
    `);
    await writeFile(path.join(inputDir, 'blog_post_tags_rows.sql'), String.raw`
      INSERT INTO public.blog_post_tags (post_id, tag_id, created_at)
      VALUES ('post-1', 'tag-1', '2025-01-01 00:00:00+00:00');
    `);
    await writeFile(path.join(inputDir, 'profile_page_events_rows.sql'), String.raw`
      INSERT INTO public.profile_page_events (id, page_path, referrer, user_agent, created_at)
      VALUES (7, '/blog/hello', NULL, 'test-agent', '2025-01-01 00:00:00+00:00');
    `);
    await writeFile(path.join(inputDir, 'profile_metrics_rows.sql'), String.raw`
      INSERT INTO public.profile_metrics (id, profile_views, post_impressions, updated_at)
      VALUES (true, 7, 11, '2025-01-01 00:00:00.123456+00:00');
    `);

    const result = await convertDirectory(inputDir, outputPath);
    assert.deepEqual(result.counts, {
      blog_categories: 1,
      blog_tags: 1,
      blog_admins: 0,
      blog_posts: 1,
      blog_post_tags: 1,
      profile_page_events: 1,
      profile_metrics: 1,
    });
    assert.equal(result.replacements, 1);
    assert.equal(/\b(?:BEGIN|COMMIT);/.test(result.sql), false);
    assert.match(result.sql, /-- blog_admins: no rows in export/);
    assert.ok(result.sql.indexOf('INSERT INTO blog_categories') < result.sql.indexOf('INSERT INTO blog_tags'));
    assert.ok(result.sql.indexOf('INSERT INTO blog_tags') < result.sql.indexOf('INSERT INTO blog_posts'));
    assert.ok(result.sql.indexOf('INSERT INTO blog_posts') < result.sql.indexOf('INSERT INTO blog_post_tags'));
    assert.ok(result.sql.indexOf('INSERT OR REPLACE INTO profile_metrics') > result.sql.indexOf('INSERT INTO profile_page_events'));

    const consoleResult = await convertDirectory(inputDir, consoleOutputPath, {
      singleLine: true,
      chunksDir,
      chunkBytes: 700,
    });
    assert.equal(consoleResult.manifest.single_line, true);
    assert.equal(/[\r\n]/.test(consoleResult.sql), false);
    assert.equal(/\b(?:BEGIN|COMMIT);/.test(consoleResult.sql), false);
    assert.match(consoleResult.sql, /char\(10\)/);
    assert.match(consoleResult.sql, /\/\* blog_admins: no rows in export \*\//);
    assert.ok(consoleResult.chunks.length > 1);
    assert.equal(consoleResult.manifest.console_chunks.length, consoleResult.chunks.length);
    for (const chunk of consoleResult.chunks) {
      assert.equal(chunk.bytes <= 700, true);
      const chunkSql = await readFile(path.join(chunksDir, chunk.file), 'utf8');
      assert.equal(/[\r\n]/.test(chunkSql), false);
      assert.equal(/\b(?:BEGIN|COMMIT);/.test(chunkSql), false);
    }

    const database = new DatabaseSync(':memory:');
    try {
      database.exec(migrationSql);
      database.exec(result.sql);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      assert.deepEqual({ ...database.prepare('PRAGMA integrity_check').get() }, { integrity_check: 'ok' });
      assert.equal(database.prepare('SELECT count(*) AS count FROM blog_posts').get().count, 1);
      assert.equal(database.prepare('SELECT count(*) AS count FROM profile_page_events').get().count, 1);
      assert.deepEqual({ ...database.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
        profile_views: 7,
        post_impressions: 11,
      });
      const post = database.prepare('SELECT content_html, cover_image_url FROM blog_posts WHERE slug = ?').get('hello');
      assert.equal(post.content_html, "<p>Bob's\n article; C:\\tmp</p>");
      assert.equal(post.cover_image_url, '/media/images/cover.jpg');
    } finally {
      database.close();
    }

    const consoleDatabase = new DatabaseSync(':memory:');
    try {
      consoleDatabase.exec(migrationSql);
      consoleDatabase.exec(consoleResult.sql);
      const consolePost = consoleDatabase.prepare('SELECT content_html, cover_image_url FROM blog_posts WHERE slug = ?').get('hello');
      assert.equal(consolePost.content_html, "<p>Bob's\n article; C:\\tmp</p>");
      assert.equal(consolePost.cover_image_url, '/media/images/cover.jpg');
      assert.deepEqual({ ...consoleDatabase.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
        profile_views: 7,
        post_impressions: 11,
      });
      assert.deepEqual(consoleDatabase.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      consoleDatabase.close();
    }

    const chunkDatabase = new DatabaseSync(':memory:');
    try {
      chunkDatabase.exec(migrationSql);
      for (const chunk of consoleResult.chunks) {
        chunkDatabase.exec(await readFile(path.join(chunksDir, chunk.file), 'utf8'));
      }
      const chunkPost = chunkDatabase.prepare('SELECT content_html, cover_image_url FROM blog_posts WHERE slug = ?').get('hello');
      assert.equal(chunkPost.content_html, "<p>Bob's\n article; C:\\tmp</p>");
      assert.equal(chunkPost.cover_image_url, '/media/images/cover.jpg');
      assert.deepEqual({ ...chunkDatabase.prepare('SELECT profile_views, post_impressions FROM profile_metrics WHERE id = 1').get() }, {
        profile_views: 7,
        post_impressions: 11,
      });
      assert.deepEqual(chunkDatabase.prepare('PRAGMA foreign_key_check').all(), []);
      assert.deepEqual({ ...chunkDatabase.prepare('PRAGMA integrity_check').get() }, { integrity_check: 'ok' });
    } finally {
      chunkDatabase.close();
    }
  } finally {
    await rm(inputDir, { recursive: true, force: true });
  }
});
