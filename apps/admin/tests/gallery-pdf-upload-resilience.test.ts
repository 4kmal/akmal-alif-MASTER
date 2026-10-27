// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, defineComponent, h, ref } from 'vue'
import { GALLERY_SOURCE_PART_SIZE, normalizeGalleryPdfFilename, useGalleryPdfUpload } from '../app/composables/useGalleryPdfUpload'

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

function makeFile(lastModified = 42, name = 'source.pdf') {
  return new File([`%PDF-${'x'.repeat(32)}`], name, { type: 'application/pdf', lastModified })
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

function mountUpload(onComplete?: (gallery: ReturnType<typeof makeGallery>) => void) {
  let upload!: ReturnType<typeof useGalleryPdfUpload>
  const app = createApp(defineComponent({
    setup() {
      upload = useGalleryPdfUpload(ref('gallery-id'), ref(1), onComplete)
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
  it('uses the server filename normalization when reusing a completed source', async () => {
    sourceStatus = 'completed'
    recordedParts = [{ part_number: 1, etag: 'etag-1', size: 37 }]
    api.getGallery
      .mockImplementationOnce(async () => makeGallery({ id: 'source-id', filename: 'The-Art-of-Anthem.pdf', mime_type: 'application/pdf', size: 37, status: 'completed' }))
      .mockImplementation(async () => makeGallery({ id: 'source-id', filename: 'The-Art-of-Anthem.pdf', mime_type: 'application/pdf', size: 37, status: 'completed' }))

    const { app, upload } = mountUpload()
    await upload.selectFile(makeFile(42, 'The Art of Anthem.pdf'))

    expect(normalizeGalleryPdfFilename(' The Art of Anthem.pdf ')).toBe('The-Art-of-Anthem.pdf')
    expect(api.startGallerySourceUpload).not.toHaveBeenCalled()
    expect(api.putGallerySourcePart).not.toHaveBeenCalled()
    expect(api.completeGallerySourceUpload).not.toHaveBeenCalled()
    expect(upload.task.value?.status).toBe('complete')
    app.unmount()
  })

  it('updates reactive progress and releases the rendering lock after the initial upload', async () => {
    let releasePart!: () => void
    api.putGallerySourcePart.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releasePart = resolve
      })
      return { part_number: 1, etag: 'etag-1', size: 37 }
    })
    const { app, upload } = mountUpload()
    const uploading = computed(() => upload.task.value?.status === 'uploading')
    const pending = upload.selectFile(makeFile())
    await waitFor(() => upload.task.value?.status === 'uploading')
    expect(uploading.value).toBe(true)
    expect(upload.progress.value).toBe(0)
    releasePart()
    await pending

    expect(uploading.value).toBe(false)
    expect(upload.progress.value).toBe(100)
    expect(upload.task.value?.status).toBe('complete')
    app.unmount()
  })

  it('serializes a retry requested immediately after pause', async () => {
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
    upload.cancel()
    const retry = upload.retry()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api.getGallerySourceUpload).toHaveBeenCalledTimes(1)
    releasePart()
    await pending
    await retry

    expect(upload.task.value?.status).toBe('complete')
    expect(api.completeGallerySourceUpload).toHaveBeenCalledTimes(1)
    app.unmount()
  })

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

  it('does not start a source upload when PDF initialization is cancelled', async () => {
    let openSignal: AbortSignal | undefined
    renderer.openGalleryPdfDocument.mockImplementationOnce(async (_file: File, signal?: AbortSignal) => {
      openSignal = signal
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', resolve, { once: true })
      })
      throw new DOMException('The upload was cancelled.', 'AbortError')
    })
    const { app, upload } = mountUpload()
    const pending = upload.selectFile(makeFile())
    await waitFor(() => Boolean(openSignal))
    app.unmount()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    expect(openSignal?.aborted).toBe(true)
    expect(api.startGallerySourceUpload).not.toHaveBeenCalled()
    expect(api.putGallerySourcePart).not.toHaveBeenCalled()
  })

  it('does not start a source upload when source initialization becomes stale', async () => {
    let releaseGallery!: (value: ReturnType<typeof makeGallery>) => void
    api.getGallery.mockImplementationOnce(() => new Promise((resolve) => {
      releaseGallery = resolve
    }))
    const { app, upload } = mountUpload()
    const pending = upload.selectFile(makeFile())
    await waitFor(() => api.getGallery.mock.calls.length === 1)
    app.unmount()
    releaseGallery(makeGallery())
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    expect(api.startGallerySourceUpload).not.toHaveBeenCalled()
    expect(pdfSession.destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps a cancelled final manifest read paused and does not call completion', async () => {
    let releaseFinalGallery!: (value: ReturnType<typeof makeGallery>) => void
    api.getGallery
      .mockImplementationOnce(async () => makeGallery())
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFinalGallery = resolve
      }))
    const onComplete = vi.fn()
    const { app, upload } = mountUpload(onComplete)
    const pending = upload.selectFile(makeFile())
    await waitFor(() => api.getGallery.mock.calls.length === 2)
    app.unmount()
    releaseFinalGallery(makeGallery({ id: 'source-id', filename: 'source.pdf', mime_type: 'application/pdf', size: 37, status: 'completed' }))
    await pending

    expect(upload.task.value?.status).toBe('paused')
    expect(onComplete).not.toHaveBeenCalled()
  })
})
