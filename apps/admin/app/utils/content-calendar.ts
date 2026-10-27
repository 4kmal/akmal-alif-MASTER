import type { BlogAsset } from '@/utils/blog-studio'

export const GALLERY_SOURCE_MAX_BYTES = 250 * 1024 * 1024
export const GALLERY_SOURCE_PART_SIZE = 10 * 1024 * 1024
export const GALLERY_MAX_CONCURRENT_PARTS = 2
export const GALLERY_MAX_PAGES = 512
export const GALLERY_SCHEMA_VERSION = 1 as const

export type GalleryVisibility = 'private' | 'public'
export type GalleryRevisionStatus = 'draft' | 'finalized'
export type GalleryPageStatus = 'pending' | 'complete'

export interface GallerySource {
  id: string
  filename: string | null
  mime_type: string | null
  size: number | null
  status: 'active' | 'completed' | 'aborted' | string
  created_at: string | null
  completed_at: string | null
}

/** A page returned by the owner-only gallery workspace API. */
export interface GalleryPage {
  id?: string
  page_number: number
  original_page?: number
  order: number
  title?: string | null
  caption?: string | null
  visible: boolean
  status: GalleryPageStatus
  width?: number | null
  height?: number | null
  image_asset_id?: string | null
  thumbnail_asset_id?: string | null
  /** Backend DTO names retained for request construction and round-tripping. */
  asset_id?: string | null
  image?: BlogAsset | null
  thumbnail?: BlogAsset | null
}

export interface GalleryManifestSnapshot {
  id: string
  revision: number
  title: string
  created_at: string
  pages: GalleryPage[]
}

/** Flattened view model for the backend `{ gallery, pages, manifest }` DTO. */
export interface GalleryManifest {
  id: string
  post_id: string
  schema_version: typeof GALLERY_SCHEMA_VERSION
  version: number
  revision: number
  status: GalleryRevisionStatus
  title: string
  /** Kept for forward-compatible DTOs; current backend stores captions per page. */
  caption: string
  /** Current backend exposes privacy through post references, so source data stays private. */
  visibility: GalleryVisibility
  resume: { next_page: number, uploaded_pages: number }
  source: GallerySource | null
  source_asset_id: string | null
  source_filename: string | null
  source_size: number | null
  page_count: number
  pages: GalleryPage[]
  manifest_id: string | null
  manifest: GalleryManifestSnapshot | null
  created_at: string
  updated_at: string
  finalized_at?: string | null
}

export interface GallerySummary extends Pick<GalleryManifest, 'id' | 'post_id' | 'title' | 'status' | 'page_count' | 'updated_at'> {
  revision: number
  manifest_id: string | null
  source_filename?: string | null
}

export interface GalleryUploadPart {
  part_number: number
  etag: string
  size?: number
}

export interface GallerySourceUpload {
  id: string
  gallery_id?: string
  asset_id?: string | null
  filename?: string | null
  mime_type?: string | null
  size?: number | null
  part_size: number
  status: 'active' | 'completed' | 'aborted' | string
  parts: GalleryUploadPart[]
  page_count?: number | null
}

export interface GalleryRevisionSummary {
  id: string
  revision: number
  status: Extract<GalleryRevisionStatus, 'finalized'>
  title: string
  page_count: number
  created_at: string
  finalized_at?: string | null
}

export interface GalleryDetailDto {
  gallery: {
    id: string
    post_id: string
    version: number
    status: GalleryRevisionStatus
    title: string
    resume: { next_page: number, uploaded_pages: number }
    page_count: number | null
    source: GallerySource | null
    manifest_id: string | null
    finalized_at: string | null
    created_at: string
    updated_at: string
  }
  pages: GalleryPage[]
  manifest: GalleryManifestSnapshot | null
}

export type CalendarEventKind = 'activity' | 'event' | 'meeting'
export type CalendarEventStatus = 'active' | 'archived'
export type CalendarVisibility = 'private' | 'public' | 'busy'
export type CalendarParticipation = 'interested' | 'planning' | 'confirmed'

