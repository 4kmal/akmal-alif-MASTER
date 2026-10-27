import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPublicCalendarController,
  eventOverlapsRange,
  normaliseCalendarEvent,
  parseCalendarDateOnly,
} from '../../../js/public-calendar.js'
import {
  GALLERY_PAGE_SIZE,
  createBlogGalleryController,
  disposeBlogGalleries,
  initBlogGalleries,
  normaliseGalleryManifest,
} from '../../../js/blog-gallery.js'

const NOW = Date.parse('2026-10-28T12:00:00+08:00')

function calendarDocument() {
  const documentRef = new JSDOM(`<!doctype html><main id="calendar-rail">
    <ol data-calendar-upcoming></ol>
    <button data-calendar-month-toggle aria-expanded="false"><span>Month</span><span>+</span></button>
    <section data-calendar-month-panel>
      <button data-calendar-prev type="button">Previous</button>
      <button data-calendar-next type="button">Next</button>
      <button data-calendar-today type="button">Today</button>
      <h3 data-calendar-month-title></h3>
      <div data-calendar-grid role="grid"></div>
    </section>
    <div data-calendar-agenda></div>
    <p data-calendar-status></p>
  </main>`).window.document
  Object.defineProperty(documentRef, 'hidden', { configurable: true, value: false })
  Object.defineProperty(documentRef, 'visibilityState', { configurable: true, value: 'visible' })
  return documentRef
}

function response(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload }
}

