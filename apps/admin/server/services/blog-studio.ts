import type { H3Event } from 'h3'
import { getHeader, getRequestWebStream, getRouterParam, readBody } from 'h3'
import { BLOG_MAX_CANONICAL_BYTES, BLOG_SCHEMA_VERSION, blogByteLength, legacyMediaKind, legacyMediaPathsFromHtml, normalizeLegacyMediaPath, renderTiptapDocument, sanitizeLegacyBlogHtml, snapshotDraft } from '../utils/blog-content'
import { getRuntimeString } from '../utils/runtime-config'

export const BLOG_UPLOAD_PART_SIZE = 10 * 1024 * 1024
export const BLOG_MAX_SOURCE_SIZE = 250 * 1024 * 1024
export const BLOG_MAX_UPLOAD_PARTS = Math.ceil(BLOG_MAX_SOURCE_SIZE / BLOG_UPLOAD_PART_SIZE)
export const BLOG_GALLERY_MAX_PAGES = 512
export const BLOG_GALLERY_SOURCE_MIME = 'application/pdf'
const BLOG_MAX_JSON_BODY_BYTES = BLOG_MAX_CANONICAL_BYTES * 2 + 64 * 1024
const BLOG_MAX_PROJECT_DEPTH = 64
const BLOG_MAX_PROJECT_NODES = 10_000

interface KnownLengthStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

function knownLengthStream(length: number): KnownLengthStream {
  if (typeof FixedLengthStream !== 'undefined')
    return new FixedLengthStream(length) as unknown as KnownLengthStream
  return new TransformStream<Uint8Array, Uint8Array>()
}

type D1Like = D1Database
type BlogEnv = Cloudflare.Env & { PORTFOLIO_MEDIA?: R2Bucket }

export interface BlogDraft {
  version: number
  schema_version: 1
  title: string
  slug: string
  excerpt: string
  category_id: string | null
  tag_ids: string[]
  cover_image_url: string | null
  cover_image_alt: string | null
  read_minutes: number
  meta_title: string | null
  meta_description: string | null
  content_json: Record<string, unknown> | null
  content_html: string
  gallery_manifest_ids: string[]
  updated_at: string
}

export interface BlogPost {
  id: string
  slug: string
  title: string
  excerpt: string
  cover_image_url: string | null
  cover_image_alt: string | null
  read_minutes: number
  published_at: string | null
  status: 'draft' | 'published' | 'archived'
  category_id: string | null
  category: { id: string, slug: string, name: string, color_class: string | null, sort_order: number } | null
  published_version: number | null
  has_unpublished_changes: boolean
  meta_title: string | null
  meta_description: string | null
  canonical_path: string | null
}

export interface BlogDetail {
  post: BlogPost
  draft: BlogDraft
}

interface DraftInput {
  title: string
  slug: string
  excerpt: string
  category_id: string | null
  tag_ids: string[]
  cover_image_url: string | null
  cover_image_alt: string | null
  read_minutes: number
  meta_title: string | null
  meta_description: string | null
  content_json: Record<string, unknown> | null
  content_html: string
  asset_ids: string[]
  gallery_manifest_ids: string[]
}

function rows<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result))
    return result as T[]
  const value = result as { results?: unknown[] } | null
  return Array.isArray(value?.results) ? value.results as T[] : []
}

function first<T = Record<string, unknown>>(result: unknown): T | null {
  if (result && typeof result === 'object' && 'results' in result) {
    const resultRows = rows<T>(result)
    return resultRows[0] ?? null
  }
  return result as T | null
}

function changes(result: unknown): number {
  const value = result as { meta?: { changes?: number }, changes?: number } | null
  return Number(value?.meta?.changes ?? value?.changes ?? 0)
}

function isBlogSlugUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint failed:\s*blog_posts\.slug\b/i.test(message)
}

function throwSlugConflict(): never {
  throw createError({ statusCode: 409, statusMessage: 'A post with this slug already exists' })
}

function auditInsert(
  db: D1Like,
  actor: string,
  action: string,
  entityId: string | null,
  details: Record<string, unknown>,
  condition?: string,
  conditionParams: unknown[] = [],
) {
  const where = condition ? ` WHERE ${condition}` : ''
  return db.prepare(`
    INSERT INTO blog_audit_records (actor, action, entity_id, details_json, created_at)
    SELECT ?, ?, ?, ?, ?${where}
  `).bind(actor, action, entityId, JSON.stringify(details), new Date().toISOString(), ...conditionParams)
}

function requireDb(event: H3Event): D1Like {
  const env = event.context.cloudflare?.env as BlogEnv | undefined
  if (!env?.PORTFOLIO_DB)
    throw createError({ statusCode: 503, statusMessage: 'Portfolio database binding not configured' })
  return env.PORTFOLIO_DB
}

export function blogEnv(event: H3Event): BlogEnv {
  return (event.context.cloudflare?.env ?? {}) as BlogEnv
}

export function requirePortfolioMedia(event: H3Event): R2Bucket {
  const env = blogEnv(event)
  if (!env.PORTFOLIO_MEDIA)
    throw createError({ statusCode: 503, statusMessage: 'Portfolio media binding not configured' })
  return env.PORTFOLIO_MEDIA
}

export function blogActor(event: H3Event): string {
  const authMethod = String(event.context.authMethod ?? '')
  const gatewayUser = String(event.context.userEmail ?? '').trim().toLowerCase()
  if (authMethod === 'portfolio-gateway') {
    const adminEmail = getRuntimeString(event, 'adminEmail', 'ADMIN_EMAIL').trim().toLowerCase()
    if (!gatewayUser || !adminEmail || gatewayUser !== adminEmail)
      throw createError({ statusCode: 403, statusMessage: 'Owner sign-in is required for blog authoring' })
  }
  if (!['access-user', 'local-admin', 'portfolio-gateway'].includes(authMethod))
    throw createError({ statusCode: 403, statusMessage: 'Owner sign-in is required for blog authoring' })
  const actor = String(event.context.userID ?? '').trim()
  return actor || 'root'
}

export function requestOrigin(event: H3Event): string {
  const requestUrl = getRequestURL(event)
  return requestUrl.origin
}