/** Normalized client event; the API adapter maps `starts_at`/`start_date` into these names. */
export interface CalendarEvent {
  id: string
  version: number
  status: CalendarEventStatus
  kind: CalendarEventKind
  title: string
  description: string
  location: string
  url: string
  timezone: string
  start_at: string | null
  end_at: string | null
  all_day: boolean
  date: string | null
  end_date_exclusive: string | null
  visibility: CalendarVisibility
  participation: CalendarParticipation
  blocks_availability: boolean
  created_at?: string
  updated_at?: string
  archived_at?: string | null
}

export interface CalendarSettings {
  version: number
  timezone: string
  updated_at?: string
}

export interface CalendarEventInput {
  version?: number
  kind: CalendarEventKind
  title: string
  description: string
  location: string
  url: string
  timezone: string
  start_at: string | null
  end_at: string | null
  all_day: boolean
  date: string | null
  end_date_exclusive: string | null
  visibility: CalendarVisibility
  participation: CalendarParticipation
  blocks_availability: boolean
}

export interface CalendarValidationResult {
  valid: boolean
  errors: Partial<Record<keyof CalendarEventInput, string>>
}

export const DEFAULT_CALENDAR_TIMEZONE = 'Asia/Kuala_Lumpur'
export const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{11}$/

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export function isValidYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_VIDEO_ID_PATTERN.test(value)
}

export function normalizeYouTubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  const input = value.trim()
  const match = input.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/i)
  const candidate = match?.[1] ?? input
  return isValidYouTubeVideoId(candidate) ? candidate : null
}

export function validateCalendarEvent(input: Partial<CalendarEventInput>): CalendarValidationResult {
  const errors: CalendarValidationResult['errors'] = {}
  if (!input.title?.trim())
    errors.title = 'Add a title.'
  if (!input.kind || !['activity', 'event', 'meeting'].includes(input.kind))
    errors.kind = 'Choose an event kind.'
  if (!input.timezone?.trim())
    errors.timezone = 'Choose a timezone.'
  if (input.all_day) {
    if (!isIsoDate(input.date))
      errors.date = 'Choose a start date.'
    if (!isIsoDate(input.end_date_exclusive))
      errors.end_date_exclusive = 'Choose an exclusive end date.'
    else if (input.date && input.end_date_exclusive && input.end_date_exclusive <= input.date)
      errors.end_date_exclusive = 'End date must be after the start date.'
  }
  else {
    if (!isTimestamp(input.start_at))
      errors.start_at = 'Choose a start time.'
    if (!isTimestamp(input.end_at))
      errors.end_at = 'Choose an end time.'
    if (isTimestamp(input.start_at) && isTimestamp(input.end_at) && new Date(input.end_at).getTime() <= new Date(input.start_at).getTime())
      errors.end_at = 'End time must be after the start time.'
  }
  if (input.url && !/^https?:\/\//i.test(input.url))
    errors.url = 'Use an https:// or http:// URL.'
  if (input.visibility && !['private', 'public', 'busy'].includes(input.visibility))
    errors.visibility = 'Choose a visibility.'
  if (input.participation && !['interested', 'planning', 'confirmed'].includes(input.participation))
    errors.participation = 'Choose a participation state.'
  return { valid: Object.keys(errors).length === 0, errors }
}

export function withCalendarVersion(input: CalendarEventInput, version: number): CalendarEventInput & { version: number } {
  return { ...input, version }
}

export function toCalendarApiPayload(input: CalendarEventInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || null,
    location: input.location.trim() || null,
    url: input.url.trim() || null,
    kind: input.kind,
    timezone: input.timezone.trim() || DEFAULT_CALENDAR_TIMEZONE,
    all_day: input.all_day,
    start_date: input.all_day ? input.date : null,
    end_date: input.all_day ? input.end_date_exclusive : null,
    starts_at: input.all_day ? null : input.start_at,
    ends_at: input.all_day ? null : input.end_at,
    visibility: input.visibility,
    participation: input.participation,
    blocks_availability: input.blocks_availability,
  }
}

