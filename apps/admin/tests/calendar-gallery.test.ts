import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createEvent } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  addBlogGalleryPage,
  createBlogGallery,
  finalizeBlogGallery,
  initBlogGallerySource,
  publishBlogPost,
  reopenBlogGalleryDraft,
  reorderBlogGalleryPages,
  updateBlogDraft,
} from '../server/services/blog-studio'
import {
  createCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
  updateCalendarEventStatus,
} from '../server/services/calendar'
import { renderTiptapDocument } from '../server/utils/blog-content'

const migrationSql = [
  readFileSync(new URL('../../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../migrations/0002_blog_studio.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../migrations/0003_blog_audit.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../migrations/0004_gallery_calendar.sql', import.meta.url), 'utf8'),
].join('\n')

interface D1Limits {
  maxPrepareCalls?: number
  maxBatchStatements?: number
  maxBinds?: number
}

class SQLiteStatement {
  private readonly statement: ReturnType<DatabaseSync['prepare']>
  private params: unknown[] = []

  constructor(database: DatabaseSync, sql: string, private readonly limits: D1Limits) {
    this.statement = database.prepare(sql)
  }

  bind(...params: unknown[]) {
    if (this.limits.maxBinds !== undefined && params.length > this.limits.maxBinds)
      throw new Error(`simulated D1 bind limit exceeded: ${params.length}`)
    this.params = params
    return this
  }

  all() {
    return { results: this.statement.all(...this.params) }
  }

  run() {
    const result = this.statement.run(...this.params)
    return { meta: { changes: Number(result.changes) } }
  }
}

class SQLiteD1 {
  private prepareCalls = 0

  constructor(private readonly database: DatabaseSync, private readonly limits: D1Limits = {}) {}

  get prepareCount() {
    return this.prepareCalls
  }

  prepare(sql: string) {
    this.prepareCalls += 1
    if (this.limits.maxPrepareCalls !== undefined && this.prepareCalls > this.limits.maxPrepareCalls)
      throw new Error(`simulated D1 query limit exceeded: ${this.prepareCalls}`)
    return new SQLiteStatement(this.database, sql, this.limits)
  }