function stringField(value: unknown, key: string, max: number, required = true): string {
  if (value == null && !required)
    return ''
  if (typeof value !== 'string')
    throw createError({ statusCode: 400, statusMessage: `${key} must be a string` })
  const result = value.trim()
  if (required && !result)
    throw createError({ statusCode: 400, statusMessage: `${key} is required` })
  if (result.length > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is too long` })
  return result
}

function nullableString(value: unknown, key: string, max: number): string | null {
  if (value == null || value === '')
    return null
  return stringField(value, key, max)
}

function slugField(value: unknown, key = 'slug'): string {
  const slug = stringField(value, key, 160).toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw createError({ statusCode: 400, statusMessage: `${key} must be URL-safe` })
  return slug
}

function idField(value: unknown, key: string): string {
  const id = stringField(value, key, 128)
  if (!/^[\w-]+$/.test(id))
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return id
}

function integerField(value: unknown, key: string, min: number, max: number, fallback?: number): number {
  if (value == null && fallback !== undefined)
    return fallback
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return number
}

const BLOG_COVER_ASSET_PATH = /^\/media\/blog\/([\w-]+)$/

function blogCoverAssetId(value: string | null): string | null {
  return value ? BLOG_COVER_ASSET_PATH.exec(value)?.[1] ?? null : null
}

function safeCoverUrl(value: unknown): string | null {
  const cover = nullableString(value, 'cover_image_url', 2_048)
  if (!cover)
    return null
  if (BLOG_COVER_ASSET_PATH.test(cover))
    return cover
  if (cover.startsWith('/media/blog/'))
    throw createError({ statusCode: 400, statusMessage: 'cover_image_url must use a canonical media asset path' })
  const legacyPath = normalizeLegacyMediaPath(cover)
  if (!legacyPath)
    throw createError({ statusCode: 400, statusMessage: 'cover_image_url must be a same-origin legacy media path or approved asset' })
  return legacyPath
}

export function parseJsonBody<T extends Record<string, unknown>>(event: H3Event): Promise<T> {
  const contentLength = getHeader(event, 'content-length')
  if (contentLength) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > BLOG_MAX_JSON_BODY_BYTES)
      throw createError({ statusCode: 413, statusMessage: 'JSON request body is too large' })
  }
  const requestBody = getRequestWebStream(event)
  const bodyPromise = requestBody && typeof (requestBody as ReadableStream).getReader === 'function'
    ? readJsonStream<T>(requestBody as ReadableStream)
    : readBody<T>(event)
  return bodyPromise.then((body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object' })
    let serialized: string
    try {
      serialized = JSON.stringify(body)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'Request body must be JSON serializable' })
    }
    if (blogByteLength(serialized) > BLOG_MAX_JSON_BODY_BYTES)
      throw createError({ statusCode: 413, statusMessage: 'JSON request body is too large' })
    return body
  })
}

async function readJsonStream<T extends Record<string, unknown>>(stream: ReadableStream): Promise<T> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done)
        break
      const value = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value)
      size += value.byteLength
      if (size > BLOG_MAX_JSON_BODY_BYTES) {
        await reader.cancel()
        throw createError({ statusCode: 413, statusMessage: 'JSON request body is too large' })
      }
      chunks.push(value)
    }
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error)
      throw error
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
  const bodyText = new TextDecoder().decode(concatBytes(chunks, size))
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid JSON body' })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw createError({ statusCode: 400, statusMessage: 'Request body must be a JSON object' })
  return body as T
}

function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function canonicalJsonValue(value: unknown, depth = 0, state = { nodes: 0 }): unknown {
  if (depth > BLOG_MAX_PROJECT_DEPTH)
    throw createError({ statusCode: 400, statusMessage: 'JSON document is too deeply nested' })
  state.nodes += 1
  if (state.nodes > BLOG_MAX_PROJECT_NODES)
    throw createError({ statusCode: 400, statusMessage: 'JSON document is too large' })
  if (typeof value === 'string') {
    if (/^data:/i.test(value.trim()))
      throw createError({ statusCode: 400, statusMessage: 'Inline media data is not allowed' })
    return value
  }
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw createError({ statusCode: 400, statusMessage: 'Media project values must be finite' })
    return value
  }
  if (Array.isArray(value))
    return value.map(child => canonicalJsonValue(child, depth + 1, state))
  if (typeof value !== 'object')
    throw createError({ statusCode: 400, statusMessage: 'Media project document contains an unsupported value' })
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, canonicalJsonValue(record[key], depth + 1, state)]))
}

function finiteProjectNumber(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return value
}

function projectObject(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createError({ statusCode: 400, statusMessage: `${key} must be an object` })
  return value as Record<string, unknown>
}

function projectString(value: unknown, key: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw createError({ statusCode: 400, statusMessage: `${key} is invalid` })
  return value
}

function validateMediaProjectDocument(value: unknown): string {
  const document = projectObject(value, 'document')
  if (document.schema_version !== 1)
    throw createError({ statusCode: 400, statusMessage: 'document schema_version must be 1' })
  const kind = String(document.kind)
  if (!['image', 'video', 'gif'].includes(kind))
    throw createError({ statusCode: 400, statusMessage: 'document kind is invalid' })
  if (!Array.isArray(document.clips) || !document.clips.length || document.clips.length > 30)
    throw createError({ statusCode: 400, statusMessage: 'document clips are invalid' })
  if (kind !== 'video' && document.clips.length !== 1)
    throw createError({ statusCode: 400, statusMessage: 'Image and GIF projects use one source asset' })
  for (const [index, rawClip] of document.clips.entries()) {
    const clip = projectObject(rawClip, `clips[${index}]`)
    projectString(clip.id, `clips[${index}].id`, 128)
    projectString(clip.asset_id, `clips[${index}].asset_id`, 128)
    finiteProjectNumber(clip.in_ms, `clips[${index}].in_ms`, 0, BLOG_MAX_SOURCE_SIZE)
    finiteProjectNumber(clip.out_ms, `clips[${index}].out_ms`, 0, BLOG_MAX_SOURCE_SIZE)
    finiteProjectNumber(clip.rate, `clips[${index}].rate`, 0.5, 2)
    finiteProjectNumber(clip.volume, `clips[${index}].volume`, 0, 2)
    for (const key of ['muted', 'flip_x', 'flip_y', 'grayscale'] as const) {
      if (typeof clip[key] !== 'boolean')
        throw createError({ statusCode: 400, statusMessage: `clips[${index}].${key} is invalid` })
    }
    if (![0, 90, 180, 270].includes(Number(clip.rotate)))
      throw createError({ statusCode: 400, statusMessage: `clips[${index}].rotate is invalid` })
    finiteProjectNumber(clip.brightness, `clips[${index}].brightness`, -1, 1)
    finiteProjectNumber(clip.contrast, `clips[${index}].contrast`, 0, 2)
    finiteProjectNumber(clip.saturation, `clips[${index}].saturation`, 0, 2)
    if (kind !== 'image' && Number(clip.out_ms) <= Number(clip.in_ms))
      throw createError({ statusCode: 400, statusMessage: `clips[${index}] has invalid timing` })
    if (clip.crop !== null) {
      const crop = projectObject(clip.crop, `clips[${index}].crop`)
      finiteProjectNumber(crop.x, `clips[${index}].crop.x`, 0, 1)
      finiteProjectNumber(crop.y, `clips[${index}].crop.y`, 0, 1)
      finiteProjectNumber(crop.width, `clips[${index}].crop.width`, 0.001, 1)
      finiteProjectNumber(crop.height, `clips[${index}].crop.height`, 0.001, 1)
      if (Number(crop.x) + Number(crop.width) > 1.000001 || Number(crop.y) + Number(crop.height) > 1.000001)
        throw createError({ statusCode: 400, statusMessage: `clips[${index}].crop is outside the source` })
    }
  }
  if (!Array.isArray(document.frames) || document.frames.length > 900)
    throw createError({ statusCode: 400, statusMessage: 'document frames are invalid' })
  for (const [index, rawFrame] of document.frames.entries()) {
    const frame = projectObject(rawFrame, `frames[${index}]`)
    if (!Number.isInteger(frame.source_index) || Number(frame.source_index) < 0)
      throw createError({ statusCode: 400, statusMessage: `frames[${index}].source_index is invalid` })
    finiteProjectNumber(frame.delay_ms, `frames[${index}].delay_ms`, 10, 30_000)
    if (typeof frame.enabled !== 'boolean')
      throw createError({ statusCode: 400, statusMessage: `frames[${index}].enabled is invalid` })
  }
  if ((kind === 'gif' || document.frames.length) && (!document.frames.length || !document.frames.some(frame => projectObject(frame, 'frame').enabled === true)))
    throw createError({ statusCode: 400, statusMessage: 'Select at least one GIF frame' })
  const output = projectObject(document.output, 'document.output')
  const supportedFormats: Record<string, string[]> = {
    image: ['png', 'jpeg', 'webp'],
    video: ['mp4', 'webm', 'gif'],
    gif: ['gif', 'mp4', 'webm'],
  }
  if (!supportedFormats[kind]?.includes(String(output.format)))
    throw createError({ statusCode: 400, statusMessage: 'document.output.format is invalid' })
  const isGif = output.format === 'gif'
  const maxWidth = isGif ? 720 : kind === 'image' ? 4096 : 1920
  const maxHeight = isGif ? 720 : kind === 'image' ? 4096 : 1080
  if (!Number.isInteger(output.width) || Number(output.width) < 1 || Number(output.width) > maxWidth)
    throw createError({ statusCode: 400, statusMessage: 'document.output.width is invalid' })
  if (!Number.isInteger(output.height) || Number(output.height) < 1 || Number(output.height) > maxHeight)
    throw createError({ statusCode: 400, statusMessage: 'document.output.height is invalid' })
  finiteProjectNumber(output.fps, 'document.output.fps', 1, isGif ? 15 : 30)
  finiteProjectNumber(output.quality, 'document.output.quality', 0.1, 1)
  if (!Number.isInteger(output.loop) || Number(output.loop) < 0 || Number(output.loop) > 100)
    throw createError({ statusCode: 400, statusMessage: 'document.output.loop is invalid' })
  const duration = isGif || kind === 'gif'
    ? document.frames.filter(frame => projectObject(frame, 'frame').enabled).reduce((sum, frame) => sum + Number(projectObject(frame, 'frame').delay_ms), 0)
    : document.clips.reduce((sum, rawClip) => {
        const clip = projectObject(rawClip, 'clip')
        return sum + (Number(clip.out_ms) - Number(clip.in_ms)) / Number(clip.rate)
      }, 0)
  if (duration > (isGif || kind === 'gif' ? 30_000 : 300_000))
    throw createError({ statusCode: 400, statusMessage: isGif || kind === 'gif' ? 'GIF projects can contain up to 30 seconds' : 'Video projects can contain up to five minutes' })
  const canonical = canonicalJsonValue(document)
  const serialized = JSON.stringify(canonical)
  if (blogByteLength(serialized) > BLOG_MAX_CANONICAL_BYTES)
    throw createError({ statusCode: 400, statusMessage: 'Media project document is too large' })
  return serialized
}

async function validateProjectAssets(db: D1Like, actor: string, value: unknown): Promise<void> {
  const document = projectObject(value, 'document')
  const clips = document.clips as Array<Record<string, unknown>>
  const assetIds = [...new Set(clips.map(clip => String(clip.asset_id)))]
  const result = await db.prepare(`SELECT id, size FROM blog_assets WHERE created_by = ? AND status = 'ready' AND id IN (${assetIds.map(() => '?').join(',')})`).bind(actor, ...assetIds).all()
  const assets = rows<{ id: string, size: number }>(result)
  if (assets.length !== assetIds.length)
    throw createError({ statusCode: 400, statusMessage: 'A project source asset is unavailable' })
  if (assets.reduce((sum, asset) => sum + Number(asset.size), 0) > BLOG_MAX_SOURCE_SIZE)
    throw createError({ statusCode: 400, statusMessage: 'A media project can contain up to 250 MiB of source files' })
}

async function tagsFor(db: D1Like, postId: string, draft = true): Promise<string[]> {
  const table = draft ? 'blog_post_draft_tags' : 'blog_post_tags'
  const column = draft ? 'post_id' : 'post_id'
  const result = await db.prepare(`SELECT tag_id FROM ${table} WHERE ${column} = ? ORDER BY tag_id ASC`).bind(postId).all()
  return rows<{ tag_id: string }>(result).map(row => row.tag_id)
}

async function galleryReferencesFor(db: D1Like, postId: string, scope: 'draft' | 'published' = 'draft'): Promise<string[]> {
  const result = await db.prepare('SELECT manifest_id FROM blog_post_gallery_refs WHERE post_id = ? AND scope = ? ORDER BY manifest_id ASC').bind(postId, scope).all()
  return rows<{ manifest_id: string }>(result).map(row => row.manifest_id)
}

function galleryIdsFromDocument(value: unknown, result: string[] = []): string[] {
  if (!value || typeof value !== 'object')
    return result
  if (Array.isArray(value)) {
    for (const child of value)
      galleryIdsFromDocument(child, result)
    return result
  }
  const record = value as Record<string, unknown>
  if (record.type === 'blogGallery' && record.attrs && typeof record.attrs === 'object') {
    const manifestId = (record.attrs as Record<string, unknown>).manifestId
    if (typeof manifestId === 'string' && !result.includes(manifestId))
      result.push(manifestId)
  }
  for (const child of Object.values(record))
    galleryIdsFromDocument(child, result)
  return result
}

async function galleryManifestAssetIds(db: D1Like, actor: string, manifestIds: string[], postId?: string): Promise<string[]> {
  if (!manifestIds.length)
    return []
  const placeholders = manifestIds.map(() => '?').join(',')
  const params: unknown[] = [...manifestIds, actor]
  let postClause = ''
  if (postId) {
    postClause = ' AND g.post_id = ?'
    params.push(postId)
  }
  const result = await db.prepare(`
    SELECT DISTINCT mp.asset_id, mp.thumbnail_asset_id
    FROM blog_gallery_manifests AS m
    INNER JOIN blog_galleries AS g ON g.id = m.gallery_id
    INNER JOIN blog_gallery_manifest_pages AS mp ON mp.manifest_id = m.id
    WHERE m.id IN (${placeholders})
      AND mp.visible = 1
      AND g.created_by = ?${postClause}
  `).bind(...params).all()
  const ids: string[] = []
  for (const row of rows<{ asset_id: string, thumbnail_asset_id: string }>(result)) {
    for (const id of [row.asset_id, row.thumbnail_asset_id]) {
      if (id && !ids.includes(id))
        ids.push(id)
    }
  }
  return ids
}

async function galleryResolver(db: D1Like, actor: string, postId?: string) {
  return async (manifestId: string) => {
    const params: unknown[] = [manifestId, actor]
    const postClause = postId ? ' AND g.post_id = ?' : ''
    if (postId)
      params.push(postId)
    const row = first<{ id: string, title: string, page_count: number }>(await db.prepare(`
      SELECT m.id, m.title, COUNT(mp.page_id) AS page_count
      FROM blog_gallery_manifests AS m
      INNER JOIN blog_galleries AS g ON g.id = m.gallery_id
      LEFT JOIN blog_gallery_manifest_pages AS mp ON mp.manifest_id = m.id
      WHERE m.id = ? AND g.created_by = ?${postClause}
      GROUP BY m.id, m.title
      LIMIT 1
    `).bind(...params).all())
    if (!row)
      return null
    const firstPage = first<{ asset_id: string, thumbnail_asset_id: string | null }>(await db.prepare(`
      SELECT mp.asset_id, mp.thumbnail_asset_id
      FROM blog_gallery_manifest_pages AS mp
      WHERE mp.manifest_id = ? AND mp.visible = 1
      ORDER BY mp.sort_order ASC, mp.original_page ASC
      LIMIT 1
    `).bind(row.id).all())
    return {
      id: row.id,
      title: row.title,
      pageCount: Number(row.page_count),
      firstPage: firstPage ? { assetId: firstPage.asset_id, thumbnailAssetId: firstPage.thumbnail_asset_id } : null,
    }
  }
}

async function validateGalleryReferences(db: D1Like, actor: string, postId: string | undefined, manifestIds: string[]): Promise<void> {
  if (!manifestIds.length)
    return
  if (!postId)
    throw createError({ statusCode: 400, statusMessage: 'Save the post before adding a gallery' })
  const placeholders = manifestIds.map(() => '?').join(',')
  const params: unknown[] = [...manifestIds, actor, postId]
  const result = await db.prepare(`
    SELECT m.id
    FROM blog_gallery_manifests AS m
    INNER JOIN blog_galleries AS g ON g.id = m.gallery_id
    WHERE m.id IN (${placeholders}) AND g.created_by = ? AND g.post_id = ?
  `).bind(...params).all()
  const found = new Set(rows<{ id: string }>(result).map(row => row.id))
  if (manifestIds.some(id => !found.has(id)))
    throw createError({ statusCode: 400, statusMessage: 'Referenced gallery manifest is unavailable' })
}

async function validateGalleryManifestAssets(db: D1Like, actor: string, postId: string, manifestIds: string[]): Promise<void> {
  if (!manifestIds.length)
    return
  const placeholders = manifestIds.map(() => '?').join(',')
  const result = await db.prepare(`
    SELECT m.id,
      COUNT(mp.page_id) AS page_count,
      SUM(CASE WHEN mp.visible IN (0, 1)
        AND a.status = 'ready' AND a.created_by = ?
        AND ta.status = 'ready' AND ta.created_by = ?
        THEN 1 ELSE 0 END) AS ready_count
    FROM blog_gallery_manifests AS m
    INNER JOIN blog_galleries AS g ON g.id = m.gallery_id
    LEFT JOIN blog_gallery_manifest_pages AS mp ON mp.manifest_id = m.id
    LEFT JOIN blog_assets AS a ON a.id = mp.asset_id
    LEFT JOIN blog_assets AS ta ON ta.id = mp.thumbnail_asset_id
    WHERE m.id IN (${placeholders}) AND g.post_id = ? AND g.created_by = ?
    GROUP BY m.id
  `).bind(actor, actor, ...manifestIds, postId, actor).all()
  const found = new Map(rows<{ id: string, page_count: number, ready_count: number }>(result).map(row => [row.id, row]))
  for (const manifestId of manifestIds) {
    const row = found.get(manifestId)
    if (!row || Number(row.page_count) < 1 || Number(row.page_count) !== Number(row.ready_count))
      throw createError({ statusCode: 400, statusMessage: 'Every gallery page and thumbnail must be ready before publishing' })
  }
}

function parseContentJson(value: unknown): Record<string, unknown> | null {
  if (value == null || value === '')
    return null
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'content_json must be valid JSON' })
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createError({ statusCode: 400, statusMessage: 'content_json must be an object' })
  const state = { nodes: 0 }
  canonicalJsonValue(value, 0, state)
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'content_json must be JSON serializable' })
  }
  if (blogByteLength(serialized) > BLOG_MAX_CANONICAL_BYTES)
    throw createError({ statusCode: 400, statusMessage: 'content_json is too large' })
  return value as Record<string, unknown>
}

function mediaIdsFromDocument(value: unknown, result: string[] = []): string[] {
  if (!value || typeof value !== 'object')
    return result
  if (Array.isArray(value)) {
    for (const child of value)
      mediaIdsFromDocument(child, result)
    return result
  }
  const record = value as Record<string, unknown>
  if (record.type === 'blogMedia' && record.attrs && typeof record.attrs === 'object') {
    const attrs = record.attrs as Record<string, unknown>
    for (const key of ['assetId', 'posterAssetId']) {
      const assetId = attrs[key]
      if (typeof assetId === 'string' && !assetId.startsWith('legacy:') && !result.includes(assetId))
        result.push(assetId)
    }
  }
  for (const child of Object.values(record))
    mediaIdsFromDocument(child, result)
  return result
}

type HtmlMediaKind = 'image' | 'gif' | 'video'

interface HtmlMediaReference {
  id: string
  kinds: HtmlMediaKind[]
}

function mediaReferencesFromHtml(value: string): HtmlMediaReference[] {
  const references: HtmlMediaReference[] = []
  const tags = /<(img|source|video)\b[^>]*>/gi
  const attributes = /\b(src|poster)\s*=\s*["']([^"']+)["']/gi
  for (const tagMatch of value.matchAll(tags)) {
    const tagName = tagMatch[1]?.toLowerCase()
    const tag = tagMatch[0]
    if (!tagName || !tag)
      continue
    for (const attributeMatch of tag.matchAll(attributes)) {
      const attribute = attributeMatch[1]?.toLowerCase()
      const path = attributeMatch[2]
      if (!attribute || !path)
        continue
      if (path.startsWith('/media/blog/')) {
        const assetId = blogCoverAssetId(path)
        if (!assetId)
          throw createError({ statusCode: 400, statusMessage: 'Legacy blog media URLs must use canonical asset paths' })
        const kinds = attribute === 'poster' && tagName === 'video'
          ? ['image', 'gif'] as HtmlMediaKind[]
          : tagName === 'img'
            ? ['image', 'gif'] as HtmlMediaKind[]
            : ['video'] as HtmlMediaKind[]
        references.push({ id: assetId, kinds })
      }
    }
  }
  return references
}

async function mediaResolver(db: D1Like, actor: string, approvedLegacyPaths: Set<string> = new Set()) {
  return async (assetId: string) => {
    if (assetId.startsWith('legacy:')) {
      const path = normalizeLegacyMediaPath(assetId.slice('legacy:'.length))
      if (!path || !approvedLegacyPaths.has(path))
        return null
      return {
        id: assetId,
        kind: legacyMediaKind(path),
        name: path.split(/[/?#]/).pop() || 'legacy media',
        publicUrl: path,
        sourceUrl: path,
      }
    }
    const row = first<{
      id: string
      kind: 'image' | 'gif' | 'video'
      name: string
      object_key: string
      source_object_key: string
      created_by: string
      status: string
    }>(await db.prepare(`
      SELECT id, kind, name, object_key, source_object_key, created_by, status
      FROM blog_assets WHERE id = ? LIMIT 1
    `).bind(assetId).all())
    if (!row || row.created_by !== actor || row.status !== 'ready')
      return null
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      publicUrl: `/media/blog/${encodeURIComponent(row.id)}`,
      sourceUrl: `/api/admin/blog/media/${encodeURIComponent(row.id)}/source`,
    }
  }
}

async function approvedLegacyMediaPaths(db: D1Like, postId?: string): Promise<Set<string>> {
  if (!postId)
    return new Set()
  const row = first<{ snapshot_json: string }>(await db.prepare('SELECT snapshot_json FROM blog_post_revisions WHERE post_id = ? AND kind = \'original\' ORDER BY created_at ASC, id ASC LIMIT 1').bind(postId).all())
  if (!row)
    return new Set()
  try {
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, unknown>
    return legacyMediaPathsFromHtml(snapshot.content_html)
  }
  catch {
    return new Set()
  }
}

async function approvedLegacyCoverPaths(db: D1Like): Promise<Set<string>> {
  const paths = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || BLOG_COVER_ASSET_PATH.test(value) || value.startsWith('/media/blog/'))
      return
    const path = normalizeLegacyMediaPath(value)
    if (path)
      paths.add(path)
  }
  const known = await db.prepare(`
    SELECT cover_image_url FROM blog_posts WHERE cover_image_url IS NOT NULL
    UNION
    SELECT cover_image_url FROM blog_post_drafts WHERE cover_image_url IS NOT NULL
  `).all()
  for (const row of rows<{ cover_image_url: unknown }>(known))
    add(row.cover_image_url)
  const originals = await db.prepare('SELECT snapshot_json FROM blog_post_revisions WHERE kind = \'original\'').all()
  for (const original of rows<{ snapshot_json: string }>(originals)) {
    try {
      add((JSON.parse(original.snapshot_json) as Record<string, unknown>).cover_image_url)
    }
    catch {
      // Invalid snapshots are rejected by restore and do not approve media paths.
    }
  }
  return paths
}

async function draftInputFromBody(db: D1Like, actor: string, body: Record<string, unknown>, current?: BlogDraft, postId?: string): Promise<DraftInput> {
  const title = stringField(body.title ?? current?.title, 'title', 300)
  const slug = slugField(body.slug ?? current?.slug)
  const excerpt = stringField(body.excerpt ?? current?.excerpt ?? '', 'excerpt', 2_000, false)
  const categoryId = body.category_id === undefined ? current?.category_id ?? null : body.category_id == null ? null : idField(body.category_id, 'category_id')
  if (categoryId) {
    const category = await first(await db.prepare('SELECT id FROM blog_categories WHERE id = ? LIMIT 1').bind(categoryId).all())
    if (!category)
      throw createError({ statusCode: 400, statusMessage: 'Category not found' })
  }
  const tagIdsValue = body.tag_ids === undefined ? current?.tag_ids ?? [] : body.tag_ids
  if (!Array.isArray(tagIdsValue) || tagIdsValue.length > 100)
    throw createError({ statusCode: 400, statusMessage: 'tag_ids must be an array' })
  const tagIds = [...new Set(tagIdsValue.map(value => idField(value, 'tag_id')))]
  if (tagIds.length) {
    const placeholders = tagIds.map(() => '?').join(',')
    const found = await db.prepare(`SELECT id FROM blog_tags WHERE id IN (${placeholders})`).bind(...tagIds).all()
    const foundIds = new Set(rows<{ id: string }>(found).map(row => row.id))
    if (tagIds.some(id => !foundIds.has(id)))
      throw createError({ statusCode: 400, statusMessage: 'Tag not found' })
  }
  const contentJson = parseContentJson(body.content_json === undefined ? current?.content_json : body.content_json)
  let contentHtml: string
  let assetIds: string[] = []
  let galleryManifestIds: string[] = []
  const htmlMediaRequirements = new Map<string, HtmlMediaKind[][]>()
  if (contentJson) {
    assetIds = mediaIdsFromDocument(contentJson)
    galleryManifestIds = galleryIdsFromDocument(contentJson).map(id => idField(id, 'gallery manifest id'))
    await validateGalleryReferences(db, actor, postId, galleryManifestIds)
    const resolveMedia = await mediaResolver(db, actor, await approvedLegacyMediaPaths(db, postId))
    const resolveGallery = await galleryResolver(db, actor, postId)
    contentHtml = await renderTiptapDocument(contentJson, { mode: 'public', resolveMedia, resolveGallery })
  }
  else {
    const suppliedContentHtml = body.content_html === undefined ? current?.content_html ?? '' : body.content_html
    const unchangedLegacyHtml = current && typeof suppliedContentHtml === 'string' && suppliedContentHtml === current.content_html
    contentHtml = unchangedLegacyHtml ? suppliedContentHtml : sanitizeLegacyBlogHtml(suppliedContentHtml)
    for (const reference of mediaReferencesFromHtml(contentHtml)) {
      const requirements = htmlMediaRequirements.get(reference.id) ?? []
      requirements.push(reference.kinds)
      htmlMediaRequirements.set(reference.id, requirements)
    }
    assetIds = [...htmlMediaRequirements.keys()]
  }
  const coverImageUrl = body.cover_image_url === undefined
    ? current?.cover_image_url ?? null
    : safeCoverUrl(body.cover_image_url)
  const coverAssetId = blogCoverAssetId(coverImageUrl)
  if (coverImageUrl && !coverAssetId) {
    const approvedLegacyCovers = await approvedLegacyCoverPaths(db)
    if (!approvedLegacyCovers.has(coverImageUrl) && coverImageUrl !== current?.cover_image_url)
      throw createError({ statusCode: 400, statusMessage: 'Legacy cover path is not an approved existing media path' })
  }
  if (coverAssetId && !assetIds.includes(coverAssetId))
    assetIds.push(coverAssetId)
  const galleryAssetIds = await galleryManifestAssetIds(db, actor, galleryManifestIds, postId)
  for (const assetId of galleryAssetIds) {
    if (!assetIds.includes(assetId))
      assetIds.push(assetId)
  }
  if (blogByteLength(contentHtml) > BLOG_MAX_CANONICAL_BYTES)
    throw createError({ statusCode: 400, statusMessage: 'Rendered content is too large' })
  const assets = new Map<string, { id: string, kind: HtmlMediaKind, created_by: string, status: string }>()
  if (assetIds.length) {
    const assetResult = await db.prepare(`
      SELECT a.id, a.kind, a.created_by, a.status
      FROM blog_assets AS a
      INNER JOIN json_each(?) AS requested ON requested.value = a.id
    `).bind(JSON.stringify(assetIds)).all()
    for (const asset of rows<{ id: string, kind: HtmlMediaKind, created_by: string, status: string }>(assetResult))
      assets.set(asset.id, asset)
  }
  for (const assetId of assetIds) {
    const asset = assets.get(assetId)
    const requirements = htmlMediaRequirements.get(assetId) ?? []
    const validHtmlKind = !requirements.length || requirements.every(kinds => asset ? kinds.includes(asset.kind) : false)
    const validCoverKind = coverAssetId !== assetId || asset?.kind === 'image' || asset?.kind === 'gif'
    if (!asset || asset.created_by !== actor || asset.status !== 'ready' || !validHtmlKind || !validCoverKind)
      throw createError({ statusCode: 400, statusMessage: 'Referenced media asset is unavailable' })
  }
  return {
    title,
    slug,
    excerpt,
    category_id: categoryId,
    tag_ids: tagIds,
    cover_image_url: coverImageUrl,
    cover_image_alt: nullableString(body.cover_image_alt === undefined ? current?.cover_image_alt : body.cover_image_alt, 'cover_image_alt', 500),
    read_minutes: integerField(body.read_minutes === undefined ? current?.read_minutes : body.read_minutes, 'read_minutes', 1, 1_000, 1),
    meta_title: nullableString(body.meta_title === undefined ? current?.meta_title : body.meta_title, 'meta_title', 300),
    meta_description: nullableString(body.meta_description === undefined ? current?.meta_description : body.meta_description, 'meta_description', 500),
    content_json: contentJson,
    content_html: contentHtml,
    asset_ids: assetIds,
    gallery_manifest_ids: galleryManifestIds,
  }
}

function draftFromRow(row: Record<string, unknown>, tagIds: string[], galleryManifestIds: string[] = []): BlogDraft {
  let contentJson: Record<string, unknown> | null = null
  if (typeof row.content_json === 'string' && row.content_json) {
    try {
      contentJson = JSON.parse(row.content_json) as Record<string, unknown>
    }
    catch {
      contentJson = null
    }
  }
  return {
    version: Number(row.version ?? 1),
    schema_version: 1,
    title: String(row.title ?? ''),
    slug: String(row.slug ?? ''),
    excerpt: String(row.excerpt ?? ''),
    category_id: row.category_id == null ? null : String(row.category_id),
    tag_ids: tagIds,
    cover_image_url: row.cover_image_url == null ? null : String(row.cover_image_url),
    cover_image_alt: row.cover_image_alt == null ? null : String(row.cover_image_alt),
    read_minutes: Number(row.read_minutes ?? 1),
    meta_title: row.meta_title == null ? null : String(row.meta_title),
    meta_description: row.meta_description == null ? null : String(row.meta_description),
    content_json: contentJson,
    content_html: String(row.content_html ?? ''),
    gallery_manifest_ids: galleryManifestIds,
    updated_at: String(row.updated_at ?? new Date(0).toISOString()),
  }
}

function postFromRow(row: Record<string, unknown>, draft: BlogDraft): BlogPost {
  const status = String(row.status ?? 'draft') as BlogPost['status']
  const publishedVersion = row.published_version == null ? null : Number(row.published_version)
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title ?? ''),
    excerpt: String(row.excerpt ?? ''),
    cover_image_url: row.cover_image_url == null ? null : String(row.cover_image_url),
    cover_image_alt: row.cover_image_alt == null ? null : String(row.cover_image_alt),
    read_minutes: Number(row.read_minutes ?? 1),
    published_at: row.published_at == null ? null : String(row.published_at),
    status,
    category_id: row.category_id == null ? null : String(row.category_id),
    category: row.category_id == null
      ? null
      : {
          id: String(row.category_id),
          slug: String(row.category_slug ?? ''),
          name: String(row.category_name ?? ''),
          color_class: row.category_color_class == null ? null : String(row.category_color_class),
          sort_order: Number(row.category_sort_order ?? 0),
        },
    published_version: publishedVersion,
    has_unpublished_changes: publishedVersion == null
      ? status !== 'draft' || draft.version > 1
      : status !== 'published' || publishedVersion !== draft.version,
    meta_title: row.meta_title == null ? null : String(row.meta_title),
    meta_description: row.meta_description == null ? null : String(row.meta_description),
    canonical_path: row.canonical_path == null ? null : String(row.canonical_path),
  }
}

async function loadDetail(db: D1Like, postId: string): Promise<BlogDetail> {
  const row = first<Record<string, unknown>>(await db.prepare(`
    SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.cover_image_alt,
      p.read_minutes, p.published_at, p.status, p.category_id, p.meta_title,
      p.meta_description, p.canonical_path, p.published_version,
      c.slug AS category_slug, c.name AS category_name,
      c.color_class AS category_color_class, c.sort_order AS category_sort_order,
      d.version AS draft_version, d.schema_version AS draft_schema_version,
      d.title AS draft_title, d.slug AS draft_slug, d.excerpt AS draft_excerpt,
      d.category_id AS draft_category_id, d.cover_image_url AS draft_cover_image_url,
      d.cover_image_alt AS draft_cover_image_alt, d.read_minutes AS draft_read_minutes,
      d.meta_title AS draft_meta_title, d.meta_description AS draft_meta_description,
      d.content_json AS draft_content_json, d.content_html AS draft_content_html,
      d.updated_at AS draft_updated_at
    FROM blog_posts AS p
    LEFT JOIN blog_categories AS c ON c.id = p.category_id
    INNER JOIN blog_post_drafts AS d ON d.post_id = p.id
    WHERE p.id = ? LIMIT 1
  `).bind(postId).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Blog post not found' })
  const draft = draftFromRow({
    version: row.draft_version,
    schema_version: row.draft_schema_version,
    title: row.draft_title,
    slug: row.draft_slug,
    excerpt: row.draft_excerpt,
    category_id: row.draft_category_id,
    cover_image_url: row.draft_cover_image_url,
    cover_image_alt: row.draft_cover_image_alt,
    read_minutes: row.draft_read_minutes,
    meta_title: row.draft_meta_title,
    meta_description: row.draft_meta_description,
    content_json: row.draft_content_json,
    content_html: row.draft_content_html,
    updated_at: row.draft_updated_at,
  }, await tagsFor(db, postId), await galleryReferencesFor(db, postId))
  return { post: postFromRow(row, draft), draft }
}

export function postIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'id'), 'post id')
}

export async function listBlogPosts(event: H3Event) {
  blogActor(event)
  const db = requireDb(event)
  const result = await db.prepare(`
    SELECT p.id, p.slug, p.title, p.excerpt, p.cover_image_url, p.cover_image_alt,
      p.read_minutes, p.published_at, p.status, p.category_id, p.meta_title,
      p.meta_description, p.canonical_path, p.published_version,
      c.slug AS category_slug, c.name AS category_name,
      c.color_class AS category_color_class, c.sort_order AS category_sort_order,
      d.version AS draft_version, d.updated_at AS draft_updated_at,
      d.title AS draft_title, d.slug AS draft_slug, d.excerpt AS draft_excerpt,
      p.updated_at
    FROM blog_posts AS p
    LEFT JOIN blog_categories AS c ON c.id = p.category_id
    LEFT JOIN blog_post_drafts AS d ON d.post_id = p.id
    ORDER BY COALESCE(d.updated_at, p.updated_at) DESC, p.id ASC
  `).all()
  return {
    posts: await Promise.all(rows<Record<string, unknown>>(result).map(async (row) => {
      const draft = draftFromRow({
        version: row.draft_version,
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        category_id: row.category_id,
        cover_image_url: row.cover_image_url,
        cover_image_alt: row.cover_image_alt,
        read_minutes: row.read_minutes,
        meta_title: row.meta_title,
        meta_description: row.meta_description,
        content_html: '',
        updated_at: row.draft_updated_at,
      }, [])
      return {
        ...postFromRow(row, draft),
        title: String(row.draft_title ?? row.title ?? ''),
        slug: String(row.draft_slug ?? row.slug),
        excerpt: String(row.draft_excerpt ?? row.excerpt ?? ''),
        updated_at: String(row.draft_updated_at ?? row.updated_at),
      }
    })),
  }
}

export async function getBlogPost(event: H3Event, postId: string): Promise<BlogDetail> {
  blogActor(event)
  return loadDetail(requireDb(event), postId)
}

export async function createBlogPost(event: H3Event, body: Record<string, unknown>): Promise<BlogDetail> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const requestedSlug = body.slug == null ? null : slugField(body.slug)
  const title = body.title == null ? 'Untitled draft' : stringField(body.title, 'title', 300)
  const slug = requestedSlug || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'draft'}-${crypto.randomUUID().slice(0, 8)}`
  const existing = await first(await db.prepare('SELECT id FROM blog_posts WHERE slug = ? LIMIT 1').bind(slug).all())
  if (existing)
    throw createError({ statusCode: 409, statusMessage: 'A post with this slug already exists' })
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  const initialBody: Record<string, unknown> = {
    ...body,
    title,
    slug,
    excerpt: body.excerpt ?? '',
    content_html: body.content_html ?? '<p></p>',
  }
  if (body.content_json === undefined && body.content_html === undefined)
    initialBody.content_json = { type: 'doc', content: [{ type: 'paragraph' }] }
  const initial = await draftInputFromBody(db, actor, initialBody)
  const snapshot = snapshotDraft({ version: 1, schema_version: BLOG_SCHEMA_VERSION, ...initial, updated_at: now })
  const statements = [
    db.prepare(`
      INSERT INTO blog_posts
        (id, slug, title, excerpt, content_html, cover_image_url, cover_image_alt,
         category_id, status, read_minutes, meta_title, meta_description,
         created_by, updated_by, created_at, updated_at, published_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(id, initial.slug, initial.title, initial.excerpt, initial.content_html, initial.cover_image_url, initial.cover_image_alt, initial.category_id, initial.read_minutes, initial.meta_title, initial.meta_description, actor, actor, now, now),
    db.prepare(`
      INSERT INTO blog_post_drafts
        (post_id, version, schema_version, title, slug, excerpt, category_id,
         cover_image_url, cover_image_alt, read_minutes, meta_title,
         meta_description, content_json, content_html, updated_at, updated_by,
         mutation_token)
      VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, initial.title, initial.slug, initial.excerpt, initial.category_id, initial.cover_image_url, initial.cover_image_alt, initial.read_minutes, initial.meta_title, initial.meta_description, initial.content_json ? JSON.stringify(initial.content_json) : null, initial.content_html, now, actor, crypto.randomUUID()),
    db.prepare(`INSERT INTO blog_post_revisions (post_id, version, kind, snapshot_json, created_at, created_by) VALUES (?, 1, 'original', ?, ?, ?)`)
      .bind(id, snapshot, now, actor),
  ]
  for (const tagId of initial.tag_ids)
    statements.push(db.prepare('INSERT INTO blog_post_draft_tags (post_id, tag_id) VALUES (?, ?)').bind(id, tagId))
  statements.push(db.prepare(`
    INSERT INTO blog_post_asset_refs (post_id, asset_id, scope)
    SELECT ?, value, 'draft' FROM json_each(?)
  `).bind(id, JSON.stringify(initial.asset_ids)))
  statements.push(db.prepare(`
    INSERT INTO blog_post_gallery_refs (post_id, manifest_id, scope)
    SELECT ?, value, 'draft' FROM json_each(?)
  `).bind(id, JSON.stringify(initial.gallery_manifest_ids)))
  statements.push(auditInsert(db, actor, 'post.create', id, { status: 'draft', version: 1 }))
  try {
    await db.batch(statements)
  }
  catch (error) {
    if (isBlogSlugUniqueViolation(error))
      throwSlugConflict()
    throw error
  }
  return loadDetail(db, id)
}

function conflict(currentVersion: number, current?: BlogDetail): never {
  throw createError({ statusCode: 409, statusMessage: 'Draft has changed', data: { current_version: currentVersion, current } })
}

async function currentDraftVersion(db: D1Like, postId: string): Promise<number> {
  const row = first<{ version: number }>(await db.prepare('SELECT version FROM blog_post_drafts WHERE post_id = ?').bind(postId).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Blog post draft not found' })
  return Number(row.version)
}

async function currentGalleryVersion(db: D1Like, actor: string, galleryId: string): Promise<number> {
  const row = first<{ version: number }>(await db.prepare('SELECT version FROM blog_galleries WHERE id = ? AND created_by = ?').bind(galleryId, actor).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Gallery not found' })
  return Number(row.version)
}

export async function updateBlogDraft(event: H3Event, postId: string): Promise<BlogDetail> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const current = await loadDetail(db, postId)
  if (current.draft.version !== version)
    conflict(current.draft.version, current)
  if (current.post.published_version != null && body.slug !== undefined && slugField(body.slug) !== current.post.slug)
    throw createError({ statusCode: 409, statusMessage: 'Published slugs are immutable' })
  const next = await draftInputFromBody(db, actor, body, current.draft, postId)
  const nextVersion = version + 1
  const token = crypto.randomUUID()
  const now = new Date().toISOString()
  const update = db.prepare(`
    UPDATE blog_post_drafts SET version = ?, schema_version = 1, title = ?, slug = ?,
      excerpt = ?, category_id = ?, cover_image_url = ?, cover_image_alt = ?,
      read_minutes = ?, meta_title = ?, meta_description = ?, content_json = ?,
      content_html = ?, updated_at = ?, updated_by = ?, mutation_token = ?
    WHERE post_id = ? AND version = ?
  `).bind(nextVersion, next.title, next.slug, next.excerpt, next.category_id, next.cover_image_url, next.cover_image_alt, next.read_minutes, next.meta_title, next.meta_description, next.content_json ? JSON.stringify(next.content_json) : null, next.content_html, now, actor, token, postId, version)
  const statements = [
    update,
    db.prepare('DELETE FROM blog_post_draft_tags WHERE post_id = ? AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    ...next.tag_ids.map(tagId => db.prepare('INSERT INTO blog_post_draft_tags (post_id, tag_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, tagId, postId, token)),
    db.prepare('DELETE FROM blog_post_asset_refs WHERE post_id = ? AND scope = \'draft\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_asset_refs (post_id, asset_id, scope)
      SELECT ?, value, 'draft' FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, JSON.stringify(next.asset_ids), postId, token),
    db.prepare('DELETE FROM blog_post_gallery_refs WHERE post_id = ? AND scope = \'draft\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_gallery_refs (post_id, manifest_id, scope)
      SELECT ?, value, 'draft' FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, JSON.stringify(next.gallery_manifest_ids), postId, token),
    auditInsert(db, actor, 'post.draft', postId, { status: 'draft', version: nextVersion }, 'EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)', [postId, token, nextVersion]),
  ]
  const result = await db.batch(statements)
  if (changes(result[0]) !== 1)
    conflict(await currentDraftVersion(db, postId))
  return loadDetail(db, postId)
}

export async function checkpointBlogPost(event: H3Event, postId: string): Promise<{ revision: Record<string, unknown> }> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const detail = await loadDetail(db, postId)
  if (detail.draft.version !== version)
    conflict(detail.draft.version, detail)
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  const snapshot = snapshotDraft({ ...detail.draft, updated_at: now })
  await db.batch([
    db.prepare('INSERT INTO blog_post_revisions (id, post_id, version, kind, snapshot_json, created_at, created_by) VALUES (?, ?, ?, \'checkpoint\', ?, ?, ?)').bind(id, postId, version, snapshot, now, actor),
    auditInsert(db, actor, 'post.checkpoint', postId, { status: 'checkpoint', version }),
  ])
  return { revision: { id, post_id: postId, version, kind: 'checkpoint', created_at: now } }
}

export async function listBlogRevisions(event: H3Event, postId: string) {
  blogActor(event)
  const result = await requireDb(event).prepare(`
    SELECT id, post_id, version, kind, created_at, created_by
    FROM blog_post_revisions WHERE post_id = ? ORDER BY created_at DESC, id DESC
  `).bind(postId).all()
  return { revisions: rows(result) }
}

export async function restoreBlogPost(event: H3Event, postId: string): Promise<BlogDetail> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const revisionId = idField(body.revision_id, 'revision_id')
  const current = await loadDetail(db, postId)
  if (current.draft.version !== version)
    conflict(current.draft.version, current)
  const revision = first<{ snapshot_json: string }>(await db.prepare('SELECT snapshot_json FROM blog_post_revisions WHERE id = ? AND post_id = ? LIMIT 1').bind(revisionId, postId).all())
  if (!revision)
    throw createError({ statusCode: 404, statusMessage: 'Revision not found' })
  let snapshot: Record<string, unknown>
  try {
    snapshot = JSON.parse(revision.snapshot_json) as Record<string, unknown>
  }
  catch {
    throw createError({ statusCode: 500, statusMessage: 'Revision snapshot is invalid' })
  }
  const restored = await draftInputFromBody(db, actor, current.post.published_version != null
    ? { ...snapshot, slug: current.post.slug }
    : snapshot, current.draft, postId)
  const nextVersion = version + 1
  const token = crypto.randomUUID()
  const now = new Date().toISOString()
  const statements = [
    db.prepare(`UPDATE blog_post_drafts SET version = ?, schema_version = 1, title = ?, slug = ?, excerpt = ?, category_id = ?, cover_image_url = ?, cover_image_alt = ?, read_minutes = ?, meta_title = ?, meta_description = ?, content_json = ?, content_html = ?, updated_at = ?, updated_by = ?, mutation_token = ? WHERE post_id = ? AND version = ?`).bind(nextVersion, restored.title, restored.slug, restored.excerpt, restored.category_id, restored.cover_image_url, restored.cover_image_alt, restored.read_minutes, restored.meta_title, restored.meta_description, restored.content_json ? JSON.stringify(restored.content_json) : null, restored.content_html, now, actor, token, postId, version),
    db.prepare('DELETE FROM blog_post_draft_tags WHERE post_id = ? AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    ...restored.tag_ids.map(tagId => db.prepare('INSERT INTO blog_post_draft_tags (post_id, tag_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, tagId, postId, token)),
    db.prepare('DELETE FROM blog_post_asset_refs WHERE post_id = ? AND scope = \'draft\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_asset_refs (post_id, asset_id, scope)
      SELECT ?, value, 'draft' FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, JSON.stringify(restored.asset_ids), postId, token),
    db.prepare('DELETE FROM blog_post_gallery_refs WHERE post_id = ? AND scope = \'draft\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_gallery_refs (post_id, manifest_id, scope)
      SELECT ?, value, 'draft' FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, JSON.stringify(restored.gallery_manifest_ids), postId, token),
    db.prepare(`INSERT INTO blog_post_revisions (post_id, version, kind, snapshot_json, created_at, created_by)
      SELECT ?, ?, 'restore', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)`)
      .bind(postId, nextVersion, snapshotDraft({ ...restored, version: nextVersion, updated_at: now }), now, actor, postId, token, nextVersion),
    auditInsert(db, actor, 'post.restore', postId, { status: 'draft', version: nextVersion }, 'EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)', [postId, token, nextVersion]),
  ]
  const result = await db.batch(statements)
  if (changes(result[0]) !== 1)
    conflict(await currentDraftVersion(db, postId))
  return loadDetail(db, postId)
}