export function normalizeCalendarEvent(value: unknown): CalendarEvent {
  const wrapped = value && typeof value === 'object' ? value as { event?: unknown } : {}
  const rawValue = wrapped.event ?? value
  const raw = rawValue && typeof rawValue === 'object' ? rawValue as Record<string, unknown> : {}
  const stringOrNull = (candidate: unknown) => typeof candidate === 'string' ? candidate : null
  return {
    id: String(raw.id ?? ''),
    version: Number(raw.version ?? 0),
    status: raw.status === 'archived' || raw.archived === true || raw.archived_at ? 'archived' : 'active',
    kind: raw.kind === 'activity' || raw.kind === 'meeting' ? raw.kind : 'event',
    title: String(raw.title ?? ''),
    description: raw.description == null ? '' : String(raw.description),
    location: raw.location == null ? '' : String(raw.location),
    url: raw.url == null ? '' : String(raw.url),
    timezone: String(raw.timezone ?? DEFAULT_CALENDAR_TIMEZONE),
    start_at: stringOrNull(raw.start_at ?? raw.starts_at),
    end_at: stringOrNull(raw.end_at ?? raw.ends_at),
    all_day: raw.all_day === true || raw.all_day === 1,
    date: stringOrNull(raw.date ?? raw.start_date),
    end_date_exclusive: stringOrNull(raw.end_date_exclusive ?? raw.end_date),
    visibility: raw.visibility === 'public' || raw.visibility === 'busy' ? raw.visibility : 'private',
    participation: raw.participation === 'planning' || raw.participation === 'confirmed' ? raw.participation : 'interested',
    blocks_availability: raw.blocks_availability === true || raw.blocks_availability === 1,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
    archived_at: stringOrNull(raw.archived_at),
  }
}

export function normalizeCalendarSettings(value: Partial<CalendarSettings> & { settings?: Partial<CalendarSettings> }): CalendarSettings {
  const raw = value.settings ?? value
  return {
    version: Number(raw.version ?? 0),
    timezone: String(raw.timezone ?? DEFAULT_CALENDAR_TIMEZONE),
    updated_at: raw.updated_at,
  }
}

export function calendarPrivacyPreview(event: Pick<CalendarEvent, 'title' | 'description' | 'location' | 'url' | 'visibility' | 'start_at' | 'end_at' | 'date' | 'end_date_exclusive' | 'all_day' | 'timezone'>) {
  if (event.visibility === 'busy') {
    return {
      title: 'Busy',
      description: '',
      location: '',
      url: '',
      start_at: event.start_at,
      end_at: event.end_at,
      date: event.date,
      end_date_exclusive: event.end_date_exclusive,
      all_day: event.all_day,
      timezone: event.timezone,
    }
  }
  if (event.visibility === 'private') {
    return {
      title: 'Not publicly listed',
      description: '',
      location: '',
      url: '',
      start_at: null,
      end_at: null,
      date: null,
      end_date_exclusive: null,
      all_day: false,
      timezone: event.timezone,
    }
  }
  return { ...event }
}

export function normalizeGalleryPage(page: Partial<GalleryPage>, index = 0): GalleryPage {
  const pageNumber = Number(page.original_page ?? page.page_number ?? index + 1)
  const imageAssetId = page.asset_id ?? page.image_asset_id ?? null
  const thumbnailAssetId = page.thumbnail_asset_id ?? null
  const rawStatus = String(page.status ?? '')
  const status: GalleryPageStatus = rawStatus === 'complete' || rawStatus === 'ready' || Boolean(imageAssetId && thumbnailAssetId) ? 'complete' : 'pending'
  return {
    id: page.id,
    page_number: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : index + 1,
    original_page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : index + 1,
    order: Number.isFinite(page.order) ? Number(page.order) : index,
    title: page.title ?? null,
    caption: page.caption ?? null,
    visible: page.visible !== false,
    status,
    width: page.width ?? null,
    height: page.height ?? null,
    image_asset_id: imageAssetId,
    thumbnail_asset_id: thumbnailAssetId,
    asset_id: imageAssetId,
    image: page.image ?? null,
    thumbnail: page.thumbnail ?? null,
  }
}

