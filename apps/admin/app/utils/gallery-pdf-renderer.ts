export interface RenderedGalleryPage {
  pageNumber: number
  width: number
  height: number
  blob: Blob
}

export interface GalleryPdfRenderOptions {
  pageNumber: number
  thumbnail?: boolean
  signal?: AbortSignal
}

export interface GalleryPdfDocumentSession {
  readonly pageCount: number
  renderPage: (options: GalleryPdfRenderOptions) => Promise<RenderedGalleryPage>
  renderPagePair: (pageNumber: number, signal?: AbortSignal) => Promise<{ full: RenderedGalleryPage, thumbnail: RenderedGalleryPage }>
  destroy: () => Promise<void>
}

export function getNativeGalleryViewportSize(width: number, height: number, thumbnail = false) {
  const safeWidth = Math.max(1, Math.ceil(width))
  const safeHeight = Math.max(1, Math.ceil(height))
  if (!thumbnail)
    return { width: safeWidth, height: safeHeight, scale: 1 }
  const scale = Math.min(1, 320 / Math.max(safeWidth, safeHeight))
  return { width: Math.ceil(safeWidth * scale), height: Math.ceil(safeHeight * scale), scale }
}

export function getPendingGalleryPageNumbers(pages: readonly { page_number?: number, original_page?: number, status?: string, image_asset_id?: string | null, asset_id?: string | null, thumbnail_asset_id?: string | null }[]) {
  return pages
    .filter(page => (page.status !== 'complete' && page.status !== 'ready') || (!(page.image_asset_id || page.asset_id) || !page.thumbnail_asset_id))
    .map(page => page.page_number ?? page.original_page ?? 0)
    .filter(pageNumber => pageNumber > 0)
}

function cancelledError() {
  return typeof DOMException === 'undefined' ? new Error('Rendering was cancelled.') : new DOMException('Rendering was cancelled.', 'AbortError')
}

function isCancelled(signal?: AbortSignal) {
  return Boolean(signal?.aborted)
}

async function renderProxyPage(page: any, pageNumber: number, thumbnail: boolean, signal?: AbortSignal): Promise<RenderedGalleryPage> {
  if (isCancelled(signal))
    throw cancelledError()
  const nativeViewport = page.getViewport({ scale: 1 })
  const size = getNativeGalleryViewportSize(nativeViewport.width, nativeViewport.height, thumbnail)
  const viewport = page.getViewport({ scale: size.scale })
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size.width, size.height)
    : Object.assign(globalThis.document.createElement('canvas'), { width: size.width, height: size.height })
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('The browser could not create a PDF canvas.')
  let renderTask: { promise: Promise<unknown>, cancel: () => void } | null = null
  const cancelRender = () => renderTask?.cancel()
  signal?.addEventListener('abort', cancelRender, { once: true })
  try {
    renderTask = page.render({ canvasContext: context, viewport }) as unknown as { promise: Promise<unknown>, cancel: () => void }
    await renderTask.promise
    if (isCancelled(signal))
      throw cancelledError()
    const blob = 'convertToBlob' in canvas
      ? await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/webp', quality: 0.86 })
      : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob(value => value ? resolve(value) : reject(new Error('The browser could not encode the PDF page.')), 'image/webp', 0.86))
    return { pageNumber, width: size.width, height: size.height, blob }
  }
  catch (reason: unknown) {
    if (isCancelled(signal))
      throw cancelledError()
    throw reason
  }
  finally {
    signal?.removeEventListener('abort', cancelRender)
    if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

/** Open one PDF.js document for an import and render pages from that session. */
export async function openGalleryPdfDocument(source: Blob | ArrayBuffer, signal?: AbortSignal): Promise<GalleryPdfDocumentSession> {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
  if (isCancelled(signal))
    throw cancelledError()
  pdfjs.GlobalWorkerOptions.workerSrc = '/admin/pdfjs/pdf.worker.mjs'
  const data = source instanceof Blob ? await source.arrayBuffer() : source
  if (isCancelled(signal))
    throw cancelledError()
  const loadingTask = pdfjs.getDocument({ data })
  let loadingTaskDestroyPromise: Promise<void> | null = null
  const destroyLoadingTask = async () => {
    if (loadingTaskDestroyPromise) {
      await loadingTaskDestroyPromise
      return
    }
    loadingTaskDestroyPromise = Promise.resolve().then(() => loadingTask.destroy?.()).then(() => undefined).catch(() => undefined)
    await loadingTaskDestroyPromise
  }
  const cancelLoadingTask = () => {
    void destroyLoadingTask()
  }
  signal?.addEventListener('abort', cancelLoadingTask, { once: true })
  let pdfDocument: Awaited<typeof loadingTask.promise>
  try {
    pdfDocument = await loadingTask.promise
  }
  catch (reason) {
    signal?.removeEventListener('abort', cancelLoadingTask)
    await destroyLoadingTask()
    if (isCancelled(signal))
      throw cancelledError()
    throw reason
  }
  signal?.removeEventListener('abort', cancelLoadingTask)
  if (isCancelled(signal)) {
    await destroyLoadingTask()
    throw cancelledError()
  }
  let destroyed = false

  async function getPage(pageNumber: number) {
    if (destroyed)
      throw new Error('The PDF rendering session has ended.')
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdfDocument.numPages)
      throw new Error(`Page ${pageNumber} is outside this PDF.`)
    return pdfDocument.getPage(pageNumber)
  }

  return {
    pageCount: pdfDocument.numPages,
    async renderPage(options) {
      const page = await getPage(options.pageNumber)
      try {
        return await renderProxyPage(page, options.pageNumber, Boolean(options.thumbnail), options.signal)
      }
      finally {
        ;(page as { cleanup?: () => void }).cleanup?.()
      }
    },
    async renderPagePair(pageNumber, signal) {
      const page = await getPage(pageNumber)
      try {
        const full = await renderProxyPage(page, pageNumber, false, signal)
        const thumbnail = await renderProxyPage(page, pageNumber, true, signal)
        return { full, thumbnail }
      }
      finally {
        ;(page as { cleanup?: () => void }).cleanup?.()
      }
    },
    async destroy() {
      if (destroyed)
        return
      destroyed = true
      try {
        await (pdfDocument as { cleanup?: () => Promise<void> | void }).cleanup?.()
      }
      catch {
        // Cleanup is best effort and must not replace an import or render error.
      }
      try {
        if (typeof loadingTask.destroy === 'function')
          await destroyLoadingTask()
        else
          await (pdfDocument as { destroy?: () => Promise<void> | void }).destroy?.()
      }
      catch {
        // PDF.js may already have torn down the worker after a cancellation.
      }
    },
  }
}

export async function getGalleryPdfPageCount(source: Blob | ArrayBuffer) {
  const session = await openGalleryPdfDocument(source)
  try {
    return session.pageCount
  }
  finally {
    await session.destroy()
  }
}

/** One-page convenience wrapper for callers that do not need a multi-page session. */
export async function renderGalleryPdfPage(source: Blob | ArrayBuffer, options: GalleryPdfRenderOptions): Promise<RenderedGalleryPage> {
  const session = await openGalleryPdfDocument(source)
  try {
    return await session.renderPage(options)
  }
  finally {
    await session.destroy()
  }
}