  async batch(statements: SQLiteStatement[]) {
    if (this.limits.maxBatchStatements !== undefined && statements.length > this.limits.maxBatchStatements)
      throw new Error(`simulated D1 batch limit exceeded: ${statements.length}`)
    this.database.exec('BEGIN')
    try {
      const result = statements.map(statement => statement.run())
      this.database.exec('COMMIT')
      return result
    }
    catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

class FakeBucket {
  async createMultipartUpload() {
    return {
      uploadId: 'r2-gallery-upload',
      uploadPart: async () => ({ etag: 'etag-1' }),
      complete: async () => undefined,
      abort: async () => undefined,
    }
  }

  resumeMultipartUpload() {
    return {
      uploadPart: async () => ({ etag: 'etag-1' }),
      complete: async () => undefined,
      abort: async () => undefined,
    }
  }
}

function fixture(limits: D1Limits = {}) {
  const database = new DatabaseSync(':memory:')
  database.exec(migrationSql)
  const d1 = new SQLiteD1(database, limits)
  const bucket = new FakeBucket()
  database.prepare('INSERT INTO blog_posts (id, slug, title, excerpt, content_html, status, read_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)').run('post-one', 'post-one', 'Post', 'Excerpt', '<p>Body</p>', 'draft', 1)
  database.prepare('INSERT INTO blog_post_drafts (post_id, version, schema_version, title, slug, excerpt, content_html, updated_by) VALUES (?, 1, 1, ?, ?, ?, ?, ?)').run('post-one', 'Post', 'post-one', 'Excerpt', '<p>Body</p>', 'owner')
  database.prepare('INSERT INTO blog_post_revisions (post_id, version, kind, snapshot_json, created_by) VALUES (?, 1, \'original\', ?, ?)').run('post-one', '{}', 'owner')
  return { database, d1, bucket }
}

function eventFor(d1: SQLiteD1, bucket: FakeBucket, method: string, path: string, body?: unknown) {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const event = createEvent({
    method,
    url: path,
    originalUrl: path,
    headers: {
      'content-type': 'application/json',
      'content-length': payload === undefined ? '0' : String(new TextEncoder().encode(payload).byteLength),
    },
    body: payload,
  } as never)
  event.context.authMethod = 'local-admin'
  event.context.userID = 'owner'
  event.context.userEmail = 'owner@example.test'
  event.context.cloudflare = { env: { PORTFOLIO_DB: d1, PORTFOLIO_MEDIA: bucket } } as never
  return event
}

beforeAll(() => {
  vi.stubGlobal('createError', ({ statusCode, statusMessage, data }: { statusCode: number, statusMessage: string, data?: unknown }) => {
    const error = new Error(statusMessage) as Error & { statusCode: number, statusMessage: string, data?: unknown }
    error.statusCode = statusCode
    error.statusMessage = statusMessage
    error.data = data
    return error
  })
  vi.stubGlobal('setHeader', () => undefined)
  vi.stubGlobal('setResponseHeader', () => undefined)
})

afterAll(() => vi.unstubAllGlobals())

describe('gallery publication contract', () => {
  it('keeps YouTube IDs exact while allowing hyphenated approved IDs', async () => {
    const html = await renderTiptapDocument({
      type: 'doc',
      content: [{ type: 'blogYouTube', attrs: { videoId: 'abc-def_123', title: 'Anthem' } }],
    })
    expect(html).toContain('data-youtube-id="abc-def_123"')
    await expect(renderTiptapDocument({
      type: 'doc',
      content: [{ type: 'blogYouTube', attrs: { videoId: 'abc-def_12' } }],
    })).rejects.toThrow('approved YouTube ID')
  })

  it('keeps manifest pages immutable and promotes all page assets atomically', async () => {
    const { database, d1, bucket } = fixture()
    try {
      database.prepare('INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, \'ready\', ?)').run('page-asset', 'page.webp', 'image/webp', 'image', 2, 'blog/originals/page/page.webp', 'blog/originals/page/page.webp', 'owner')
      database.prepare('INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, \'ready\', ?)').run('thumb-asset', 'thumb.webp', 'image/webp', 'image', 2, 'blog/originals/thumb/thumb.webp', 'blog/originals/thumb/thumb.webp', 'owner')
      const gallery = await createBlogGallery(eventFor(d1, bucket, 'POST', '/galleries', { post_id: 'post-one', title: 'Anthem', page_count: 2 }))
      database.prepare('INSERT INTO blog_gallery_sources (id, gallery_id, filename, mime_type, size, object_key, r2_upload_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, \'completed\', ?)').run('source-one', gallery.gallery.id, 'anthem.pdf', 'application/pdf', 2, 'blog/originals/gallery/anthem.pdf', 'upload-one', 'owner')
      database.prepare('UPDATE blog_galleries SET source_id = ? WHERE id = ?').run('source-one', gallery.gallery.id)
      const attached = await addBlogGalleryPage(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/pages`, {
        version: gallery.gallery.version,
        page: { original_page: 1, title: 'Opening', caption: 'Page one', order: 0, visible: true, asset_id: 'page-asset', thumbnail_asset_id: 'thumb-asset' },
      }), gallery.gallery.id)
      const concurrent = await Promise.allSettled([
        addBlogGalleryPage(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/pages`, {
          version: attached.gallery.version,
          page: { original_page: 1, title: 'Concurrent A', order: 0, visible: true, asset_id: 'page-asset', thumbnail_asset_id: 'thumb-asset' },
        }), gallery.gallery.id),
        addBlogGalleryPage(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/pages`, {
          version: attached.gallery.version,
          page: { original_page: 1, title: 'Concurrent B', order: 0, visible: true, asset_id: 'page-asset', thumbnail_asset_id: 'thumb-asset' },
        }), gallery.gallery.id),
      ])
      expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(concurrent.filter(result => result.status === 'rejected')).toHaveLength(1)
      const afterConcurrent = database.prepare('SELECT version, title FROM blog_galleries WHERE id = ?').get(gallery.gallery.id) as { version: number, title: string }
      expect(afterConcurrent.version).toBe(attached.gallery.version + 1)
      expect(['Concurrent A', 'Concurrent B']).toContain(database.prepare('SELECT title FROM blog_gallery_pages WHERE gallery_id = ? AND original_page = 1').get(gallery.gallery.id).title)
      const auditAfterConcurrent = database.prepare('SELECT COUNT(*) AS count FROM blog_audit_records WHERE action = \'gallery.page.save\'').get().count
      expect(auditAfterConcurrent).toBe(2)
      const pageTwo = await addBlogGalleryPage(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/pages`, {
        version: afterConcurrent.version,
        page: { original_page: 2, title: 'Page two', order: 1, visible: true, asset_id: 'page-asset', thumbnail_asset_id: 'thumb-asset' },
      }), gallery.gallery.id)
      const pageRows = database.prepare('SELECT id, sort_order FROM blog_gallery_pages WHERE gallery_id = ? ORDER BY original_page').all(gallery.gallery.id) as Array<{ id: string, sort_order: number }>
      const reordered = await reorderBlogGalleryPages(eventFor(d1, bucket, 'PUT', `/galleries/${gallery.gallery.id}/pages/reorder`, { version: pageTwo.gallery.version, page_ids: [pageRows[1].id, pageRows[0].id] }), gallery.gallery.id)
      expect(reordered.gallery.version).toBe(pageTwo.gallery.version + 1)
      expect(database.prepare('SELECT sort_order FROM blog_gallery_pages WHERE id = ?').get(pageRows[1].id).sort_order).toBe(0)
      expect(database.prepare('SELECT sort_order FROM blog_gallery_pages WHERE id = ?').get(pageRows[0].id).sort_order).toBe(1)
      const finalized = await finalizeBlogGallery(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/finalize`, { version: reordered.gallery.version }), gallery.gallery.id)
      expect(finalized.gallery.status).toBe('finalized')
      expect(finalized.manifest?.pages).toHaveLength(2)
      await expect(addBlogGalleryPage(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/pages`, {
        version: finalized.gallery.version,
        page: { original_page: 1, order: 0, visible: true, asset_id: 'page-asset', thumbnail_asset_id: 'thumb-asset' },
      }), gallery.gallery.id)).rejects.toMatchObject({ statusCode: 409 })

      const firstManifestId = finalized.gallery.manifest_id
      const reopened = await reopenBlogGalleryDraft(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/draft`, { version: finalized.gallery.version }), gallery.gallery.id)
      expect(reopened.gallery.status).toBe('draft')
      expect(reopened.gallery.manifest_id).toBe(firstManifestId)
      const secondFinalized = await finalizeBlogGallery(eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/finalize`, { version: reopened.gallery.version }), gallery.gallery.id)
      expect(secondFinalized.gallery.manifest_id).not.toBe(firstManifestId)
      expect(secondFinalized.manifest?.revision).toBe(2)
      expect(database.prepare('SELECT revision FROM blog_gallery_manifests WHERE id = ?').get(firstManifestId).revision).toBe(1)

      const updated = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/posts/post-one/draft', {
        version: 1,
        content_json: { type: 'doc', content: [{ type: 'blogGallery', attrs: { manifestId: secondFinalized.gallery.manifest_id } }] },
      }), 'post-one')
      expect(updated.draft.content_html).toContain('data-gallery-manifest-id')
      expect(updated.draft.content_html).toContain('blog-gallery-fallback')
      database.prepare('UPDATE blog_assets SET status = \'uploading\' WHERE id = \'thumb-asset\'').run()
      await expect(publishBlogPost(eventFor(d1, bucket, 'POST', '/posts/post-one/publish', { version: updated.draft.version }), 'post-one')).rejects.toMatchObject({ statusCode: 400 })
      expect(database.prepare('SELECT status FROM blog_posts WHERE id = \'post-one\'').get().status).toBe('draft')
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_asset_refs WHERE post_id = \'post-one\' AND scope = \'published\'').get().count).toBe(0)
      database.prepare('UPDATE blog_assets SET status = \'ready\' WHERE id = \'thumb-asset\'').run()
      const published = await publishBlogPost(eventFor(d1, bucket, 'POST', '/posts/post-one/publish', { version: updated.draft.version }), 'post-one')
      expect(published.post.status).toBe('published')
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_asset_refs WHERE post_id = \'post-one\' AND scope = \'published\'').get().count).toBe(2)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_gallery_refs WHERE post_id = \'post-one\' AND scope = \'published\'').get().count).toBe(1)
    }
    finally {
      database.close()
    }
  })

  it('rejects non-PDF and oversized source metadata before creating a multipart upload', async () => {
    const { database, d1, bucket } = fixture()
    try {
      const gallery = await createBlogGallery(eventFor(d1, bucket, 'POST', '/galleries', { post_id: 'post-one', title: 'Anthem', page_count: 1 }))
      const malformed = eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/source`, {
        version: gallery.gallery.version,
        filename: 'anthem.pdf',
        mime_type: 'application/octet-stream',
        size: 2,
      })
      await expect(initBlogGallerySource(malformed, gallery.gallery.id)).rejects.toMatchObject({ statusCode: 400 })
      const oversized = eventFor(d1, bucket, 'POST', `/galleries/${gallery.gallery.id}/source`, {
        version: gallery.gallery.version,
        filename: 'anthem.pdf',
        mime_type: 'application/pdf',
        size: 250 * 1024 * 1024 + 1,
      })
      await expect(initBlogGallerySource(oversized, gallery.gallery.id)).rejects.toMatchObject({ statusCode: 400 })
      const sink = eventFor(d1, bucket, 'POST', '/galleries', { post_id: 'post-one', title: 'Sink' })
      sink.context.authMethod = 'site-token'
      await expect(createBlogGallery(sink)).rejects.toMatchObject({ statusCode: 403 })
    }
    finally {
      database.close()
    }
  })

  it('caps the resume cursor at the 512-page maximum', async () => {
    const { database, d1, bucket } = fixture()
    try {
      database.prepare('INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, \'ready\', ?)').run('cursor-page', 'page.webp', 'image/webp', 'image', 2, 'blog/originals/page/cursor.webp', 'blog/originals/page/cursor.webp', 'owner')
      database.prepare('INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, \'ready\', ?)').run('cursor-thumb', 'thumb.webp', 'image/webp', 'image', 2, 'blog/originals/thumb/cursor.webp', 'blog/originals/thumb/cursor.webp', 'owner')
      const gallery = await createBlogGallery(eventFor(d1, bucket, 'POST', '/galleries', { post_id: 'post-one', title: 'Cursor', page_count: 512 }))
      const saved = await addBlogGalleryPage(eventFor(d1, bucket, 'POST', '/galleries/id/pages', {
        version: gallery.gallery.version,
        page: { original_page: 512, order: 511, asset_id: 'cursor-page', thumbnail_asset_id: 'cursor-thumb' },
      }), gallery.gallery.id)
      expect(saved.gallery.resume.next_page).toBe(512)
      expect(database.prepare('SELECT resume_page FROM blog_galleries WHERE id = ?').get(gallery.gallery.id).resume_page).toBe(512)
    }
    finally {
      database.close()
    }
  })

  it('saves a 512-page gallery within bounded D1 query, bind, and batch limits', async () => {
    const { database, d1, bucket } = fixture({ maxPrepareCalls: 64, maxBatchStatements: 32, maxBinds: 32 })
    try {
      database.prepare(`
        INSERT INTO blog_galleries (id, post_id, version, status, title, page_count, finalized_manifest_id, created_by, updated_by)
        VALUES (?, ?, 1, 'finalized', ?, 512, ?, ?, ?)
      `).run('scale-gallery', 'post-one', 'Anthem', 'scale-manifest', 'owner', 'owner')
      database.prepare('INSERT INTO blog_gallery_manifests (id, gallery_id, revision, title, created_by) VALUES (?, ?, 1, ?, ?)').run('scale-manifest', 'scale-gallery', 'Anthem', 'owner')
      const insertAsset = database.prepare(`
        INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by)
        VALUES (?, ?, 'image/webp', 'image', 2, ?, ?, 'ready', 'owner')
      `)
      const insertPage = database.prepare(`
        INSERT INTO blog_gallery_manifest_pages (manifest_id, page_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id)
        VALUES ('scale-manifest', ?, ?, ?, NULL, ?, 1, ?, ?)
      `)
      database.exec('BEGIN')
      for (let page = 1; page <= 512; page++) {
        const suffix = String(page).padStart(3, '0')
        const assetId = `scale-page-${suffix}`
        const thumbnailId = `scale-thumb-${suffix}`
        insertAsset.run(assetId, `${assetId}.webp`, `blog/gallery-scale/${assetId}`, `blog/gallery-scale/${assetId}`)
        insertAsset.run(thumbnailId, `${thumbnailId}.webp`, `blog/gallery-scale/${thumbnailId}`, `blog/gallery-scale/${thumbnailId}`)
        insertPage.run(`scale-page-row-${suffix}`, page, `Page ${page}`, page - 1, assetId, thumbnailId)
      }
      database.exec('COMMIT')

      const updated = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/posts/post-one/draft', {
        version: 1,
        content_json: { type: 'doc', content: [{ type: 'blogGallery', attrs: { manifestId: 'scale-manifest' } }] },
      }), 'post-one')
      expect(updated.draft.version).toBe(2)
      expect(d1.prepareCount).toBeLessThanOrEqual(64)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_asset_refs WHERE post_id = ? AND scope = \'draft\'').get('post-one').count).toBe(1024)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_gallery_refs WHERE post_id = ? AND scope = \'draft\'').get('post-one').count).toBe(1)
    }
    finally {
      database.close()
    }
  })
})

describe('calendar owner contract', () => {
  it('validates timezone and all-day boundaries, enforces CAS, and archives', async () => {
    const { database, d1, bucket } = fixture()
    try {
      const created = await createCalendarEvent(eventFor(d1, bucket, 'POST', '/calendar/events', {
        title: 'Release',
        kind: 'event',
        all_day: true,
        start_date: '2026-10-28',
        end_date: '2026-10-30',
        visibility: 'private',
      }))
      expect(created.event.timezone).toBe('Asia/Kuala_Lumpur')
      expect(created.event.archived).toBe(false)
      await expect(createCalendarEvent(eventFor(d1, bucket, 'POST', '/calendar/events', {
        title: 'Invalid timestamp',
        kind: 'event',
        starts_at: '2026-02-31T12:00:00Z',
        ends_at: '2026-03-01T12:00:00Z',
      }))).rejects.toMatchObject({ statusCode: 400 })
      const listed = await listCalendarEvents(eventFor(d1, bucket, 'GET', '/calendar/events'))
      expect(listed.events).toHaveLength(1)
      await expect(updateCalendarEvent(eventFor(d1, bucket, 'PUT', '/calendar/events/id', { version: 1, title: 'Stale', kind: 'event', all_day: true, start_date: '2026-10-28', end_date: '2026-10-30' }), 'missing')).rejects.toMatchObject({ statusCode: 404 })
      await expect(updateCalendarEvent(eventFor(d1, bucket, 'PUT', '/calendar/events/id', { version: 0, title: 'Stale' }), created.event.id)).rejects.toMatchObject({ statusCode: 400 })
      const auditsBeforeArchive = database.prepare('SELECT COUNT(*) AS count FROM calendar_audit_records').get().count
      const archived = await updateCalendarEventStatus(eventFor(d1, bucket, 'POST', '/calendar/events/id/status', { version: 1, status: 'archive' }), created.event.id)
      expect(archived.event.archived).toBe(true)
      await expect(updateCalendarEventStatus(eventFor(d1, bucket, 'POST', '/calendar/events/id/status', { version: 1, status: 'restore' }), created.event.id)).rejects.toMatchObject({ statusCode: 409 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM calendar_audit_records').get().count).toBe(auditsBeforeArchive + 1)
    }
    finally {
      database.close()
    }
  })
})