export function normalizeGallerySnapshot(value: Partial<GalleryManifestSnapshot> | null | undefined): GalleryManifestSnapshot | null {
  if (!value)
    return null
  const pages = Array.isArray(value.pages) ? value.pages.map((page, index) => normalizeGalleryPage(page, index)).sort((a, b) => a.order - b.order || a.page_number - b.page_number) : []
  return {
    id: String(value.id ?? ''),
    revision: Number(value.revision ?? 0),
    title: String(value.title ?? ''),
    created_at: String(value.created_at ?? ''),
    pages,
  }
}

export function normalizeGalleryManifest(value: Partial<GalleryManifest> & Partial<GalleryDetailDto>): GalleryManifest {
  const sourceGallery = value.gallery ?? value
  const rawPages = Array.isArray(value.pages) ? value.pages : []
  const pages = rawPages.map((page, index) => normalizeGalleryPage(page, index)).sort((a, b) => a.order - b.order || a.page_number - b.page_number)
  const manifest = normalizeGallerySnapshot(value.manifest)
  const pageCount = Number(sourceGallery.page_count ?? pages.length)
  return {
    id: String(sourceGallery.id ?? ''),
    post_id: String(sourceGallery.post_id ?? ''),
    schema_version: GALLERY_SCHEMA_VERSION,
    version: Number(sourceGallery.version ?? 0),
    revision: Number(manifest?.revision ?? (value as Partial<GalleryManifest>).revision ?? 0),
    status: sourceGallery.status === 'finalized' ? 'finalized' : 'draft',
    title: String(sourceGallery.title ?? value.title ?? ''),
    caption: String((sourceGallery as Partial<GalleryManifest>).caption ?? value.caption ?? ''),
    visibility: (sourceGallery as Partial<GalleryManifest>).visibility === 'public' || value.visibility === 'public' ? 'public' : 'private',
    resume: sourceGallery.resume ?? { next_page: pages.length + 1, uploaded_pages: pages.filter(page => page.status === 'complete').length },
    source: sourceGallery.source ?? null,
    source_asset_id: null,
    source_filename: sourceGallery.source?.filename ?? null,
    source_size: sourceGallery.source?.size ?? null,
    page_count: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : pages.length,
    pages,
    manifest_id: sourceGallery.manifest_id ?? manifest?.id ?? null,
    manifest,
    created_at: String(sourceGallery.created_at ?? value.created_at ?? ''),
    updated_at: String(sourceGallery.updated_at ?? value.updated_at ?? ''),
    finalized_at: sourceGallery.finalized_at ?? value.finalized_at ?? null,
  }
}

export function gallerySummaryFromManifest(value: GalleryManifest): GallerySummary {
  return {
    id: value.id,
    post_id: value.post_id,
    title: value.title,
    status: value.status,
    page_count: value.page_count,
    updated_at: value.updated_at,
    revision: value.revision,
    manifest_id: value.manifest_id,
    source_filename: value.source_filename,
  }
}

export function galleryHasUnsavedChanges(title: string, savedTitle: string, orderDirty: boolean, pageMetadataDirty: boolean) {
  return title.trim() !== savedTitle.trim() || orderDirty || pageMetadataDirty
}

export function validateGalleryPageCount(pageCount: number) {
  if (!Number.isInteger(pageCount) || pageCount < 1)
    throw new Error('The PDF did not report a valid page count.')
  if (pageCount > GALLERY_MAX_PAGES)
    throw new Error(`The PDF has ${pageCount} pages; the limit is ${GALLERY_MAX_PAGES}.`)
  return pageCount
}