export async function publishBlogPost(event: H3Event, postId: string): Promise<BlogDetail> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const current = await loadDetail(db, postId)
  if (current.draft.version !== version)
    conflict(current.draft.version, current)
  if (!current.draft.title || !current.draft.slug || !current.draft.excerpt || !current.draft.content_html)
    throw createError({ statusCode: 400, statusMessage: 'Title, slug, excerpt and content are required before publishing' })
  if (current.post.published_version != null && current.draft.slug !== current.post.slug)
    throw createError({ statusCode: 409, statusMessage: 'Published slugs are immutable' })
  const slugOwner = first<{ id: string }>(await db.prepare('SELECT id FROM blog_posts WHERE slug = ? AND id <> ? LIMIT 1').bind(current.draft.slug, postId).all())
  if (slugOwner)
    throw createError({ statusCode: 409, statusMessage: 'A post with this slug already exists' })
  await validateGalleryReferences(db, actor, postId, current.draft.gallery_manifest_ids)
  await validateGalleryManifestAssets(db, actor, postId, current.draft.gallery_manifest_ids)
  const token = crypto.randomUUID()
  const now = new Date().toISOString()
  const publishedAt = current.post.published_at || now
  const nextVersion = version + 1
  const revisionSnapshot = snapshotDraft({ ...current.draft, version: nextVersion, updated_at: now })
  const statements = [
    db.prepare('UPDATE blog_post_drafts SET version = ?, mutation_token = ? WHERE post_id = ? AND version = ?').bind(nextVersion, token, postId, version),
    db.prepare(`UPDATE blog_posts SET slug = ?, title = ?, excerpt = ?, content_html = ?, cover_image_url = ?, cover_image_alt = ?, category_id = ?, status = 'published', read_minutes = ?, meta_title = ?, meta_description = ?, published_at = ?, published_version = ?, updated_by = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)`).bind(current.draft.slug, current.draft.title, current.draft.excerpt, current.draft.content_html, current.draft.cover_image_url, current.draft.cover_image_alt, current.draft.category_id, current.draft.read_minutes, current.draft.meta_title, current.draft.meta_description, publishedAt, nextVersion, actor, now, postId, postId, token, nextVersion),
    db.prepare('DELETE FROM blog_post_tags WHERE post_id = ? AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    ...current.draft.tag_ids.map(tagId => db.prepare('INSERT INTO blog_post_tags (post_id, tag_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, tagId, postId, token)),
    db.prepare('DELETE FROM blog_post_asset_refs WHERE post_id = ? AND scope = \'published\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_asset_refs (post_id, asset_id, scope)
      SELECT ?, asset_id, 'published'
      FROM blog_post_asset_refs
      WHERE post_id = ? AND scope = 'draft'
        AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
      UNION
      SELECT ?, mp.asset_id, 'published'
      FROM blog_post_gallery_refs AS gr
      INNER JOIN blog_gallery_manifest_pages AS mp ON mp.manifest_id = gr.manifest_id
      WHERE gr.post_id = ? AND gr.scope = 'draft' AND mp.visible = 1
        AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
      UNION
      SELECT ?, mp.thumbnail_asset_id, 'published'
      FROM blog_post_gallery_refs AS gr
      INNER JOIN blog_gallery_manifest_pages AS mp ON mp.manifest_id = gr.manifest_id
      WHERE gr.post_id = ? AND gr.scope = 'draft' AND mp.visible = 1
        AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, postId, postId, token, postId, postId, postId, token, postId, postId, postId, token),
    db.prepare('DELETE FROM blog_post_gallery_refs WHERE post_id = ? AND scope = \'published\' AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)').bind(postId, postId, token),
    db.prepare(`
      INSERT INTO blog_post_gallery_refs (post_id, manifest_id, scope)
      SELECT ?, manifest_id, 'published'
      FROM blog_post_gallery_refs
      WHERE post_id = ? AND scope = 'draft'
        AND EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ?)
    `).bind(postId, postId, postId, token),
    db.prepare('INSERT INTO blog_post_revisions (post_id, version, kind, snapshot_json, created_at, created_by) SELECT ?, ?, \'publish\', ?, ?, ? WHERE EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)').bind(postId, nextVersion, revisionSnapshot, now, actor, postId, token, nextVersion),
    auditInsert(db, actor, 'post.publish', postId, { status: 'published', version: nextVersion }, 'EXISTS (SELECT 1 FROM blog_post_drafts WHERE post_id = ? AND mutation_token = ? AND version = ?)', [postId, token, nextVersion]),
  ]
  let result: Awaited<ReturnType<D1Like['batch']>>
  try {
    result = await db.batch(statements.filter(Boolean) as D1PreparedStatement[])
  }
  catch (error) {
    if (isBlogSlugUniqueViolation(error))
      throwSlugConflict()
    throw error
  }
  if (changes(result[0]) !== 1)
    conflict(await currentDraftVersion(db, postId))
  return loadDetail(db, postId)
}