function galleryPayload(count = 211) {
  return {
    id: 'manifest-1',
    manifestId: 'manifest-1',
    revision: 4,
    title: 'Anthem',
    pages: Array.from({ length: count }, (_, index) => ({
      id: `page-${index + 1}`,
      original_page: index + 1,
      title: index === 0 ? 'Opening' : null,
      caption: index === 0 ? 'A shared beginning' : null,
      order: index,
      visible: true,
      original_url: `/media/original-${index + 1}`,
      thumbnail_url: `/media/thumb-${index + 1}`,
    })),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('public calendar DOM contract', () => {
  it('rejects impossible date-only values and uses Kuala Lumpur day boundaries', () => {
    expect(parseCalendarDateOnly('2026-02-31')).toBeNull()
    const event = normaliseCalendarEvent({
      id: 'midnight-kl',
      visibility: 'public',
      starts_at: '2026-10-27T16:00:00.000Z',
      ends_at: '2026-10-27T16:30:00.000Z',
      title: 'Malaysia midnight',
    })
    expect(event).not.toBeNull()
    expect(eventOverlapsRange(event!, '2026-10-28', '2026-10-29')).toBe(true)
    expect(normaliseCalendarEvent({
      visibility: 'public',
      all_day: true,
      start_date: '2026-02-31',
      end_date: '2026-03-02',
    })).toBeNull()
  })

  it('renders server upcoming independently and keeps busy rows private', async () => {
    const documentRef = calendarDocument()
    const fetchRef = vi.fn(async () => response({
      timezone: 'Asia/Kuala_Lumpur',
      events: [
        {
          id: 'public-1',
          visibility: 'public',
          starts_at: '2026-10-28T02:00:00.000Z',
          ends_at: '2026-10-28T03:00:00.000Z',
          title: 'Public briefing',
          description: 'Public details',
          location: 'Civic hall',
          url: 'https://example.test/briefing',
          kind: 'meeting',
          participation: 'planning',
          blocks_availability: false,
        },
        {
          visibility: 'busy',
          starts_at: '2026-10-28T04:00:00.000Z',
          ends_at: '2026-10-28T05:00:00.000Z',
          title: 'Private appointment',
          location: 'Secret room',
          description: 'Private detail',
        },
        {
          visibility: 'private',
          starts_at: '2026-10-28T06:00:00.000Z',
          ends_at: '2026-10-28T07:00:00.000Z',
          title: 'Private event',
        },
      ],
      upcoming: [
        { visibility: 'public', all_day: true, start_date: '2026-10-27', end_date: '2026-10-28', title: 'Ended yesterday' },
        { visibility: 'public', all_day: true, start_date: '2026-11-02', end_date: '2026-11-03', title: 'Upcoming from server' },
      ],
    }))
    const controller = createPublicCalendarController({
      root: documentRef.querySelector('#calendar-rail')!,
      documentRef,
      fetchRef,
      nowRef: () => NOW,
      setIntervalRef: undefined,
    })!
    await controller.request

    const agendaText = documentRef.querySelector('[data-calendar-agenda]')!.textContent
    expect(agendaText).toContain('Public briefing')
    expect(agendaText).toContain('Public details')
    expect(agendaText).toContain('Civic hall')
    expect(agendaText).toContain('Your participation: planning')
    expect(agendaText).toContain('Nonblocking')
    expect(agendaText).not.toContain('Private appointment')
    expect(agendaText).not.toContain('Secret room')
    expect(documentRef.querySelectorAll('[data-calendar-participation]')).toHaveLength(0)

    const upcomingText = documentRef.querySelector('[data-calendar-upcoming]')!.textContent
    expect(upcomingText).toContain('Upcoming from server')
    expect(upcomingText).not.toContain('Ended yesterday')
    controller.dispose()
  })

  it('fetches the new month when keyboard navigation crosses its boundary', async () => {
    const documentRef = calendarDocument()
    const fetchRef = vi.fn(async (url: string) => response({ timezone: 'Asia/Kuala_Lumpur', events: [], upcoming: [{ visibility: 'public', all_day: true, start_date: '2026-11-04', end_date: '2026-11-05', title: 'Next month' }] }))
    const controller = createPublicCalendarController({
      root: documentRef.querySelector('#calendar-rail')!,
      documentRef,
      fetchRef,
      nowRef: () => NOW,
      setIntervalRef: undefined,
    })!
    await controller.request
    const lastDay = documentRef.querySelector('[data-calendar-date="2026-10-31"]') as HTMLButtonElement
    lastDay.click()
    const selectedLastDay = documentRef.querySelector('[data-calendar-date="2026-10-31"]') as HTMLButtonElement
    selectedLastDay.dispatchEvent(new documentRef.defaultView!.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    await controller.request
    expect(controller.getState().selectedDate).toBe('2026-11-01')
    expect(controller.getState().monthKey).toBe('2026-11')
    expect(fetchRef.mock.calls.some(([url]) => url.includes('start=2026-10-26') || url.includes('start=2026-10-27'))).toBe(true)
    expect(fetchRef.mock.calls.at(-1)?.[0]).toContain('end=2026-12-07')
    controller.dispose()
  })

  it('queues only the newest month and never paints an older response as current', async () => {
    const documentRef = calendarDocument()
    const requests: Array<{ url: string, resolve: (value: unknown) => void }> = []
    const fetchRef = vi.fn((url: string) => new Promise((resolve) => { requests.push({ url, resolve }) }))
    const controller = createPublicCalendarController({
      root: documentRef.querySelector('#calendar-rail')!,
      documentRef,
      fetchRef,
      nowRef: () => NOW,
      setIntervalRef: undefined,
    })!
    const firstRequest = controller.request
    await Promise.resolve()
    documentRef.querySelector<HTMLButtonElement>('[data-calendar-next]')!.click()
    documentRef.querySelector<HTMLButtonElement>('[data-calendar-next]')!.click()
    expect(fetchRef).toHaveBeenCalledTimes(1)
    requests[0]!.resolve(response({
      timezone: 'Asia/Kuala_Lumpur',
      events: [{ visibility: 'public', starts_at: '2026-10-28T02:00:00Z', ends_at: '2026-10-28T03:00:00Z', title: 'Old month' }],
      upcoming: [],
    }))
    await firstRequest
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchRef).toHaveBeenCalledTimes(2)
    expect(requests[1]!.url).toContain('start=2026-11-30')
    requests[1]!.resolve(response({
      timezone: 'Asia/Kuala_Lumpur',
      events: [{ visibility: 'public', starts_at: '2026-12-01T02:00:00Z', ends_at: '2026-12-01T03:00:00Z', title: 'Newest month' }],
      upcoming: [],
    }))
    await controller.request
    expect(controller.getState().monthKey).toBe('2026-12')
    expect(controller.getState().events.map((event) => event.title)).toEqual(['Newest month'])
    controller.dispose()
  })

  it('forces a fresh visible refresh and aborts all work on dispose', async () => {
    const documentRef = calendarDocument()
    const requests: Array<{ signal?: AbortSignal, resolve: (value: unknown) => void }> = []
    const fetchRef = vi.fn((_: string, options?: { signal?: AbortSignal }) => new Promise((resolve) => {
      requests.push({ signal: options?.signal, resolve })
    }))
    const controller = createPublicCalendarController({
      root: documentRef.querySelector('#calendar-rail')!,
      documentRef,
      fetchRef,
      nowRef: () => NOW,
      setIntervalRef: undefined,
    })!
    await Promise.resolve()
    requests[0]!.resolve(response({ timezone: 'Asia/Kuala_Lumpur', events: [], upcoming: [] }))
    await controller.request
    documentRef.dispatchEvent(new documentRef.defaultView!.Event('visibilitychange'))
    await Promise.resolve()
    expect(fetchRef).toHaveBeenCalledTimes(2)
    controller.dispose()
    expect(requests[1]!.signal?.aborted).toBe(true)
    expect(documentRef.querySelector('[data-calendar-grid]')!.children).toHaveLength(0)
  })
})

describe('public gallery DOM contract', () => {
  it('normalises an immutable manifest to 512 visible pages and preserves original numbers', () => {
    const manifest = normaliseGalleryManifest({
      id: 'manifest-1',
      title: 'Anthem',
      pages: Array.from({ length: 600 }, (_, index) => ({
        original_page: index + 1,
        order: 600 - index,
        visible: true,
        original_url: `/original/${index + 1}`,
        thumbnail_url: `/thumb/${index + 1}`,
      })),
    })
    expect(manifest.pages).toHaveLength(512)
    expect(manifest.pages[0]?.originalPage).toBe(600)
    expect(manifest.pages[0]?.originalUrl).toBe('/original/600')
  })

  it('does one request per marker, renders 24 thumbnails, and jumps by original PDF number', async () => {
    const dom = new JSDOM('<!doctype html><article data-blog-content><div class="blog-gallery" data-gallery-manifest-id="manifest-1" data-gallery-load="click" aria-label="Anthem"><noscript>Anthem</noscript></div></article>')
    const root = dom.window.document.querySelector('[data-blog-content]')!
    let resolveFetch!: (value: unknown) => void
    const fetchRef = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    initBlogGalleries(root, { fetchRef })
    initBlogGalleries(root, { fetchRef })
    expect(fetchRef).toHaveBeenCalledTimes(1)
    resolveFetch(response(galleryPayload()))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelectorAll('.blog-gallery-renderer')).toHaveLength(1)
    expect(root.querySelectorAll('.blog-gallery-thumb')).toHaveLength(GALLERY_PAGE_SIZE)
    expect(root.querySelector('.blog-gallery-thumb figcaption')?.textContent).toContain('PDF page 1')
    const next = root.querySelector('.blog-gallery-control[aria-label="Next gallery thumbnail page"]') as HTMLButtonElement
    next.click()
    expect(root.querySelectorAll('.blog-gallery-thumb')).toHaveLength(GALLERY_PAGE_SIZE)

    const firstThumb = root.querySelector('.blog-gallery-thumb-button') as HTMLButtonElement
    firstThumb.focus()
    firstThumb.click()
    const dialog = dom.window.document.querySelector('.blog-gallery-viewer') as HTMLDialogElement
    const image = dialog.querySelector('.blog-gallery-viewer-image') as HTMLImageElement
    expect(image.src).toContain('/media/original-25')
    const jump = dialog.querySelector('input[type="number"]') as HTMLInputElement
    expect(jump.value).toBe('25')
    jump.value = '1'
    dialog.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    expect(image.src).toContain('/media/original-1')
    expect(dialog.textContent).toContain('Opening')
    expect(dialog.textContent).toContain('A shared beginning')

    const arrow = new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    jump.dispatchEvent(arrow)
    expect(arrow.defaultPrevented).toBe(false)
    dialog.querySelector<HTMLButtonElement>('.blog-gallery-viewer-close')!.click()
    expect(dom.window.document.activeElement).toBe(firstThumb)
    disposeBlogGalleries(root)
    dom.window.close()
  })

  it('does not append a late dialog after article disposal and can be reinitialised', async () => {
    const dom = new JSDOM('<!doctype html><article data-blog-content><div class="blog-gallery" data-gallery-manifest-id="manifest-1"></div></article>')
    const root = dom.window.document.querySelector('[data-blog-content]')!
    let resolveFetch!: (value: unknown) => void
    const fetchRef = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))
    initBlogGalleries(root, { fetchRef })
    disposeBlogGalleries(root)
    resolveFetch(response(galleryPayload(1)))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(root.querySelector('.blog-gallery-renderer')).toBeNull()
    expect(dom.window.document.querySelector('.blog-gallery-viewer')).toBeNull()

    const secondFetch = vi.fn(async () => response(galleryPayload(1)))
    initBlogGalleries(root, { fetchRef: secondFetch })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(secondFetch).toHaveBeenCalledTimes(1)
    expect(root.querySelector('.blog-gallery-renderer')).not.toBeNull()
    disposeBlogGalleries(root)
    dom.window.close()
  })

  it('does not retry a failed manifest when unrelated article DOM changes', async () => {
    const dom = new JSDOM('<!doctype html><article data-blog-content><div class="blog-gallery" data-gallery-manifest-id="missing"></div></article>')
    const root = dom.window.document.querySelector('[data-blog-content]')!
    const fetchRef = vi.fn(async () => { throw new Error('offline') })
    initBlogGalleries(root, { fetchRef })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchRef).toHaveBeenCalledTimes(1)
    expect(root.querySelector('.blog-gallery')?.getAttribute('data-gallery-state')).toBe('error')
    root.appendChild(dom.window.document.createElement('p'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchRef).toHaveBeenCalledTimes(1)
    disposeBlogGalleries(root)
    dom.window.close()
  })

  it('supports unzoomed swipe and zoomed pan without preloading original pages', () => {
    const dom = new JSDOM('<!doctype html><article data-blog-content><div class="blog-gallery" data-gallery-manifest-id="manifest-1"></div></article>')
    const marker = dom.window.document.querySelector('.blog-gallery')!
    const controller = createBlogGalleryController({ marker, manifest: galleryPayload(2), documentRef: dom.window.document })!
    const thumb = marker.querySelector('.blog-gallery-thumb-button') as HTMLButtonElement
    thumb.click()
    const viewer = dom.window.document.querySelector('.blog-gallery-viewer')!
    const image = viewer.querySelector('.blog-gallery-viewer-image') as HTMLImageElement
    expect(image.src).toContain('/media/original-1')
    expect(marker.querySelectorAll('.blog-gallery-thumb-image')).toHaveLength(2)
    viewer.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click()
    expect(image.style.transform).toContain('scale(1.5)')
    const viewport = viewer.querySelector('.blog-gallery-viewer-viewport')!
    viewport.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }))
    viewport.dispatchEvent(new dom.window.PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 25 }))
    expect(image.style.transform).toContain('translate(20px, 15px)')
    controller.dispose()
    dom.window.close()
  })
})
