import { describe, expect, it } from 'vitest'
import { getGalleryPdfPartRanges, getRecordedGalleryPdfBytes, isPdfHeader, validateGalleryPdf } from '../app/composables/useGalleryPdfUpload'
import { isBlogCategoryActive } from '../app/utils/blog-studio'
import { calendarPrivacyPreview, GALLERY_MAX_PAGES, normalizeCalendarEvent, normalizeGalleryManifest, normalizeYouTubeVideoId, toCalendarApiPayload, validateCalendarEvent, validateGalleryPageCount, withCalendarVersion } from '../app/utils/content-calendar'
import { getNativeGalleryViewportSize, getPendingGalleryPageNumbers } from '../app/utils/gallery-pdf-renderer'

describe('gallery and calendar client contracts', () => {
  it('validates the exact 11-character YouTube IDs and accepts safe URL forms', () => {
    expect(normalizeYouTubeVideoId('hez2yR4GyTA')).toBe('hez2yR4GyTA')
    expect(normalizeYouTubeVideoId('https://www.youtube.com/watch?v=Lk7qlmClqhw')).toBe('Lk7qlmClqhw')
    expect(normalizeYouTubeVideoId('https://youtu.be/M0n6kiUxZgA')).toBe('M0n6kiUxZgA')
    expect(normalizeYouTubeVideoId('too-short')).toBeNull()
    expect(normalizeYouTubeVideoId('https://youtube.com/watch?v=bad<script>')).toBeNull()
  })

  it('keeps native page dimensions and schedules only incomplete pages', () => {
    expect(getNativeGalleryViewportSize(1280, 1707)).toEqual({ width: 1280, height: 1707, scale: 1 })
    expect(getNativeGalleryViewportSize(1280, 1707, true).scale).toBeLessThan(1)
    expect(getPendingGalleryPageNumbers([
      { page_number: 1, status: 'complete', image_asset_id: 'image-1', thumbnail_asset_id: 'thumb-1' },
      { page_number: 2, status: 'complete', image_asset_id: 'image-2', thumbnail_asset_id: null },
      { page_number: 3, status: 'pending' },
    ])).toEqual([2, 3])
  })

  it('validates malformed PDFs, size limits, part resume and the 512-page cap', async () => {
    const malformed = new File(['not a pdf'], 'bad.pdf', { type: 'application/pdf' })
    expect(isPdfHeader(new Uint8Array(await malformed.slice(0, 5).arrayBuffer()))).toBe(false)
    expect(() => validateGalleryPdf(malformed)).not.toThrow()
    expect(() => validateGalleryPageCount(GALLERY_MAX_PAGES)).not.toThrow()
    expect(() => validateGalleryPageCount(GALLERY_MAX_PAGES + 1)).toThrow(/512/)

    const size = 25 * 1024 * 1024 + 4
    const ranges = getGalleryPdfPartRanges(size)
    expect(ranges).toHaveLength(3)
    expect(getRecordedGalleryPdfBytes(size, [{ part_number: 1, etag: 'a' }, { part_number: 3, etag: 'c' }])).toBe(15 * 1024 * 1024 + 4)
  })

  it('normalizes gallery schema 1 pages and preserves old finalized revisions', () => {
    const manifest = normalizeGalleryManifest({ id: 'gallery', title: 'Archive', status: 'finalized', revision: 2, pages: [{ page_number: 2, order: 1 }, { page_number: 1, order: 0 }] })
    expect(manifest.schema_version).toBe(1)
    expect(manifest.status).toBe('finalized')
    expect(manifest.pages.map(page => page.page_number)).toEqual([1, 2])
  })

  it('adapts the nested owner gallery DTO and keeps ready pages resumable', () => {
    const gallery = normalizeGalleryManifest({
      gallery: {
        id: 'gallery-id',
        post_id: 'post-id',
        version: 4,
        status: 'draft',
        title: 'Anthem',
        resume: { next_page: 3, uploaded_pages: 2 },
        page_count: 211,
        source: { id: 'source-id', filename: 'anthem.pdf', mime_type: 'application/pdf', size: 187, status: 'completed', created_at: '2026-10-28T00:00:00.000Z', completed_at: '2026-10-28T00:01:00.000Z' },
        manifest_id: null,
        finalized_at: null,
        created_at: '2026-10-28T00:00:00.000Z',
        updated_at: '2026-10-28T00:01:00.000Z',
      },
      pages: [{ id: 'page-1', original_page: 1, order: 0, visible: true, asset_id: 'asset-1', thumbnail_asset_id: 'thumb-1', status: 'ready' }, { id: 'page-2', original_page: 2, order: 1, visible: true, asset_id: 'asset-2', thumbnail_asset_id: 'thumb-2', status: 'ready' }],
      manifest: null,
    })
    expect(gallery.post_id).toBe('post-id')
    expect(gallery.source?.id).toBe('source-id')
    expect(gallery.pages.every(page => page.status === 'complete')).toBe(true)
    expect(gallery.pages.map(page => page.original_page)).toEqual([1, 2])
  })

  it('validates timed and all-day calendar dates and includes CAS versions', () => {
    const timed = { kind: 'meeting' as const, title: 'Review', timezone: 'Asia/Kuala_Lumpur', all_day: false, start_at: '2026-10-28T08:00:00.000Z', end_at: '2026-10-28T09:00:00.000Z', date: null, end_date_exclusive: null, visibility: 'private' as const, participation: 'confirmed' as const }
    expect(validateCalendarEvent(timed).valid).toBe(true)
    expect(validateCalendarEvent({ ...timed, end_at: timed.start_at }).errors.end_at).toMatch(/after/)
    expect(validateCalendarEvent({ ...timed, all_day: true, start_at: null, end_at: null, date: '2026-10-28', end_date_exclusive: '2026-10-29' }).valid).toBe(true)
    expect(validateCalendarEvent({ ...timed, all_day: true, start_at: null, end_at: null, date: '2026-10-28', end_date_exclusive: '2026-10-28' }).valid).toBe(false)
    expect(validateCalendarEvent({ ...timed, all_day: true, start_at: null, end_at: null, date: '2026-02-30', end_date_exclusive: '2026-03-01' }).errors.date).toMatch(/start/)
    expect(validateCalendarEvent({ ...timed, start_at: 'not-a-date' }).errors.start_at).toMatch(/start/)
    expect(withCalendarVersion(timed, 7).version).toBe(7)
  })

  it('redacts private and busy calendar previews', () => {
    const source = { title: 'Private meeting', description: 'Secret', location: 'Room 7', url: 'https://private.invalid', visibility: 'private' as const, start_at: '2026-10-28T08:00:00.000Z', end_at: '2026-10-28T09:00:00.000Z', date: null, end_date_exclusive: null, all_day: false, timezone: 'Asia/Kuala_Lumpur' }
    expect(calendarPrivacyPreview(source)).toMatchObject({ title: 'Not publicly listed', description: '', location: '', url: '', start_at: null, end_at: null })
    expect(calendarPrivacyPreview({ ...source, visibility: 'busy' })).toMatchObject({ title: 'Busy', description: '', location: '', url: '' })
  })

  it('maps server calendar field names and archive state through the client adapter', () => {
    const event = normalizeCalendarEvent({ event: { id: 'event-id', version: 3, title: 'Busy block', kind: 'meeting', timezone: 'Asia/Kuala_Lumpur', all_day: false, starts_at: '2026-10-28T08:00:00.000Z', ends_at: '2026-10-28T09:00:00.000Z', start_date: null, end_date: null, visibility: 'busy', participation: 'confirmed', blocks_availability: true, archived: true } })
    expect(event.status).toBe('archived')
    expect(event.start_at).toContain('08:00')
    expect(toCalendarApiPayload({ ...event, status: undefined as never }).starts_at).toContain('08:00')
  })

  it('treats category false and zero as deactivated while retaining other values', () => {
    expect(isBlogCategoryActive(false)).toBe(false)
    expect(isBlogCategoryActive(0)).toBe(false)
    expect(isBlogCategoryActive(true)).toBe(true)
    expect(isBlogCategoryActive(undefined)).toBe(true)
  })
})