export async function setBlogPostStatus(event: H3Event, postId: string): Promise<BlogDetail> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const status = body.status
  if (status !== 'draft' && status !== 'archived')
    throw createError({ statusCode: 400, statusMessage: 'status must be draft or archived' })
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_posts SET status = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(status, actor, now, postId),
    auditInsert(db, actor, 'post.status', postId, { status }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1) {
    const current = await loadDetail(db, postId)
    if (current.post.status === 'published')
      throw createError({ statusCode: 409, statusMessage: 'Unpublish before changing the published status' })
  }
  return loadDetail(db, postId)
}

export async function previewBlogPost(event: H3Event, postId: string): Promise<string> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const detail = await loadDetail(db, postId)
  const content = detail.draft.content_json
    ? await renderTiptapDocument(detail.draft.content_json, {
        mode: 'preview',
        resolveMedia: await mediaResolver(db, actor, await approvedLegacyMediaPaths(db, postId)),
        resolveGallery: await galleryResolver(db, actor, postId),
      })
    : sanitizeLegacyBlogHtml(detail.draft.content_html)
  const title = detail.draft.title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const description = detail.draft.excerpt.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><style>body{font-family:system-ui,sans-serif;max-width:72rem;margin:0 auto;padding:2rem;line-height:1.65}.blog-preview{max-width:48rem;margin:auto}img,video{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.5rem}figcaption{color:#666;font-size:.9rem}</style></head><body><main class="blog-preview"><header><h1>${title}</h1><p>${description}</p></header><article>${content}</article></main></body></html>`
}

