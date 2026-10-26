import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createEvent } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  checkpointBlogPost,
  completeBlogUpload,
  createBlogPost,
  createBlogTaxonomy,
  createMediaProject,
  initBlogUpload,
  previewBlogPost,
  publishBlogPost,
  putBlogUploadPart,
  restoreBlogPost,
  setBlogPostStatus,
  updateBlogDraft,
  updateMediaProject,
} from '../server/services/blog-studio'

const migrationSql = [
  readFileSync(new URL('../../../migrations/0001_initial.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../migrations/0002_blog_studio.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../migrations/0003_blog_audit.sql', import.meta.url), 'utf8'),
].join('\n')

class SQLiteStatement {
  private readonly statement: ReturnType<DatabaseSync['prepare']>
  private params: unknown[] = []

  constructor(database: DatabaseSync, sql: string) {
    this.statement = database.prepare(sql)
  }

  bind(...params: unknown[]) {
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
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SQLiteStatement(this.database, sql)
  }

  async batch(statements: SQLiteStatement[]) {
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

class FakeUpload {
  parts = new Map<number, string>()
  completed = false
  aborted = false

  async uploadPart(partNumber: number, body: ReadableStream) {
    await new Response(body).arrayBuffer()
    const etag = `etag-${partNumber}`
    this.parts.set(partNumber, etag)
    return { etag }
  }

  async complete(parts: Array<{ partNumber: number, etag: string }>) {
    this.completed = true
    expect(parts).toEqual([{ partNumber: 1, etag: 'etag-1' }])
  }

  async abort() {
    this.aborted = true
  }
}

class FakeBucket {
  readonly upload = new FakeUpload()
  private nextUploadId = 1

  async createMultipartUpload() {
    const uploadId = `r2-upload-${this.nextUploadId++}`
    return { uploadId, uploadPart: this.upload.uploadPart.bind(this.upload), complete: this.upload.complete.bind(this.upload), abort: this.upload.abort.bind(this.upload) }
  }

  resumeMultipartUpload() {
    return this.upload
  }
}

function databaseFixture() {
  const database = new DatabaseSync(':memory:')
  database.exec(migrationSql)
  const d1 = new SQLiteD1(database)
  const bucket = new FakeBucket()
  return { database, d1, bucket }
}

function eventFor(d1: SQLiteD1, bucket: FakeBucket, method: string, path: string, body?: unknown) {
  const rawBody = body instanceof Uint8Array
  const payload = rawBody ? body : body === undefined ? undefined : JSON.stringify(body)
  const event = createEvent({
    method,
    url: path,
    originalUrl: path,
    headers: {
      'content-type': rawBody ? 'application/octet-stream' : 'application/json',
      'content-length': payload === undefined ? '0' : String(rawBody ? payload.byteLength : new TextEncoder().encode(payload as string).byteLength),
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
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: { statusCode: number, statusMessage: string }) => {
    const error = new Error(statusMessage) as Error & { statusCode: number, statusMessage: string }
    error.statusCode = statusCode
    error.statusMessage = statusMessage
    return error
  })
  vi.stubGlobal('setHeader', () => undefined)
  vi.stubGlobal('setResponseHeader', () => undefined)
})

afterAll(() => vi.unstubAllGlobals())

describe('blog studio persistence', () => {
  it('creates new posts with an editor-ready empty Tiptap document', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Editor ready',
        slug: 'editor-ready',
        excerpt: 'A blank editor document',
      })

      expect(created.draft.content_json).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
      expect(created.draft.content_html).toBe('<p></p>')
    }
    finally {
      database.close()
    }
  })

  it('keeps new category and tag assignments private until explicit publication', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const withCategory = await createBlogTaxonomy(eventFor(d1, bucket, 'POST', '/taxonomy', {
        kind: 'category',
        name: 'Projects',
        slug: 'projects',
      }))
      const withTag = await createBlogTaxonomy(eventFor(d1, bucket, 'POST', '/taxonomy', {
        kind: 'tag',
        name: 'Cloudflare',
        slug: 'cloudflare',
      }))
      const category = withCategory.categories.find(item => item.slug === 'projects')
      const tag = withTag.tags.find(item => item.slug === 'cloudflare')
      expect(category).toMatchObject({ name: 'Projects', is_active: 1 })
      expect(tag).toMatchObject({ name: 'Cloudflare' })
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Categorised draft',
        slug: 'categorised-draft',
        excerpt: 'A private project',
      })
      const saved = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        category_id: category.id,
        tag_ids: [tag.id],
      }), created.post.id)

      expect(saved.draft.category_id).toBe(category.id)
      expect(saved.draft.tag_ids).toEqual([tag.id])
      expect(database.prepare('SELECT category_id FROM blog_posts WHERE id = ?').get(created.post.id).category_id).toBeNull()
      expect(database.prepare('SELECT tag_id FROM blog_post_tags WHERE post_id = ?').all(created.post.id)).toEqual([])

      await publishBlogPost(eventFor(d1, bucket, 'POST', '/publish', { version: saved.draft.version }), created.post.id)

      expect(database.prepare('SELECT category_id FROM blog_posts WHERE id = ?').get(created.post.id).category_id).toBe(category.id)
      expect(database.prepare('SELECT tag_id FROM blog_post_tags WHERE post_id = ?').all(created.post.id).map(row => row.tag_id)).toEqual([tag.id])
    }
    finally {
      database.close()
    }
  })

  it('keeps autosaves private, rejects stale CAS writes, and restores checkpoints', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/api/admin/blog/posts'), {
        title: 'Private draft',
        slug: 'private-draft',
        excerpt: 'First excerpt',
        content_html: '<p>First body</p>',
      })
      const checkpoint = await checkpointBlogPost(eventFor(d1, bucket, 'POST', '/checkpoint', { version: 1 }), created.post.id)
      const saved = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: 1,
        title: 'Second title',
        excerpt: 'Second excerpt',
        content_html: '<p>Second body</p>',
      }), created.post.id)
      expect(saved.post.title).toBe('Private draft')
      expect(saved.draft.title).toBe('Second title')
      expect(database.prepare('SELECT title FROM blog_posts WHERE id = ?').get(created.post.id).title).toBe('Private draft')

      const writes = await Promise.allSettled([
        updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', { version: 2, title: 'CAS A' }), created.post.id),
        updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', { version: 2, title: 'CAS B' }), created.post.id),
      ])
      expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect((writes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 })

      const current = database.prepare('SELECT version FROM blog_post_drafts WHERE post_id = ?').get(created.post.id).version
      database.exec(`CREATE TRIGGER fail_restore_revision BEFORE INSERT ON blog_post_revisions
        WHEN NEW.kind = 'restore'
        BEGIN SELECT RAISE(ABORT, 'restore revision failure'); END`)
      await expect(restoreBlogPost(eventFor(d1, bucket, 'POST', '/restore', { version: current, revision_id: checkpoint.revision.id }), created.post.id)).rejects.toThrow('restore revision failure')
      expect(database.prepare('SELECT version FROM blog_post_drafts WHERE post_id = ?').get(created.post.id).version).toBe(current)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_revisions WHERE post_id = ? AND kind = \'restore\'').get(created.post.id).count).toBe(0)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_audit_records WHERE entity_id = ? AND action = \'post.restore\'').get(created.post.id).count).toBe(0)
      database.exec('DROP TRIGGER fail_restore_revision')
      const restored = await restoreBlogPost(eventFor(d1, bucket, 'POST', '/restore', { version: current, revision_id: checkpoint.revision.id }), created.post.id)
      expect(restored.draft.title).toBe('Private draft')
      expect(database.prepare('SELECT version FROM blog_post_revisions WHERE post_id = ? AND kind = \'restore\'').get(created.post.id).version).toBe(current + 1)
      const audits = database.prepare('SELECT action, details_json FROM blog_audit_records WHERE entity_id = ? ORDER BY rowid ASC').all(created.post.id)
      expect(audits.map(row => row.action)).toEqual(['post.create', 'post.checkpoint', 'post.draft', 'post.draft', 'post.restore'])
      expect(audits.map(row => row.details_json).join('')).not.toContain('Second body')
    }
    finally {
      database.close()
    }
  })

  it('restores an old slug revision into the current published URL draft', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Original title',
        slug: 'original-slug',
        excerpt: 'Original excerpt',
        content_html: '<p>Original body</p>',
      })
      const original = database.prepare('SELECT id FROM blog_post_revisions WHERE post_id = ? AND kind = \'original\'').get(created.post.id)
      const renamed = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        slug: 'published-slug',
        title: 'Published title',
      }), created.post.id)
      const published = await publishBlogPost(eventFor(d1, bucket, 'POST', '/publish', { version: renamed.draft.version }), created.post.id)
      expect(published.post.slug).toBe('published-slug')
      const unpublished = await setBlogPostStatus(eventFor(d1, bucket, 'POST', '/status', { status: 'draft' }), created.post.id)

      const restored = await restoreBlogPost(eventFor(d1, bucket, 'POST', '/restore', {
        version: unpublished.draft.version,
        revision_id: original.id,
      }), created.post.id)

      expect(restored.post.status).toBe('draft')
      expect(restored.post.slug).toBe('published-slug')
      expect(restored.draft.slug).toBe('published-slug')
      expect(restored.draft.title).toBe('Original title')
      expect(restored.draft.content_html).toBe('<p>Original body</p>')
    }
    finally {
      database.close()
    }
  })

  it('maps duplicate create and publish slug races to 409 without partial writes', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const creations = await Promise.allSettled([
        createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), { title: 'Race one', slug: 'race-slug', excerpt: 'One', content_html: '<p>One</p>' }),
        createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), { title: 'Race two', slug: 'race-slug', excerpt: 'Two', content_html: '<p>Two</p>' }),
      ])
      expect(creations.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(creations.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect((creations.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_posts WHERE slug = ?').get('race-slug').count).toBe(1)

      const first = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), { title: 'Publish one', slug: 'publish-one', excerpt: 'One', content_html: '<p>One</p>' })
      const second = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), { title: 'Publish two', slug: 'publish-two', excerpt: 'Two', content_html: '<p>Two</p>' })
      const firstDraft = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', { version: first.draft.version, slug: 'published-race' }), first.post.id)
      const secondDraft = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', { version: second.draft.version, slug: 'published-race' }), second.post.id)
      const publishes = await Promise.allSettled([
        publishBlogPost(eventFor(d1, bucket, 'POST', '/publish', { version: firstDraft.draft.version }), first.post.id),
        publishBlogPost(eventFor(d1, bucket, 'POST', '/publish', { version: secondDraft.draft.version }), second.post.id),
      ])
      expect(publishes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(publishes.filter(result => result.status === 'rejected')).toHaveLength(1)
      expect((publishes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_posts WHERE slug = ? AND status = \'published\'').get('published-race').count).toBe(1)
      expect(database.prepare('SELECT status FROM blog_posts WHERE id = ?').get(second.post.id).status === 'draft' || database.prepare('SELECT status FROM blog_posts WHERE id = ?').get(first.post.id).status === 'draft').toBe(true)
      expect(database.prepare('SELECT COUNT(*) AS count FROM blog_post_revisions WHERE post_id IN (?, ?) AND kind = \'publish\'').get(first.post.id, second.post.id).count).toBe(1)
    }
    finally {
      database.close()
    }
  })

  it('promotes sanitized content and media references atomically, then supports unpublish', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const upload = await initBlogUpload(eventFor(d1, bucket, 'POST', '/uploads', {
        filename: 'photo.png',
        mime_type: 'image/png',
        size: 4,
        duration_ms: 0,
      }))
      expect(upload.asset.duration_ms).toBe(0)
      const longSource = await initBlogUpload(eventFor(d1, bucket, 'POST', '/uploads', {
        filename: 'long-source.mp4',
        mime_type: 'video/mp4',
        size: 4,
        duration_ms: 600_000,
      }))
      expect(longSource.asset.duration_ms).toBe(600_000)
      await putBlogUploadPart(eventFor(d1, bucket, 'PUT', '/parts/1', new Uint8Array([1, 2, 3, 4])), upload.upload.id, 1)
      const completed = await completeBlogUpload(eventFor(d1, bucket, 'POST', '/complete', { parts: [{ part_number: 1, etag: 'etag-1' }] }), upload.upload.id)
      const retried = await completeBlogUpload(eventFor(d1, bucket, 'POST', '/complete', { parts: [{ part_number: 1, etag: 'etag-1' }] }), upload.upload.id)
      expect(retried.asset.id).toBe(completed.asset.id)
      const assetId = completed.asset.id
      await expect(initBlogUpload(eventFor(d1, bucket, 'POST', '/uploads', {
        filename: 'too-long-output.mp4',
        mime_type: 'video/mp4',
        size: 4,
        duration_ms: 300_001,
        derived_from: [assetId],
      }))).rejects.toMatchObject({ statusCode: 400 })
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Publishable',
        slug: 'publishable',
        excerpt: 'Published excerpt',
        content_html: '<p>Draft</p>',
      })
      database.prepare(`
        INSERT INTO blog_assets (id, name, mime_type, kind, size, object_key, source_object_key, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      `).run('video-asset', 'video.mp4', 'video/mp4', 'video', 4, 'blog/derived/video-asset.mp4', 'blog/originals/video-asset/video.mp4', 'owner', new Date().toISOString())
      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        content_html: '<video src="/media/blog/video-asset" poster="/media/blog/video-asset"></video>',
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })
      const legacyVideo = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        content_html: `<video src="/media/blog/video-asset" poster="/media/blog/${assetId}"></video>`,
      }), created.post.id)
      expect(legacyVideo.draft.content_html).toContain(`/media/blog/${assetId}`)
      const saved = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: legacyVideo.draft.version,
        cover_image_url: `/media/blog/${assetId}`,
        content_json: {
          type: 'doc',
          content: [{ type: 'blogMedia', attrs: { assetId: 'video-asset', posterAssetId: assetId, kind: 'video', src: 'https://forged.invalid/a.mp4', alt: 'Video', width: 100, align: 'center' } }],
        },
      }), created.post.id)
      expect(saved.draft.content_html).toContain('/media/blog/video-asset')
      expect(saved.draft.content_html).toContain(`/media/blog/${assetId}`)
      expect(saved.draft.content_html).not.toContain('forged.invalid')

      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: saved.draft.version,
        cover_image_url: '/media/blog/video-asset',
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })
      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: saved.draft.version,
        cover_image_url: '/api/admin/blog/media/video-asset/source',
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })
      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: saved.draft.version,
        cover_image_url: `/media/blog/${assetId}?cache=1`,
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })
      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: saved.draft.version,
        cover_image_url: '/assets/unknown-cover.png',
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })

      const published = await publishBlogPost(eventFor(d1, bucket, 'POST', '/publish', { version: saved.draft.version }), created.post.id)
      expect(published.post.status).toBe('published')
      expect(published.post.published_version).toBe(published.draft.version)
      expect(published.post.cover_image_url).toBe(`/media/blog/${assetId}`)
      expect(database.prepare('SELECT scope FROM blog_post_asset_refs WHERE post_id = ? AND asset_id = ? AND scope = \'published\'').get(created.post.id, assetId).scope).toBe('published')
      expect(database.prepare('SELECT scope FROM blog_post_asset_refs WHERE post_id = ? AND asset_id = ? AND scope = \'published\'').get(created.post.id, 'video-asset').scope).toBe('published')

      const unpublished = await setBlogPostStatus(eventFor(d1, bucket, 'POST', '/status', { status: 'draft' }), created.post.id)
      expect(unpublished.post.status).toBe('draft')
      const postActions = database.prepare('SELECT action FROM blog_audit_records WHERE entity_id = ? ORDER BY rowid ASC').all(created.post.id).map(row => row.action)
      expect(postActions).toEqual(expect.arrayContaining(['post.create', 'post.draft', 'post.publish', 'post.status']))
      const uploadActions = database.prepare('SELECT action FROM blog_audit_records WHERE entity_id = ? ORDER BY rowid ASC').all(assetId).map(row => row.action)
      expect(uploadActions).toEqual(['media.upload.init', 'media.upload.part', 'media.upload.complete'])
    }
    finally {
      database.close()
    }
  })

  it('preserves untouched legacy HTML and restricts legacy conversion to original media paths', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      await expect(createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Private cover',
        slug: 'private-cover',
        excerpt: 'Rejected cover',
        content_html: '<p>Body</p>',
        cover_image_url: '/api/admin/blog/media/secret/source',
      })).rejects.toMatchObject({ statusCode: 400 })
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Legacy article',
        slug: 'legacy-article',
        excerpt: 'Legacy excerpt',
        content_html: '<h2 id="chapter-1">Legacy heading</h2><p><img src="/assets/legacy.png" alt="Legacy"></p>',
      })
      database.prepare('UPDATE blog_posts SET cover_image_url = ? WHERE id = ?').run('/assets/known-cover.png', created.post.id)
      database.prepare('UPDATE blog_post_drafts SET cover_image_url = ? WHERE post_id = ?').run('/assets/known-cover.png', created.post.id)
      const originalHtml = created.draft.content_html
      const metadataOnly = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        title: 'Legacy article renamed',
      }), created.post.id)
      expect(metadataOnly.draft.content_json).toBeNull()
      expect(metadataOnly.draft.content_html).toBe(originalHtml)
      expect(metadataOnly.draft.content_html).toContain('id="chapter-1"')
      expect(metadataOnly.draft.cover_image_url).toBe('/assets/known-cover.png')

      const converted = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: metadataOnly.draft.version,
        content_json: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Converted body' }] },
            { type: 'blogMedia', attrs: { assetId: 'legacy:/assets/legacy.png', kind: 'image', src: 'https://forged.invalid/legacy.png', alt: 'Legacy', width: 100, align: 'center' } },
          ],
        },
      }), created.post.id)
      expect(converted.draft.content_html).toContain('src="/assets/legacy.png"')
      expect(converted.draft.content_html).not.toContain('forged.invalid')

      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: converted.draft.version,
        content_json: {
          type: 'doc',
          content: [{ type: 'blogMedia', attrs: { assetId: 'legacy:/assets/not-approved.png', kind: 'image', alt: 'Nope', width: 100, align: 'center' } }],
        },
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })

      await expect(updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: converted.draft.version,
        content_json: {
          type: 'doc',
          content: [{ type: 'blogMedia', attrs: { assetId: 'legacy:/media/blog/originals/private.png', kind: 'image', alt: 'Nope', width: 100, align: 'center' } }],
        },
      }), created.post.id)).rejects.toMatchObject({ statusCode: 400 })
    }
    finally {
      database.close()
    }
  })

  it('serves private source URLs in no-store previews and validates project shape', async () => {
    const { database, d1, bucket } = databaseFixture()
    try {
      const upload = await initBlogUpload(eventFor(d1, bucket, 'POST', '/uploads', {
        filename: 'photo.png',
        mime_type: 'image/png',
        size: 4,
      }))
      await putBlogUploadPart(eventFor(d1, bucket, 'PUT', '/parts/1', new Uint8Array([1, 2, 3, 4])), upload.upload.id, 1)
      const completed = await completeBlogUpload(eventFor(d1, bucket, 'POST', '/complete', { parts: [{ part_number: 1, etag: 'etag-1' }] }), upload.upload.id)
      const created = await createBlogPost(eventFor(d1, bucket, 'POST', '/posts'), {
        title: 'Preview',
        slug: 'preview',
        excerpt: 'Preview excerpt',
        content_html: '<p>Draft</p>',
      })
      const saved = await updateBlogDraft(eventFor(d1, bucket, 'PUT', '/draft', {
        version: created.draft.version,
        content_json: {
          type: 'doc',
          content: [{ type: 'blogMedia', attrs: { assetId: completed.asset.id, kind: 'image', src: 'https://forged.invalid/a.png', alt: 'Photo', width: 100, align: 'center' } }],
        },
      }), created.post.id)
      const preview = await previewBlogPost(eventFor(d1, bucket, 'GET', '/preview'), created.post.id)
      expect(preview).toContain(`/api/admin/blog/media/${completed.asset.id}/source`)
      expect(preview).not.toContain('/media/blog/')
      expect(preview).not.toContain('<script')
      expect(saved.draft.content_html).toContain(`/media/blog/${completed.asset.id}`)

      const project = await createMediaProject(eventFor(d1, bucket, 'POST', '/projects', {
        title: 'Photo project',
        document: {
          schema_version: 1,
          kind: 'image',
          clips: [{ id: 'clip-1', asset_id: completed.asset.id, in_ms: 0, out_ms: 1, rate: 1, volume: 1, muted: false, rotate: 0, flip_x: false, flip_y: false, crop: null, brightness: 0, contrast: 1, saturation: 1, grayscale: false }],
          frames: [],
          output: { format: 'png', width: 1280, height: 720, fps: 30, quality: 0.9, loop: 1 },
        },
      }))
      expect(project.project.version).toBe(1)
      expect(database.prepare('SELECT document FROM blog_media_projects WHERE id = ?').get(project.project.id).document).toContain('schema_version')
      expect(database.prepare('SELECT action FROM blog_audit_records WHERE entity_id = ?').get(project.project.id).action).toBe('media.project.create')
      await updateMediaProject(eventFor(d1, bucket, 'PUT', '/projects', { version: 1, title: 'Photo project updated', document: project.project.document }), project.project.id)
      await expect(updateMediaProject(eventFor(d1, bucket, 'PUT', '/projects', { version: 1, title: 'Stale update', document: project.project.document }), project.project.id)).rejects.toMatchObject({ statusCode: 409 })
      expect(database.prepare('SELECT action FROM blog_audit_records WHERE entity_id = ? ORDER BY rowid ASC').all(project.project.id).map(row => row.action)).toEqual(['media.project.create', 'media.project.update'])
    }
    finally {
      database.close()
    }
  })
})
