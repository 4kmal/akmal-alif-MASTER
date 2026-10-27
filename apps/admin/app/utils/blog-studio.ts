import type { JSONContent } from '@tiptap/vue-3'

export type BlogArtworkMotion = 'once' | 'off'
export type BlogPostStatus = 'draft' | 'published' | 'archived'
export type BlogMediaKind = 'image' | 'gif' | 'video'

export interface BlogMediaAttrs {
  assetId: string
  kind: BlogMediaKind
  src: string
  alt: string
  caption: string
  width: number
  align: 'left' | 'center' | 'right'
  posterAssetId?: string
}

export interface BlogPostSummary {
  id: string
  title: string
  slug: string
  excerpt?: string | null
  status: BlogPostStatus
  cover_image_url?: string | null
  updated_at: string
  published_at?: string | null
  has_unpublished_changes?: boolean
}

export interface BlogPost {
  id: string
  title: string
  slug: string
  status: BlogPostStatus
  category_id?: string | null
  tag_ids?: string[]
  published_version?: number | null
  has_unpublished_changes?: boolean
  published_at?: string | null
  created_at?: string
  updated_at?: string
}

export interface BlogDraft {
  version: number
  schema_version: 1
  title: string
  slug: string
  excerpt: string
  category_id: string | null
  tag_ids: string[]
  cover_image_url: string
  cover_image_alt: string
  read_minutes: number
  meta_title: string
  meta_description: string
  content_json: JSONContent | null
  content_html: string
  updated_at: string
}

export interface BlogPostDetail {
  post: BlogPost
  draft: BlogDraft
}

export interface BlogRevision {
  id: string
  version: number
  kind?: 'legacy-original' | 'checkpoint' | 'publish' | 'restore'
  title: string
  created_at: string
  created_by?: string | null
}

export interface BlogCategory {
  id: string
  name: string
  slug: string
  description?: string | null
  sort_order?: number
  is_active?: boolean | number
  icon_key?: string | null
  version?: number
}

export interface BlogTag extends BlogCategory {}

export interface BlogTaxonomy {
  categories: BlogCategory[]
  tags: BlogTag[]
}

export function isBlogCategoryActive(value: unknown): boolean {
  return value !== false && value !== 0
}

export interface BlogAsset {
  id: string
  name: string
  mime_type: string
  kind: BlogMediaKind
  size: number
  width?: number | null
  height?: number | null
  duration_ms?: number | null
  url: string
  source_url: string
  derived_from?: string[]
  created_at: string
}

export interface BlogMediaProject {
  id: string
  version: number
  title: string
  document: unknown
  updated_at: string
}

export interface BlogMediaUploadPart {
  part_number: number
  etag: string
}

export interface BlogMediaUpload {
  id: string
  part_size: 10485760
  parts: BlogMediaUploadPart[]
}

export interface BlogSettings {
  artwork_motion: BlogArtworkMotion
}

export interface LegacyConversionIssue {
  tag: string
  message: string
  count: number
}

export interface LegacyConversionResult {
  document: JSONContent
  issues: LegacyConversionIssue[]
  originalHtml: string
  convertedAt: string
}

export interface BlogApiResponse<T> {
  data?: T
  error?: unknown
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

export function formatDate(value?: string | null): string {
  if (!value)
    return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf()))
    return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function isStaleDraftError(error: unknown): error is { status: number, data: { current_version: number } } {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && (error as { status?: unknown }).status === 409
    && 'data' in error
    && typeof (error as { data?: unknown }).data === 'object'
    && (error as { data?: { current_version?: unknown } }).data?.current_version !== undefined
}

export function cloneDraft(draft: BlogDraft): BlogDraft {
  return JSON.parse(JSON.stringify(draft)) as BlogDraft
}

export function createEmptyDraft(): BlogDraft {
  return {
    version: 0,
    schema_version: 1,
    title: '',
    slug: '',
    excerpt: '',
    category_id: null,
    tag_ids: [],
    cover_image_url: '',
    cover_image_alt: '',
    read_minutes: 1,
    meta_title: '',
    meta_description: '',
    content_json: { type: 'doc', content: [{ type: 'paragraph' }] },
    content_html: '<p></p>',
    updated_at: new Date(0).toISOString(),
  }
}