export async function getBlogSettings(event: H3Event, owner = true) {
  if (owner)
    blogActor(event)
  const db = requireDb(event)
  const row = first<{ value: string }>(await db.prepare('SELECT value FROM blog_settings WHERE key = \'artwork_motion\' LIMIT 1').all())
  const artworkMotion = row?.value === 'off' ? 'off' : 'once'
  return { artwork_motion: artworkMotion as 'once' | 'off' }
}

export async function updateBlogSettings(event: H3Event): Promise<{ artwork_motion: 'once' | 'off' }> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  if (body.artwork_motion !== 'once' && body.artwork_motion !== 'off')
    throw createError({ statusCode: 400, statusMessage: 'artwork_motion must be once or off' })
  const now = new Date().toISOString()
  await db.batch([
    db.prepare(`INSERT INTO blog_settings (key, value, updated_at, updated_by) VALUES ('artwork_motion', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(body.artwork_motion, now, actor),
    auditInsert(db, actor, 'settings.update', 'artwork_motion', { status: 'updated' }),
  ])
  return getBlogSettings(event)
}

export async function getBlogTaxonomy(event: H3Event) {
  blogActor(event)
  const db = requireDb(event)
  const [categories, tags] = await Promise.all([
    db.prepare('SELECT id, slug, name, description, color_class, sort_order, is_active, icon_key, version FROM blog_categories ORDER BY sort_order ASC, name ASC').all(),
    db.prepare('SELECT id, slug, name FROM blog_tags ORDER BY name ASC').all(),
  ])
  return { categories: rows(categories), tags: rows(tags) }
}

const BLOG_CATEGORY_ICON_KEYS = new Set([
  'civic-tech',
  'cybersecurity',
  'game-development',
  'robotics',
  'anthem',
  'internet-culture',
  'islamic-heritage',
  'psychology',
  'machine-learning',
  'neuroscience',
  'technology',
  'design',
  'education',
  'music',
  'news',
  'personal',
  'projects',
  'general',
])

function categoryIconKey(value: unknown, fallback = 'general'): string {
  const key = value == null || value === '' ? fallback : stringField(value, 'icon_key', 80).toLowerCase()
  if (!BLOG_CATEGORY_ICON_KEYS.has(key))
    throw createError({ statusCode: 400, statusMessage: 'icon_key is not allowed' })
  return key
}

export async function createBlogTaxonomy(event: H3Event) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  if (body.kind !== 'category' && body.kind !== 'tag')
    throw createError({ statusCode: 400, statusMessage: 'kind must be category or tag' })
  const name = stringField(body.name, 'name', 160)
  const slug = slugField(body.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  if (body.kind === 'category') {
    const sortOrder = integerField(body.sort_order, 'sort_order', -1_000_000, 1_000_000, 0)
    const iconKey = categoryIconKey(body.icon_key)
    await db.batch([
      db.prepare('INSERT INTO blog_categories (id, slug, name, description, color_class, sort_order, is_active, icon_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)').bind(id, slug, name, nullableString(body.description, 'description', 500), nullableString(body.color_class, 'color_class', 80), sortOrder, iconKey, now, now),
      auditInsert(db, actor, 'taxonomy.create', id, { status: 'created' }),
    ])
  }
  else {
    await db.batch([
      db.prepare('INSERT INTO blog_tags (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, slug, name, now, now),
      auditInsert(db, actor, 'taxonomy.create', id, { status: 'created' }),
    ])
  }
  return getBlogTaxonomy(event)
}

export function categoryIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'id'), 'category id')
}

export async function updateBlogCategory(event: H3Event, categoryId: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const current = first<{ name: string, description: string | null, sort_order: number, is_active: number, icon_key: string }>(await db.prepare('SELECT name, description, sort_order, is_active, icon_key FROM blog_categories WHERE id = ? LIMIT 1').bind(categoryId).all())
  if (!current)
    throw createError({ statusCode: 404, statusMessage: 'Category not found' })
  const name = stringField(body.name ?? current.name, 'name', 160)
  const description = body.description === undefined ? current.description : nullableString(body.description, 'description', 500)
  const sortOrder = integerField(body.sort_order === undefined ? current.sort_order : body.sort_order, 'sort_order', -1_000_000, 1_000_000)
  const isActive = body.is_active === undefined ? Number(current.is_active) === 1 : body.is_active
  if (typeof isActive !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'is_active must be a boolean' })
  const iconKey = categoryIconKey(body.icon_key === undefined ? current.icon_key : body.icon_key)
  const nextVersion = version + 1
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_categories SET name = ?, description = ?, sort_order = ?, is_active = ?, icon_key = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?').bind(name, description, sortOrder, isActive ? 1 : 0, iconKey, nextVersion, now, categoryId, version),
    auditInsert(db, actor, 'taxonomy.category.update', categoryId, { status: 'updated', version: nextVersion }, 'changes() = 1'),
  ])
  if (changes(result[0]) < 1) {
    const latest = first<{ version: number }>(await db.prepare('SELECT version FROM blog_categories WHERE id = ?').bind(categoryId).all())
    if (!latest)
      throw createError({ statusCode: 404, statusMessage: 'Category not found' })
    throw createError({ statusCode: 409, statusMessage: 'Category has changed', data: { current_version: Number(latest.version) } })
  }
  return getBlogTaxonomy(event)
}

function assetKind(mimeType: string): 'image' | 'gif' | 'video' | null {
  if (mimeType === 'image/gif')
    return 'gif'
  if (['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType))
    return 'image'
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(mimeType))
    return 'video'
  return null
}

function safeFilename(value: unknown): string {
  const name = stringField(value, 'filename', 240)
  const basename = name.replace(/.*[\\/]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!basename || basename === '.' || basename === '..')
    throw createError({ statusCode: 400, statusMessage: 'filename is invalid' })
  return basename
}

function assetResponse(event: H3Event, row: Record<string, unknown>) {
  const id = String(row.id)
  return {
    id,
    name: String(row.name),
    mime_type: String(row.mime_type),
    kind: String(row.kind),
    size: Number(row.size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
    url: `/media/blog/${encodeURIComponent(id)}`,
    source_url: `/api/admin/blog/media/${encodeURIComponent(id)}/source`,
    derived_from: (() => {
      try {
        return JSON.parse(String(row.derived_from || '[]'))
      }
      catch {
        return []
      }
    })(),
    created_at: String(row.created_at),
  }
}

export async function listBlogMedia(event: H3Event) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const [assets, projects] = await Promise.all([
    db.prepare(`
      SELECT a.id, a.name, a.mime_type, a.kind, a.size, a.width, a.height, a.duration_ms, a.derived_from, a.created_at
      FROM blog_assets AS a
      WHERE a.created_by = ? AND a.status = 'ready'
        AND NOT EXISTS (
          SELECT 1 FROM blog_gallery_pages AS gp
          WHERE gp.asset_id = a.id OR gp.thumbnail_asset_id = a.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM blog_gallery_manifest_pages AS mp
          WHERE mp.asset_id = a.id OR mp.thumbnail_asset_id = a.id
        )
      ORDER BY a.created_at DESC
    `).bind(actor).all(),
    db.prepare('SELECT id, version, title, document, updated_at FROM blog_media_projects WHERE created_by = ? ORDER BY updated_at DESC').bind(actor).all(),
  ])
  return {
    assets: rows<Record<string, unknown>>(assets).map(row => assetResponse(event, row)),
    projects: rows<Record<string, unknown>>(projects).map(row => ({ id: String(row.id), version: Number(row.version), title: String(row.title), document: JSON.parse(String(row.document)), updated_at: String(row.updated_at) })),
  }
}

export async function initBlogUpload(event: H3Event): Promise<Record<string, unknown>> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const bucket = requirePortfolioMedia(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const filename = safeFilename(body.filename)
  const mimeType = stringField(body.mime_type, 'mime_type', 120).toLowerCase()
  const kind = assetKind(mimeType)
  if (!kind)
    throw createError({ statusCode: 400, statusMessage: 'Unsupported media type' })
  const size = integerField(body.size, 'size', 1, BLOG_MAX_SOURCE_SIZE)
  const width = body.width == null ? null : integerField(body.width, 'width', 1, 8_000)
  const height = body.height == null ? null : integerField(body.height, 'height', 1, 8_000)
  const derivedFrom = body.derived_from ?? []
  if (!Array.isArray(derivedFrom) || derivedFrom.length > 32)
    throw createError({ statusCode: 400, statusMessage: 'derived_from must be an array' })
  const sourceIds = [...new Set(derivedFrom.map(value => idField(value, 'derived_from id')))]
  if (sourceIds.length) {
    const result = await db.prepare(`SELECT id FROM blog_assets WHERE created_by = ? AND status = 'ready' AND id IN (${sourceIds.map(() => '?').join(',')})`).bind(actor, ...sourceIds).all()
    const found = new Set(rows<{ id: string }>(result).map(row => row.id))
    if (sourceIds.some(id => !found.has(id)))
      throw createError({ statusCode: 400, statusMessage: 'Derived source asset is unavailable' })
  }
  const durationMax = kind === 'image'
    ? 0
    : sourceIds.length === 0
      ? 86_400_000
      : kind === 'video' ? 300_000 : 30_000
  const durationMs = body.duration_ms == null
    ? null
    : integerField(body.duration_ms, 'duration_ms', kind === 'image' ? 0 : 1, durationMax)
  const assetId = crypto.randomUUID().replaceAll('-', '')
  const uploadId = crypto.randomUUID().replaceAll('-', '')
  const objectKey = `blog/originals/${assetId}/${filename}`
  const multipart = await bucket.createMultipartUpload(objectKey, { httpMetadata: { contentType: mimeType } })
  const now = new Date().toISOString()
  try {
    await db.batch([
      db.prepare('INSERT INTO blog_assets (id, name, mime_type, kind, size, width, height, duration_ms, object_key, source_object_key, derived_from, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'uploading\', ?, ?)').bind(assetId, filename, mimeType, kind, size, width, height, durationMs, objectKey, objectKey, JSON.stringify(sourceIds), actor, now),
      db.prepare('INSERT INTO blog_uploads (id, asset_id, r2_upload_id, object_key, part_size, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, \'active\', ?, ?)').bind(uploadId, assetId, multipart.uploadId, objectKey, BLOG_UPLOAD_PART_SIZE, actor, now),
      auditInsert(db, actor, 'media.upload.init', assetId, { status: 'uploading', upload_id: uploadId }),
    ])
  }
  catch (error) {
    await multipart.abort().catch(() => undefined)
    throw error
  }
  return {
    asset: assetResponse(event, { id: assetId, name: filename, mime_type: mimeType, kind, size, width, height, duration_ms: durationMs, derived_from: JSON.stringify(sourceIds), created_at: now }),
    upload: { id: uploadId, part_size: BLOG_UPLOAD_PART_SIZE, parts: [] },
  }
}

async function uploadRow(event: H3Event, uploadId: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const row = first<Record<string, unknown>>(await db.prepare(`SELECT u.*, a.id AS asset_id, a.name, a.mime_type, a.kind, a.size, a.width, a.height, a.duration_ms, a.derived_from, a.created_at AS asset_created_at FROM blog_uploads AS u INNER JOIN blog_assets AS a ON a.id = u.asset_id WHERE u.id = ? AND u.created_by = ? LIMIT 1`).bind(uploadId, actor).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Upload not found' })
  return { actor, db, row }
}

export async function getBlogUpload(event: H3Event, uploadId: string) {
  const { db, row } = await uploadRow(event, uploadId)
  const parts = await db.prepare('SELECT part_number, etag, size FROM blog_upload_parts WHERE upload_id = ? ORDER BY part_number ASC').bind(uploadId).all()
  return {
    upload: { id: uploadId, part_size: Number(row.part_size), status: String(row.status), parts: rows(parts) },
    asset: assetResponse(event, { id: row.asset_id, name: row.name, mime_type: row.mime_type, kind: row.kind, size: row.size, width: row.width, height: row.height, duration_ms: row.duration_ms, derived_from: row.derived_from, created_at: row.asset_created_at }),
  }
}

export async function putBlogUploadPart(event: H3Event, uploadId: string, partNumber: number) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > BLOG_MAX_UPLOAD_PARTS)
    throw createError({ statusCode: 400, statusMessage: 'Upload part is invalid' })
  const { actor, db, row } = await uploadRow(event, uploadId)
  if (row.status !== 'active')
    throw createError({ statusCode: 409, statusMessage: 'Upload is no longer active' })
  const requestLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(requestLength) || requestLength > BLOG_UPLOAD_PART_SIZE || requestLength <= 0)
    throw createError({ statusCode: 413, statusMessage: 'Upload parts must be between 1 and 10 MiB' })
  const body = getRequestWebStream(event)
  if (!body)
    throw createError({ statusCode: 413, statusMessage: 'Upload part is too large' })
  const bucket = requirePortfolioMedia(event)
  const upload = bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id))
  let observedLength = 0
  const fixedBody = knownLengthStream(requestLength)
  const countedBody = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const value = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      observedLength += value.byteLength
      if (observedLength > requestLength || observedLength > BLOG_UPLOAD_PART_SIZE) {
        controller.error(createError({ statusCode: 413, statusMessage: 'Upload part exceeds declared size' }))
        return
      }
      controller.enqueue(value)
    },
    flush(controller) {
      if (observedLength !== requestLength)
        controller.error(createError({ statusCode: 400, statusMessage: 'Upload part size does not match Content-Length' }))
    },
  })
  const pump = body.pipeThrough(countedBody).pipeTo(fixedBody.writable)
  const uploadPromise = upload.uploadPart(partNumber, fixedBody.readable)
  const [, uploaded] = await Promise.all([pump, uploadPromise])
  const etag = String(uploaded.etag)
  await db.batch([
    db.prepare('INSERT INTO blog_upload_parts (upload_id, part_number, etag, size) VALUES (?, ?, ?, ?) ON CONFLICT(upload_id, part_number) DO UPDATE SET etag = excluded.etag, size = excluded.size').bind(uploadId, partNumber, etag, requestLength),
    auditInsert(db, actor, 'media.upload.part', String(row.asset_id), { status: 'active', upload_id: uploadId }),
  ])
  return { part_number: partNumber, etag }
}

export async function completeBlogUpload(event: H3Event, uploadId: string) {
  const { actor, db, row } = await uploadRow(event, uploadId)
  if (row.status === 'completed') {
    return {
      asset: assetResponse(event, {
        id: row.asset_id,
        name: row.name,
        mime_type: row.mime_type,
        kind: row.kind,
        size: row.size,
        width: row.width,
        height: row.height,
        duration_ms: row.duration_ms,
        derived_from: row.derived_from,
        created_at: row.asset_created_at,
      }),
    }
  }
  if (row.status !== 'active')
    throw createError({ statusCode: 409, statusMessage: 'Upload is no longer active' })
  const body = await parseJsonBody<Record<string, unknown>>(event)
  if (!Array.isArray(body.parts) || body.parts.length < 1 || body.parts.length > BLOG_MAX_UPLOAD_PARTS)
    throw createError({ statusCode: 400, statusMessage: 'parts must be a non-empty array' })
  const recorded = rows<{ part_number: number, etag: string, size: number }>(await db.prepare('SELECT part_number, etag, size FROM blog_upload_parts WHERE upload_id = ? ORDER BY part_number ASC').bind(uploadId).all())
  const requested = body.parts.map((part) => {
    if (!part || typeof part !== 'object')
      throw createError({ statusCode: 400, statusMessage: 'Invalid upload part' })
    const value = part as Record<string, unknown>
    return { part_number: integerField(value.part_number, 'part_number', 1, BLOG_MAX_UPLOAD_PARTS), etag: stringField(value.etag, 'etag', 512) }
  }).sort((a, b) => a.part_number - b.part_number)
  if (requested.some((part, index) => part.part_number !== index + 1))
    throw createError({ statusCode: 400, statusMessage: 'Upload parts must be contiguous' })
  if (recorded.length !== requested.length || recorded.some((part, index) => {
    const requestedPart = requested[index]
    return !requestedPart || part.part_number !== requestedPart.part_number || part.etag !== requestedPart.etag
  })) {
    throw createError({ statusCode: 409, statusMessage: 'Upload part etags do not match recorded parts' })
  }
  const totalSize = recorded.reduce((total, part) => total + Number(part.size), 0)
  if (totalSize !== Number(row.size))
    throw createError({ statusCode: 409, statusMessage: 'Uploaded size does not match metadata' })
  const bucket = requirePortfolioMedia(event)
  const upload = bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id))
  await upload.complete(requested.map(part => ({ partNumber: part.part_number, etag: part.etag })))
  const result = await db.batch([
    db.prepare('UPDATE blog_uploads SET status = \'completed\' WHERE id = ? AND status = \'active\'').bind(uploadId),
    db.prepare('UPDATE blog_assets SET status = \'ready\' WHERE id = ? AND status = \'uploading\'').bind(row.asset_id),
    auditInsert(db, actor, 'media.upload.complete', String(row.asset_id), { status: 'completed', upload_id: uploadId }, 'EXISTS (SELECT 1 FROM blog_uploads WHERE id = ? AND status = \'completed\')', [uploadId]),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Upload completion raced another request' })
  return { asset: assetResponse(event, { id: row.asset_id, name: row.name, mime_type: row.mime_type, kind: row.kind, size: row.size, width: row.width, height: row.height, duration_ms: row.duration_ms, derived_from: row.derived_from, created_at: row.asset_created_at }) }
}

export async function abortBlogUpload(event: H3Event, uploadId: string) {
  const { actor, db, row } = await uploadRow(event, uploadId)
  if (row.status === 'completed')
    throw createError({ statusCode: 409, statusMessage: 'Completed uploads are immutable' })
  const bucket = requirePortfolioMedia(event)
  await bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id)).abort().catch(() => undefined)
  await db.batch([
    db.prepare('UPDATE blog_uploads SET status = \'aborted\' WHERE id = ? AND status = \'active\'').bind(uploadId),
    db.prepare('UPDATE blog_assets SET status = \'aborted\' WHERE id = ? AND status = \'uploading\'').bind(row.asset_id),
    auditInsert(db, actor, 'media.upload.abort', String(row.asset_id), { status: 'aborted', upload_id: uploadId }, 'EXISTS (SELECT 1 FROM blog_uploads WHERE id = ? AND status = \'aborted\')', [uploadId]),
  ])
  return { aborted: true }
}

export async function serveBlogSource(event: H3Event, assetId: string): Promise<ReadableStream | null> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const row = first<Record<string, unknown>>(await db.prepare('SELECT id, mime_type, source_object_key, size, created_by, status FROM blog_assets WHERE id = ? AND created_by = ? LIMIT 1').bind(assetId, actor).all())
  if (!row || row.status !== 'ready')
    throw createError({ statusCode: 404, statusMessage: 'Media asset not found' })
  const bucket = requirePortfolioMedia(event)
  const range = requestRange(event, Number(row.size))
  const object = await bucket.get(String(row.source_object_key), range ? { range } : undefined)
  if (!object)
    throw createError({ statusCode: 404, statusMessage: 'Media object not found' })
  setHeader(event, 'Content-Type', String(row.mime_type))
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'ETag', object.etag)
  if (range) {
    const offset = range.offset
    const length = range.length
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Length', length)
    setHeader(event, 'Content-Range', `bytes ${offset}-${offset + length - 1}/${Number(row.size)}`)
  }
  else {
    setHeader(event, 'Content-Length', Number(object.size ?? row.size))
  }
  return object.body
}

function requestRange(event: H3Event, size: number): { offset: number, length: number } | undefined {
  const value = getHeader(event, 'range')
  if (!value)
    return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match)
    throw createError({ statusCode: 416, statusMessage: 'Invalid byte range' })
  if (!match[1] && !match[2])
    throw createError({ statusCode: 416, statusMessage: 'Invalid byte range' })
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isInteger(suffixLength) || suffixLength <= 0)
      throw createError({ statusCode: 416, statusMessage: 'Invalid byte range' })
    const length = Math.min(suffixLength, size)
    return { offset: size - length, length }
  }
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isInteger(start) || start < 0 || start >= size || end < start)
    throw createError({ statusCode: 416, statusMessage: 'Invalid byte range' })
  return { offset: start, length: end - start + 1 }
}

export async function createMediaProject(event: H3Event) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const title = stringField(body.title, 'title', 300)
  const document = body.document
  const serialized = validateMediaProjectDocument(document)
  await validateProjectAssets(db, actor, document)
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  await db.batch([
    db.prepare('INSERT INTO blog_media_projects (id, version, title, document, created_by, updated_at) VALUES (?, 1, ?, ?, ?, ?)').bind(id, title, serialized, actor, now),
    auditInsert(db, actor, 'media.project.create', id, { status: 'created', version: 1 }),
  ])
  return { project: { id, version: 1, title, document, updated_at: now } }
}

export async function updateMediaProject(event: H3Event, projectId: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  const title = stringField(body.title, 'title', 300)
  const serialized = validateMediaProjectDocument(body.document)
  await validateProjectAssets(db, actor, body.document)
  const nextVersion = version + 1
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_media_projects SET version = ?, title = ?, document = ?, updated_at = ? WHERE id = ? AND created_by = ? AND version = ?').bind(nextVersion, title, serialized, now, projectId, actor, version),
    auditInsert(db, actor, 'media.project.update', projectId, { status: 'updated', version: nextVersion }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1) {
    const current = first<{ version: number }>(await db.prepare('SELECT version FROM blog_media_projects WHERE id = ? AND created_by = ?').bind(projectId, actor).all())
    if (!current)
      throw createError({ statusCode: 404, statusMessage: 'Project not found' })
    throw createError({ statusCode: 409, statusMessage: 'Project has changed', data: { current_version: Number(current.version) } })
  }
  return { project: { id: projectId, version: nextVersion, title, document: body.document, updated_at: now } }
}

export function mediaIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'id'), 'media id')
}

export function uploadIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'id'), 'upload id')
}

export function projectIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'id'), 'project id')
}

interface GalleryPageInput {
  original_page: number
  title: string | null
  caption: string | null
  sort_order: number
  visible: boolean
  asset_id: string
  thumbnail_asset_id: string
}

function galleryId(value: unknown, key = 'gallery id'): string {
  return idField(value, key)
}

export function galleryPageIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'pageId'), 'gallery page id')
}

export function gallerySourceUploadIdFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'uploadId'), 'gallery source upload id')
}

function galleryPageInput(value: unknown): GalleryPageInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw createError({ statusCode: 400, statusMessage: 'page must be an object' })
  const body = value as Record<string, unknown>
  const originalPage = integerField(body.original_page, 'original_page', 1, BLOG_GALLERY_MAX_PAGES)
  const sortOrder = integerField(body.order ?? body.sort_order ?? originalPage - 1, 'order', 0, BLOG_GALLERY_MAX_PAGES - 1)
  const visible = body.visible === undefined ? true : body.visible
  if (typeof visible !== 'boolean')
    throw createError({ statusCode: 400, statusMessage: 'visible must be a boolean' })
  const assetId = idField(body.asset_id, 'asset_id')
  const thumbnailAssetId = idField(body.thumbnail_asset_id, 'thumbnail_asset_id')
  return {
    original_page: originalPage,
    title: body.title == null ? null : nullableString(body.title, 'title', 300),
    caption: body.caption == null ? null : nullableString(body.caption, 'caption', 1_000),
    sort_order: sortOrder,
    visible,
    asset_id: assetId,
    thumbnail_asset_id: thumbnailAssetId,
  }
}

async function galleryRow(db: D1Like, actor: string, id: string): Promise<Record<string, unknown>> {
  const row = first<Record<string, unknown>>(await db.prepare(`
    SELECT g.id, g.post_id, g.version, g.status, g.title, g.source_id, g.resume_page,
      g.page_count, g.finalized_manifest_id, g.finalized_at, g.created_by,
      g.updated_by, g.created_at, g.updated_at,
      s.filename AS source_filename, s.mime_type AS source_mime_type,
      s.size AS source_size, s.status AS source_status, s.created_at AS source_created_at,
      s.completed_at AS source_completed_at
    FROM blog_galleries AS g
    LEFT JOIN blog_gallery_sources AS s ON s.id = g.source_id
    WHERE g.id = ? AND g.created_by = ? LIMIT 1
  `).bind(id, actor).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Gallery not found' })
  return row
}

function galleryPageResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    original_page: Number(row.original_page),
    title: row.title == null ? null : String(row.title),
    caption: row.caption == null ? null : String(row.caption),
    order: Number(row.sort_order),
    visible: Number(row.visible) === 1,
    asset_id: row.asset_id == null ? null : String(row.asset_id),
    thumbnail_asset_id: row.thumbnail_asset_id == null ? null : String(row.thumbnail_asset_id),
    status: String(row.status),
  }
}

function galleryManifestResponse(row: Record<string, unknown>, pages: Record<string, unknown>[]) {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    title: String(row.title),
    created_at: String(row.created_at),
    pages: pages.map(page => ({
      id: String(page.page_id),
      original_page: Number(page.original_page),
      title: page.title == null ? null : String(page.title),
      caption: page.caption == null ? null : String(page.caption),
      order: Number(page.sort_order),
      visible: Number(page.visible) === 1,
      asset_id: String(page.asset_id),
      thumbnail_asset_id: String(page.thumbnail_asset_id),
    })),
  }
}

async function galleryDetail(db: D1Like, actor: string, id: string) {
  const row = await galleryRow(db, actor, id)
  const pageRows = await db.prepare(`
    SELECT id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id, status
    FROM blog_gallery_pages WHERE gallery_id = ? ORDER BY sort_order ASC, original_page ASC
  `).bind(id).all()
  let manifest: Record<string, unknown> | null = null
  const manifestRow = first<Record<string, unknown>>(await db.prepare('SELECT id, revision, title, created_at FROM blog_gallery_manifests WHERE id = ? AND gallery_id = ? LIMIT 1').bind(row.finalized_manifest_id, id).all())
  if (manifestRow) {
    const manifestPages = rows<Record<string, unknown>>(await db.prepare(`
      SELECT page_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id
      FROM blog_gallery_manifest_pages WHERE manifest_id = ? ORDER BY sort_order ASC, original_page ASC
    `).bind(manifestRow.id).all())
    manifest = galleryManifestResponse(manifestRow, manifestPages)
  }
  const source = row.source_id == null
    ? null
    : {
        id: String(row.source_id),
        filename: row.source_filename == null ? null : String(row.source_filename),
        mime_type: row.source_mime_type == null ? null : String(row.source_mime_type),
        size: row.source_size == null ? null : Number(row.source_size),
        status: row.source_status == null ? null : String(row.source_status),
        created_at: row.source_created_at == null ? null : String(row.source_created_at),
        completed_at: row.source_completed_at == null ? null : String(row.source_completed_at),
      }
  return {
    gallery: {
      id: String(row.id),
      post_id: String(row.post_id),
      version: Number(row.version),
      status: String(row.status),
      title: String(row.title),
      resume: {
        next_page: Number(row.resume_page),
        uploaded_pages: rows<Record<string, unknown>>(pageRows).filter(page => page.status === 'ready').length,
      },
      page_count: row.page_count == null ? null : Number(row.page_count),
      source,
      manifest_id: row.finalized_manifest_id == null ? null : String(row.finalized_manifest_id),
      finalized_at: row.finalized_at == null ? null : String(row.finalized_at),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    },
    pages: rows<Record<string, unknown>>(pageRows).map(galleryPageResponse),
    manifest,
  }
}

export function galleryIdFromEvent(event: H3Event): string {
  return galleryId(getRouterParam(event, 'id'))
}

export function sourceGalleryIdFromEvent(event: H3Event): string {
  return galleryId(getRouterParam(event, 'id'))
}

export async function listBlogGalleries(event: H3Event) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const result = await db.prepare('SELECT id FROM blog_galleries WHERE created_by = ? ORDER BY updated_at DESC, id ASC').bind(actor).all()
  return { galleries: await Promise.all(rows<{ id: string }>(result).map(row => galleryDetail(db, actor, row.id))) }
}

export async function getBlogGallery(event: H3Event, id: string) {
  const actor = blogActor(event)
  return galleryDetail(requireDb(event), actor, id)
}

export async function listBlogGalleryRevisions(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  await galleryRow(db, actor, id)
  const result = await db.prepare(`
    SELECT m.id, m.revision, m.title, m.created_at, COUNT(p.page_id) AS page_count
    FROM blog_gallery_manifests AS m
    LEFT JOIN blog_gallery_manifest_pages AS p ON p.manifest_id = m.id
    WHERE m.gallery_id = ?
    GROUP BY m.id ORDER BY m.revision DESC
  `).bind(id).all()
  return {
    revisions: rows<Record<string, unknown>>(result).map(row => ({
      id: String(row.id),
      revision: Number(row.revision),
      title: String(row.title),
      status: 'finalized',
      page_count: Number(row.page_count),
      created_at: String(row.created_at),
      finalized_at: String(row.created_at),
    })),
  }
}

export function galleryRevisionFromEvent(event: H3Event): string {
  return idField(getRouterParam(event, 'revision'), 'gallery revision')
}

export async function getBlogGalleryRevision(event: H3Event, id: string, revision: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const detail = await galleryDetail(db, actor, id)
  const byNumber = /^[1-9]\d{0,8}$/.test(revision)
  const row = first<Record<string, unknown>>(await db.prepare(`
    SELECT id, revision, title, created_at FROM blog_gallery_manifests
    WHERE gallery_id = ? AND ${byNumber ? 'revision' : 'id'} = ? LIMIT 1
  `).bind(id, byNumber ? Number(revision) : revision).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Gallery revision not found' })
  const pageRows = rows<Record<string, unknown>>(await db.prepare(`
    SELECT page_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id
    FROM blog_gallery_manifest_pages WHERE manifest_id = ? ORDER BY sort_order, original_page
  `).bind(row.id).all())
  const manifest = galleryManifestResponse(row, pageRows)
  return {
    gallery: {
      ...detail.gallery,
      status: 'finalized',
      title: manifest.title,
      manifest_id: manifest.id,
      finalized_at: manifest.created_at,
      page_count: manifest.pages.length,
    },
    pages: manifest.pages.map(page => ({ ...page, status: 'ready' })),
    manifest,
  }
}

export async function createBlogGallery(event: H3Event) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const postId = idField(body.post_id, 'post_id')
  const post = first<{ id: string }>(await db.prepare('SELECT id FROM blog_posts WHERE id = ? LIMIT 1').bind(postId).all())
  if (!post)
    throw createError({ statusCode: 404, statusMessage: 'Blog post not found' })
  const existing = first<{ id: string }>(await db.prepare('SELECT id FROM blog_galleries WHERE post_id = ? LIMIT 1').bind(postId).all())
  if (existing)
    throw createError({ statusCode: 409, statusMessage: 'This post already has a gallery' })
  const title = stringField(body.title ?? 'Gallery', 'title', 300)
  const pageCount = body.page_count == null ? null : integerField(body.page_count, 'page_count', 1, BLOG_GALLERY_MAX_PAGES)
  const id = crypto.randomUUID().replaceAll('-', '')
  const now = new Date().toISOString()
  await db.batch([
    db.prepare('INSERT INTO blog_galleries (id, post_id, version, status, title, page_count, created_by, updated_by, created_at, updated_at) VALUES (?, ?, 1, \'draft\', ?, ?, ?, ?, ?, ?)').bind(id, postId, title, pageCount, actor, actor, now, now),
    auditInsert(db, actor, 'gallery.create', id, { status: 'draft', version: 1 }),
  ])
  return galleryDetail(db, actor, id)
}

export async function updateBlogGallery(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const title = stringField(body.title ?? current.title, 'title', 300)
  const pageCount = body.page_count === undefined
    ? current.page_count == null ? null : Number(current.page_count)
    : body.page_count == null ? null : integerField(body.page_count, 'page_count', 1, BLOG_GALLERY_MAX_PAGES)
  const resumePage = body.resume_page === undefined ? Number(current.resume_page) : integerField(body.resume_page, 'resume_page', 1, BLOG_GALLERY_MAX_PAGES)
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, title = ?, page_count = ?, resume_page = ?, updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(nextVersion, mutationToken, title, pageCount, resumePage, actor, now, id, actor, version),
    auditInsert(db, actor, 'gallery.update', id, { status: 'draft', version: nextVersion }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ])
  if (changes(result[0]) !== 1) {
    const latest = await galleryRow(db, actor, id)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(latest.version) } })
  }
  return galleryDetail(db, actor, id)
}

async function validateGalleryAssets(db: D1Like, actor: string, page: GalleryPageInput): Promise<void> {
  const result = await db.prepare(`
    SELECT id, kind, created_by, status FROM blog_assets
    WHERE id IN (?, ?) LIMIT 2
  `).bind(page.asset_id, page.thumbnail_asset_id).all()
  const assets = new Map(rows<{ id: string, kind: string, created_by: string, status: string }>(result).map(row => [row.id, row]))
  const main = assets.get(page.asset_id)
  const thumbnail = assets.get(page.thumbnail_asset_id)
  if (!main || main.created_by !== actor || main.status !== 'ready' || !['image', 'gif'].includes(main.kind))
    throw createError({ statusCode: 400, statusMessage: 'Gallery page asset is unavailable' })
  if (!thumbnail || thumbnail.created_by !== actor || thumbnail.status !== 'ready' || !['image', 'gif'].includes(thumbnail.kind))
    throw createError({ statusCode: 400, statusMessage: 'Gallery thumbnail asset is unavailable' })
}

async function saveGalleryPage(event: H3Event, id: string, pageId: string | null = null) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const page = galleryPageInput(body.page ?? body)
  await validateGalleryAssets(db, actor, page)
  if (pageId) {
    const existing = first<{ id: string }>(await db.prepare('SELECT id FROM blog_gallery_pages WHERE id = ? AND gallery_id = ? LIMIT 1').bind(pageId, id).all())
    if (!existing)
      throw createError({ statusCode: 404, statusMessage: 'Gallery page not found' })
  }
  const existingOriginal = first<{ id: string }>(await db.prepare('SELECT id FROM blog_gallery_pages WHERE gallery_id = ? AND original_page = ? LIMIT 1').bind(id, page.original_page).all())
  if (pageId && existingOriginal && existingOriginal.id !== pageId)
    throw createError({ statusCode: 409, statusMessage: 'That original page is already assigned' })
  const targetId = pageId ?? existingOriginal?.id ?? crypto.randomUUID().replaceAll('-', '')
  const orderConflict = first<{ id: string }>(await db.prepare('SELECT id FROM blog_gallery_pages WHERE gallery_id = ? AND sort_order = ? AND id <> ? LIMIT 1').bind(id, page.sort_order, targetId).all())
  if (orderConflict)
    throw createError({ statusCode: 409, statusMessage: 'Gallery page order is already assigned' })
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const statements = [
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, resume_page = MIN(?, MAX(resume_page, ?)), updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(nextVersion, mutationToken, BLOG_GALLERY_MAX_PAGES, page.original_page + 1, actor, now, id, actor, version),
    db.prepare(`
      INSERT INTO blog_gallery_pages (id, gallery_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?
      WHERE EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND version = ? AND mutation_token = ? AND status = 'draft')
      ON CONFLICT(gallery_id, original_page) DO UPDATE SET
        title = excluded.title, caption = excluded.caption, sort_order = excluded.sort_order,
        visible = excluded.visible, asset_id = excluded.asset_id,
        thumbnail_asset_id = excluded.thumbnail_asset_id, status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(targetId, id, page.original_page, page.title, page.caption, page.sort_order, page.visible ? 1 : 0, page.asset_id, page.thumbnail_asset_id, now, now, id, nextVersion, mutationToken),
    auditInsert(db, actor, 'gallery.page.save', id, { status: 'ready', version: nextVersion, original_page: page.original_page }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ]
  const result = await db.batch(statements)
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return galleryDetail(db, actor, id)
}

export async function addBlogGalleryPage(event: H3Event, id: string) {
  return saveGalleryPage(event, id)
}

export async function updateBlogGalleryPage(event: H3Event, id: string, pageId: string) {
  return saveGalleryPage(event, id, pageId)
}

export async function deleteBlogGalleryPage(event: H3Event, id: string, pageId: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const existing = first<{ id: string }>(await db.prepare('SELECT id FROM blog_gallery_pages WHERE id = ? AND gallery_id = ? LIMIT 1').bind(pageId, id).all())
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Gallery page not found' })
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(nextVersion, mutationToken, actor, now, id, actor, version),
    db.prepare('DELETE FROM blog_gallery_pages WHERE id = ? AND gallery_id = ? AND EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND version = ? AND mutation_token = ? AND status = \'draft\')').bind(pageId, id, id, nextVersion, mutationToken),
    auditInsert(db, actor, 'gallery.page.delete', id, { status: 'deleted', version: nextVersion }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ])
  if (changes(result[1]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return galleryDetail(db, actor, id)
}

export async function finalizeBlogGallery(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status === 'finalized')
    return galleryDetail(db, actor, id)
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  if (!current.source_id || current.source_status !== 'completed')
    throw createError({ statusCode: 400, statusMessage: 'A completed PDF source is required before finalizing' })
  const pages = rows<Record<string, unknown>>(await db.prepare(`
    SELECT p.id, p.original_page, p.title, p.caption, p.sort_order, p.visible, p.asset_id, p.thumbnail_asset_id,
      p.status, a.status AS asset_status, a.created_by AS asset_owner,
      ta.status AS thumbnail_status, ta.created_by AS thumbnail_owner
    FROM blog_gallery_pages AS p
    LEFT JOIN blog_assets AS a ON a.id = p.asset_id
    LEFT JOIN blog_assets AS ta ON ta.id = p.thumbnail_asset_id
    WHERE p.gallery_id = ? ORDER BY p.original_page ASC
  `).bind(id).all())
  const expectedCount = current.page_count == null ? pages.length : Number(current.page_count)
  if (!expectedCount || expectedCount > BLOG_GALLERY_MAX_PAGES || pages.length !== expectedCount)
    throw createError({ statusCode: 400, statusMessage: 'Gallery pages are incomplete' })
  for (const [index, page] of pages.entries()) {
    if (Number(page.original_page) !== index + 1 || page.status !== 'ready' || page.asset_status !== 'ready' || page.thumbnail_status !== 'ready' || page.asset_owner !== actor || page.thumbnail_owner !== actor)
      throw createError({ statusCode: 400, statusMessage: 'Gallery pages must be sequential and ready before finalizing' })
  }
  const manifestId = crypto.randomUUID().replaceAll('-', '')
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const nextVersion = version + 1
  const statements = [
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, status = \'finalized\', page_count = ?, finalized_manifest_id = ?, finalized_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(nextVersion, mutationToken, expectedCount, manifestId, now, actor, now, id, actor, version),
    db.prepare(`
      INSERT INTO blog_gallery_manifests (id, gallery_id, revision, title, created_by, created_at)
      SELECT ?, id, COALESCE((SELECT MAX(revision) FROM blog_gallery_manifests WHERE gallery_id = blog_galleries.id), 0) + 1, title, ?, ? FROM blog_galleries
      WHERE id = ? AND status = 'finalized' AND finalized_manifest_id = ? AND version = ? AND mutation_token = ?
    `).bind(manifestId, actor, now, id, manifestId, nextVersion, mutationToken),
    db.prepare(`
      INSERT INTO blog_gallery_manifest_pages (manifest_id, page_id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id)
      SELECT ?, id, original_page, title, caption, sort_order, visible, asset_id, thumbnail_asset_id
      FROM blog_gallery_pages WHERE gallery_id = ?
        AND EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND status = 'finalized' AND finalized_manifest_id = ? AND version = ? AND mutation_token = ?)
      ORDER BY original_page ASC
    `).bind(manifestId, id, id, manifestId, nextVersion, mutationToken),
    db.prepare('INSERT INTO blog_post_gallery_refs (post_id, manifest_id, scope) SELECT post_id, ?, \'draft\' FROM blog_galleries WHERE id = ? AND status = \'finalized\' AND finalized_manifest_id = ? AND version = ? AND mutation_token = ?').bind(manifestId, id, manifestId, nextVersion, mutationToken),
    auditInsert(db, actor, 'gallery.finalize', id, { status: 'finalized', version: nextVersion, manifest_id: manifestId }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ]
  const result = await db.batch(statements)
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return galleryDetail(db, actor, id)
}

export async function reopenBlogGalleryDraft(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'finalized')
    throw createError({ statusCode: 409, statusMessage: 'Gallery is already a draft' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, status = \'draft\', updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'finalized\' AND version = ?').bind(nextVersion, mutationToken, actor, now, id, actor, version),
    auditInsert(db, actor, 'gallery.reopen', id, { status: 'draft', version: nextVersion, manifest_id: current.finalized_manifest_id }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return galleryDetail(db, actor, id)
}

export async function reorderBlogGalleryPages(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const pageRows = rows<{ id: string }>(await db.prepare('SELECT id FROM blog_gallery_pages WHERE gallery_id = ? ORDER BY sort_order ASC, original_page ASC').bind(id).all())
  let orderedIds: string[]
  if (Array.isArray(body.page_ids)) {
    orderedIds = body.page_ids.map(value => idField(value, 'page id'))
  }
  else if (Array.isArray(body.pages)) {
    const entries = body.pages.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw createError({ statusCode: 400, statusMessage: 'pages must contain objects' })
      const item = value as Record<string, unknown>
      return {
        id: idField(item.page_id ?? item.id, 'page id'),
        order: integerField(item.order ?? item.sort_order, 'order', 0, BLOG_GALLERY_MAX_PAGES - 1),
      }
    })
    entries.sort((a, b) => a.order - b.order)
    if (entries.some((entry, index) => entry.order !== index))
      throw createError({ statusCode: 400, statusMessage: 'page orders must be contiguous from zero' })
    orderedIds = entries.map(entry => entry.id)
  }
  else {
    throw createError({ statusCode: 400, statusMessage: 'page_ids or pages is required' })
  }
  if (orderedIds.length !== pageRows.length || orderedIds.length > BLOG_GALLERY_MAX_PAGES)
    throw createError({ statusCode: 400, statusMessage: 'Reorder must include every gallery page exactly once' })
  const knownIds = new Set(pageRows.map(page => page.id))
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some(pageId => !knownIds.has(pageId)))
    throw createError({ statusCode: 400, statusMessage: 'Reorder must include every gallery page exactly once' })
  const desired = JSON.stringify(Object.fromEntries(orderedIds.map((pageId, order) => [pageId, order])))
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_galleries SET version = ?, mutation_token = ?, updated_by = ?, updated_at = ? WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(nextVersion, mutationToken, actor, now, id, actor, version),
    db.prepare(`
      WITH desired(id, sort_order) AS (
        SELECT key, CAST(value AS INTEGER) FROM json_each(?)
      )
      UPDATE blog_gallery_pages
      SET sort_order = (SELECT sort_order FROM desired WHERE desired.id = blog_gallery_pages.id), updated_at = ?
      WHERE gallery_id = ?
        AND id IN (SELECT id FROM desired)
        AND EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND status = 'draft' AND version = ? AND mutation_token = ?)
    `).bind(desired, now, id, id, nextVersion, mutationToken),
    auditInsert(db, actor, 'gallery.pages.reorder', id, { status: 'draft', version: nextVersion, page_ids: orderedIds }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return galleryDetail(db, actor, id)
}

export async function deleteBlogGallery(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  if (current.finalized_manifest_id)
    throw createError({ statusCode: 409, statusMessage: 'A gallery with an immutable manifest cannot be deleted' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  const result = await db.batch([
    db.prepare('DELETE FROM blog_galleries WHERE id = ? AND created_by = ? AND status = \'draft\' AND version = ?').bind(id, actor, version),
    auditInsert(db, actor, 'gallery.delete', id, { status: 'deleted', version }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  return { deleted: true }
}

function sourceResponse(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    filename: String(row.filename),
    mime_type: String(row.mime_type),
    size: Number(row.size),
    part_size: Number(row.part_size),
    status: String(row.status),
    created_at: String(row.created_at),
    completed_at: row.completed_at == null ? null : String(row.completed_at),
  }
}

async function sourceUploadRow(event: H3Event, uploadId: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const row = first<Record<string, unknown>>(await db.prepare(`
    SELECT s.*, g.id AS gallery_id, g.version AS gallery_version, g.status AS gallery_status
    FROM blog_gallery_sources AS s INNER JOIN blog_galleries AS g ON g.id = s.gallery_id
    WHERE s.id = ? AND s.created_by = ? LIMIT 1
  `).bind(uploadId, actor).all())
  if (!row)
    throw createError({ statusCode: 404, statusMessage: 'Gallery source upload not found' })
  return { actor, db, row }
}

export async function initBlogGallerySource(event: H3Event, id: string) {
  const actor = blogActor(event)
  const db = requireDb(event)
  const bucket = requirePortfolioMedia(event)
  const body = await parseJsonBody<Record<string, unknown>>(event)
  const current = await galleryRow(db, actor, id)
  if (current.status !== 'draft')
    throw createError({ statusCode: 409, statusMessage: 'Finalized galleries are immutable' })
  const version = integerField(body.version, 'version', 1, Number.MAX_SAFE_INTEGER)
  if (Number(current.version) !== version)
    throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: Number(current.version) } })
  if (current.source_id && current.source_status === 'completed')
    return { source: { id: String(current.source_id), filename: String(current.source_filename), mime_type: String(current.source_mime_type), size: Number(current.source_size), part_size: BLOG_UPLOAD_PART_SIZE, status: 'completed' } }
  const filename = safeFilename(body.filename)
  const mimeType = stringField(body.mime_type ?? BLOG_GALLERY_SOURCE_MIME, 'mime_type', 120).toLowerCase()
  if (mimeType !== BLOG_GALLERY_SOURCE_MIME)
    throw createError({ statusCode: 400, statusMessage: 'Gallery source must be a PDF' })
  const size = integerField(body.size, 'size', 1, BLOG_MAX_SOURCE_SIZE)
  const pageCount = body.page_count == null ? current.page_count == null ? null : Number(current.page_count) : integerField(body.page_count, 'page_count', 1, BLOG_GALLERY_MAX_PAGES)
  const sourceId = crypto.randomUUID().replaceAll('-', '')
  const objectKey = `blog/originals/gallery/${id}/${sourceId}/${filename}`
  const multipart = await bucket.createMultipartUpload(objectKey, { httpMetadata: { contentType: BLOG_GALLERY_SOURCE_MIME } })
  const now = new Date().toISOString()
  const nextVersion = version + 1
  const mutationToken = crypto.randomUUID()
  try {
    const result = await db.batch([
      db.prepare(`
        INSERT INTO blog_gallery_sources (id, gallery_id, filename, mime_type, size, object_key, r2_upload_id, part_size, status, created_by, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?
        WHERE EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND created_by = ? AND status = 'draft' AND version = ?)
      `).bind(sourceId, id, filename, BLOG_GALLERY_SOURCE_MIME, size, objectKey, multipart.uploadId, BLOG_UPLOAD_PART_SIZE, actor, now, id, actor, version),
      db.prepare(`
        UPDATE blog_galleries SET version = ?, mutation_token = ?, source_id = ?, page_count = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND created_by = ? AND status = 'draft' AND version = ?
          AND EXISTS (SELECT 1 FROM blog_gallery_sources WHERE id = ? AND gallery_id = ? AND created_by = ? AND status = 'active')
      `).bind(nextVersion, mutationToken, sourceId, pageCount, actor, now, id, actor, version, sourceId, id, actor),
      db.prepare(`
        DELETE FROM blog_gallery_sources
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND source_id = ? AND mutation_token = ? AND version = ?)
      `).bind(sourceId, id, sourceId, mutationToken, nextVersion),
      auditInsert(db, actor, 'gallery.source.init', id, { status: 'active', version: nextVersion, source_id: sourceId }, 'EXISTS (SELECT 1 FROM blog_galleries WHERE id = ? AND mutation_token = ? AND version = ?)', [id, mutationToken, nextVersion]),
    ])
    if (changes(result[0]) !== 1 || changes(result[1]) !== 1)
      throw createError({ statusCode: 409, statusMessage: 'Gallery has changed', data: { current_version: await currentGalleryVersion(db, actor, id) } })
  }
  catch (error) {
    await multipart.abort().catch(() => undefined)
    throw error
  }
  return { source: sourceResponse({ id: sourceId, filename, mime_type: BLOG_GALLERY_SOURCE_MIME, size, part_size: BLOG_UPLOAD_PART_SIZE, status: 'active', created_at: now }), upload: { id: sourceId, part_size: BLOG_UPLOAD_PART_SIZE, parts: [] }, version: nextVersion }
}

export async function getBlogGallerySourceUpload(event: H3Event, uploadId: string) {
  const { db, row } = await sourceUploadRow(event, uploadId)
  const parts = await db.prepare('SELECT part_number, etag, size FROM blog_gallery_source_parts WHERE source_id = ? ORDER BY part_number ASC').bind(uploadId).all()
  return { source: sourceResponse(row), upload: { id: uploadId, part_size: Number(row.part_size), status: String(row.status), parts: rows(parts) } }
}

export async function putBlogGallerySourcePart(event: H3Event, uploadId: string, partNumber: number) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > BLOG_MAX_UPLOAD_PARTS)
    throw createError({ statusCode: 400, statusMessage: 'Gallery source upload part is invalid' })
  const { actor, db, row } = await sourceUploadRow(event, uploadId)
  if (row.status !== 'active')
    throw createError({ statusCode: 409, statusMessage: 'Gallery source upload is no longer active' })
  const requestLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(requestLength) || requestLength > BLOG_UPLOAD_PART_SIZE || requestLength <= 0)
    throw createError({ statusCode: 413, statusMessage: 'Upload parts must be between 1 and 10 MiB' })
  const body = getRequestWebStream(event)
  if (!body)
    throw createError({ statusCode: 413, statusMessage: 'Upload part is too large' })
  const bucket = requirePortfolioMedia(event)
  const upload = bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id))
  let observedLength = 0
  const fixedBody = knownLengthStream(requestLength)
  const countedBody = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const value = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
      observedLength += value.byteLength
      if (observedLength > requestLength || observedLength > BLOG_UPLOAD_PART_SIZE) {
        controller.error(createError({ statusCode: 413, statusMessage: 'Upload part exceeds declared size' }))
        return
      }
      controller.enqueue(value)
    },
    flush(controller) {
      if (observedLength !== requestLength)
        controller.error(createError({ statusCode: 400, statusMessage: 'Upload part size does not match Content-Length' }))
    },
  })
  const pump = body.pipeThrough(countedBody).pipeTo(fixedBody.writable)
  const uploadPromise = upload.uploadPart(partNumber, fixedBody.readable)
  const [, uploaded] = await Promise.all([pump, uploadPromise])
  const etag = String(uploaded.etag)
  const result = await db.batch([
    db.prepare(`
      INSERT INTO blog_gallery_source_parts (source_id, part_number, etag, size)
      SELECT ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM blog_gallery_sources WHERE id = ? AND created_by = ? AND status = 'active')
      ON CONFLICT(source_id, part_number) DO UPDATE SET etag = excluded.etag, size = excluded.size
    `).bind(uploadId, partNumber, etag, requestLength, uploadId, actor),
    auditInsert(db, actor, 'gallery.source.part', String(row.gallery_id), { status: 'active', upload_id: uploadId, part_number: partNumber }, 'EXISTS (SELECT 1 FROM blog_gallery_sources WHERE id = ? AND status = \'active\') AND EXISTS (SELECT 1 FROM blog_gallery_source_parts WHERE source_id = ? AND part_number = ? AND etag = ?)', [uploadId, uploadId, partNumber, etag]),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery source upload is no longer active' })
  return { part_number: partNumber, etag }
}

export async function completeBlogGallerySourceUpload(event: H3Event, uploadId: string) {
  const { actor, db, row } = await sourceUploadRow(event, uploadId)
  if (row.status === 'completed')
    return { source: sourceResponse(row) }
  if (row.status !== 'active')
    throw createError({ statusCode: 409, statusMessage: 'Gallery source upload is no longer active' })
  const body = await parseJsonBody<Record<string, unknown>>(event)
  if (!Array.isArray(body.parts) || body.parts.length < 1 || body.parts.length > BLOG_MAX_UPLOAD_PARTS)
    throw createError({ statusCode: 400, statusMessage: 'parts must be a non-empty array' })
  const recorded = rows<{ part_number: number, etag: string, size: number }>(await db.prepare('SELECT part_number, etag, size FROM blog_gallery_source_parts WHERE source_id = ? ORDER BY part_number ASC').bind(uploadId).all())
  const requested = body.parts.map((part) => {
    if (!part || typeof part !== 'object')
      throw createError({ statusCode: 400, statusMessage: 'Invalid upload part' })
    const value = part as Record<string, unknown>
    return { part_number: integerField(value.part_number, 'part_number', 1, BLOG_MAX_UPLOAD_PARTS), etag: stringField(value.etag, 'etag', 512) }
  }).sort((a, b) => a.part_number - b.part_number)
  if (requested.some((part, index) => part.part_number !== index + 1))
    throw createError({ statusCode: 400, statusMessage: 'Upload parts must be contiguous' })
  if (recorded.length !== requested.length || recorded.some((part, index) => part.part_number !== requested[index]?.part_number || part.etag !== requested[index]?.etag))
    throw createError({ statusCode: 409, statusMessage: 'Upload part etags do not match recorded parts' })
  const totalSize = recorded.reduce((total, part) => total + Number(part.size), 0)
  if (totalSize !== Number(row.size))
    throw createError({ statusCode: 409, statusMessage: 'Uploaded size does not match metadata' })
  const bucket = requirePortfolioMedia(event)
  await bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id)).complete(requested.map(part => ({ partNumber: part.part_number, etag: part.etag })))
  const now = new Date().toISOString()
  const result = await db.batch([
    db.prepare('UPDATE blog_gallery_sources SET status = \'completed\', completed_at = ? WHERE id = ? AND created_by = ? AND status = \'active\'').bind(now, uploadId, actor),
    auditInsert(db, actor, 'gallery.source.complete', String(row.gallery_id), { status: 'completed', upload_id: uploadId }, 'changes() = 1'),
  ])
  if (changes(result[0]) !== 1)
    throw createError({ statusCode: 409, statusMessage: 'Gallery source completion raced another request' })
  return { source: sourceResponse({ ...row, status: 'completed', completed_at: now }) }
}

