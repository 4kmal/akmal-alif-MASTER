// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, ref } from 'vue'
import { GALLERY_SOURCE_PART_SIZE, useGalleryPdfUpload } from '../app/composables/useGalleryPdfUpload'

const api = vi.hoisted(() => ({
  getGallery: vi.fn(),
  getGallerySourceUpload: vi.fn(),
  startGallerySourceUpload: vi.fn(),
  putGallerySourcePart: vi.fn(),
  completeGallerySourceUpload: vi.fn(),
}))

const renderer = vi.hoisted(() => ({
  openGalleryPdfDocument: vi.fn(),
}))

vi.mock('../app/composables/useBlogApi', () => ({
  useBlogApi: () => api,
}))

vi.mock('../app/utils/gallery-pdf-renderer', () => ({
  openGalleryPdfDocument: renderer.openGalleryPdfDocument,
}))

function makeFile(lastModified = 42) {
  return new File([`%PDF-${'x'.repeat(32)}`], 'source.pdf', { type: 'application/pdf', lastModified })
}

function makeGallery(source: Record<string, unknown> | null = null) {
  return {
    id: 'gallery-id',
    post_id: 'post-id',
    schema_version: 1,
    version: 1,
    status: 'draft',
    title: 'Gallery',
    caption: '',
    visibility: 'private',
    resume: { next_page: 1, uploaded_pages: 0 },
    source,
    source_asset_id: null,
    source_filename: source?.filename ?? null,
    source_size: source?.size ?? null,
    page_count: 1,
    pages: [],
    manifest_id: null,
    manifest: null,
    created_at: '2026-10-28T00:00:00.000Z',
    updated_at: '2026-10-28T00:00:00.000Z',
    finalized_at: null,
  }
}

async function waitFor(check: () => boolean) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 1000)
      throw new Error('Timed out waiting for PDF upload state.')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function mountUpload() {
  let upload!: ReturnType<typeof useGalleryPdfUpload>
  const app = createApp(defineComponent({
    setup() {
      upload = useGalleryPdfUpload(ref('gallery-id'), ref(1))
      return () => h('div')
    },
  }))
  app.mount(document.createElement('div'))
  return { app, upload }
}

let sourceStatus: 'active' | 'completed' = 'active'
let recordedParts: { part_number: number, etag: string, size?: number }[] = []
let pdfSession: { pageCount: number, renderPage: ReturnType<typeof vi.fn>, renderPagePair: ReturnType<typeof vi.fn>, destroy: ReturnType<typeof vi.fn> }

beforeEach(() => {
  localStorage.clear()
  sourceStatus = 'active'
  recordedParts = []
  vi.clearAllMocks()
  api.getGallery.mockResolvedValue(makeGallery())
  api.getGallerySourceUpload.mockImplementation(async () => ({
    source: { id: 'source-id', filename: 'source.pdf', mime_type: 'application/pdf', size: 37, part_size: GALLERY_SOURCE_PART_SIZE, status: sourceStatus, parts: recordedParts },
    upload: { id: 'source-id', part_size: GALLERY_SOURCE_PART_SIZE, status: sourceStatus, parts: recordedParts },
  }))
  api.startGallerySourceUpload.mockResolvedValue({
    source: { id: 'source-id', filename: 'source.pdf', mime_type: 'application/pdf', size: 37, part_size: GALLERY_SOURCE_PART_SIZE, status: 'active', parts: [] },
    upload: { id: 'source-id', part_size: GALLERY_SOURCE_PART_SIZE, status: 'active', parts: [] },
    version: 2,
  })
  api.completeGallerySourceUpload.mockImplementation(async () => {
    sourceStatus = 'completed'
    return { source: { id: 'source-id', filename: 'source.pdf', mime_type: 'application/pdf', size: 37, part_size: GALLERY_SOURCE_PART_SIZE, status: 'completed', parts: recordedParts } }
  })
  api.putGallerySourcePart.mockImplementation(async (_galleryId: string, _uploadId: string, part: number) => {
    const receipt = { part_number: part, etag: `etag-${part}`, size: 37 }
    recordedParts = [receipt]
    return receipt
  })
  api.getGallery.mockImplementation(async () => makeGallery(sourceStatus === 'completed' ? { id: 'source-id', filename: 'source.pdf', mime_type: 'application/pdf', size: 37, status: 'completed' } : null))
  pdfSession = {
    pageCount: 1,
    renderPage: vi.fn(),
    renderPagePair: vi.fn(),
    destroy: vi.fn(),
  }
  renderer.openGalleryPdfDocument.mockResolvedValue(pdfSession)
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('gallery PDF upload lifecycle', () => {
  it('pauses and resumes recorded parts without reopening the source upload', async () => {
    let releasePart!: () => void
    api.putGallerySourcePart.mockImplementationOnce(async (_galleryId: string, _uploadId: string, part: number) => {
      await new Promise<void>((resolve) => {
        releasePart = resolve
      })
      const receipt = { part_number: part, etag: `etag-${part}`, size: 37 }
      recordedParts = [receipt]
      return receipt
    })
    const { app, upload } = mountUpload()
    const pending = upload.selectFile(makeFile())
    await waitFor(() => upload.task.value?.status === 'uploading')
    const task = upload.task.value!
    upload.cancel()
    releasePart()
    await pending

    expect(task.status).toBe('paused')
    expect(upload.recoverable.value).toHaveLength(1)
    await upload.retry()

    expect(task.status).toBe('complete')
    expect(api.startGallerySourceUpload).toHaveBeenCalledTimes(1)
    expect(api.completeGallerySourceUpload).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('aborts the active render/upload session and destroys PDF.js on teardown', async () => {
    let releasePart!: () => void
    let requestSignal: AbortSignal | undefined
    api.putGallerySourcePart.mockImplementationOnce(async (_galleryId: string, _uploadId: string, part: number, _body: Blob, signal?: AbortSignal) => {
      requestSignal = signal
      await new Promise<void>((resolve) => {
        releasePart = resolve
        signal?.addEventListener('abort', resolve, { once: true })
      })
      if (signal?.aborted)
        throw new DOMException('The upload was cancelled.', 'AbortError')
      return { part_number: part, etag: `etag-${part}`, size: 37 }
    })
    const { app, upload } = mountUpload()
    const pending = upload.selectFile(makeFile(43))
    await waitFor(() => upload.task.value?.status === 'uploading')
    app.unmount()
    releasePart()
    await pending

    expect(requestSignal?.aborted).toBe(true)
    expect(pdfSession.destroy).toHaveBeenCalledTimes(1)
    expect(upload.task.value?.status).toBe('paused')
  })
})