export async function abortBlogGallerySourceUpload(event: H3Event, uploadId: string) {
  const { actor, db, row } = await sourceUploadRow(event, uploadId)
  if (row.status === 'completed')
    throw createError({ statusCode: 409, statusMessage: 'Completed gallery sources are immutable' })
  const bucket = requirePortfolioMedia(event)
  await bucket.resumeMultipartUpload(String(row.object_key), String(row.r2_upload_id)).abort().catch(() => undefined)
  await db.batch([
    db.prepare('UPDATE blog_gallery_sources SET status = \'aborted\' WHERE id = ? AND created_by = ? AND status = \'active\'').bind(uploadId, actor),
    auditInsert(db, actor, 'gallery.source.abort', String(row.gallery_id), { status: 'aborted', upload_id: uploadId }, 'changes() = 1'),
  ])
  return { aborted: true }
}

export async function serveBlogGallerySource(event: H3Event, id: string): Promise<ReadableStream | null> {
  const actor = blogActor(event)
  const db = requireDb(event)
  const row = first<Record<string, unknown>>(await db.prepare(`
    SELECT s.id, s.filename, s.mime_type, s.object_key, s.size, s.status, s.created_by
    FROM blog_gallery_sources AS s INNER JOIN blog_galleries AS g ON g.source_id = s.id
    WHERE g.id = ? AND g.created_by = ? LIMIT 1
  `).bind(id, actor).all())
  if (!row || row.status !== 'completed')
    throw createError({ statusCode: 404, statusMessage: 'Gallery source not found' })
  const bucket = requirePortfolioMedia(event)
  const range = requestRange(event, Number(row.size))
  const object = await bucket.get(String(row.object_key), range ? { range } : undefined)
  if (!object)
    throw createError({ statusCode: 404, statusMessage: 'Gallery source object not found' })
  setHeader(event, 'Content-Type', String(row.mime_type))
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Content-Disposition', `inline; filename="${String(row.filename).replaceAll('"', '')}"`)
  setHeader(event, 'Accept-Ranges', 'bytes')
  setHeader(event, 'ETag', object.etag)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Length', range.length)
    setHeader(event, 'Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${Number(row.size)}`)
  }
  else {
    setHeader(event, 'Content-Length', Number(object.size ?? row.size))
  }
  return event.method === 'HEAD' ? null : object.body
}
