import type { Ref } from 'vue'
import type { GalleryManifest, GalleryUploadPart } from '@/utils/content-calendar'
import type { GalleryPdfDocumentSession } from '@/utils/gallery-pdf-renderer'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { formatBytes } from '@/utils/blog-studio'
import { GALLERY_MAX_CONCURRENT_PARTS, GALLERY_SOURCE_MAX_BYTES, GALLERY_SOURCE_PART_SIZE, validateGalleryPageCount } from '@/utils/content-calendar'
import { openGalleryPdfDocument } from '@/utils/gallery-pdf-renderer'

export type GalleryPdfUploadStatus = 'idle' | 'uploading' | 'paused' | 'complete' | 'error' | 'cancelled'

export interface GalleryPdfUploadTask {
  galleryId: string
  uploadId: string
  file: File
  filename: string
  size: number
  uploadedBytes: number
  status: GalleryPdfUploadStatus
  error: string
  parts: GalleryUploadPart[]
  pageCount: number | null
  gallery: GalleryManifest | null
  document: GalleryPdfDocumentSession | null
}

export interface GalleryPdfRecoveryEntry {
  galleryId: string
  uploadId: string
  filename: string
  mime_type: string
  size: number
  lastModified: number
  parts: GalleryUploadPart[]
  status: Extract<GalleryPdfUploadStatus, 'paused' | 'error'>
  error: string
  updatedAt: number
}

export const GALLERY_PDF_RECOVERY_KEY = 'akmal-blog-gallery-pdf-recovery-v1'
export const GALLERY_PDF_MIME_TYPE = 'application/pdf'

export function getGalleryPdfPartRanges(size: number) {
  const partCount = Math.ceil(Math.max(0, size) / GALLERY_SOURCE_PART_SIZE)
  return Array.from({ length: partCount }, (_, index) => ({
    part_number: index + 1,
    start: index * GALLERY_SOURCE_PART_SIZE,
    end: Math.min(size, (index + 1) * GALLERY_SOURCE_PART_SIZE),
  }))
}

export function getRecordedGalleryPdfBytes(size: number, parts: readonly GalleryUploadPart[]) {
  const ranges = new Map(getGalleryPdfPartRanges(size).map(range => [range.part_number, range]))
  return [...new Set(parts.map(part => part.part_number))].reduce((total, partNumber) => {
    const range = ranges.get(partNumber)
    return total + (range ? range.end - range.start : 0)
  }, 0)
}

function abortError() {
  return typeof DOMException === 'undefined' ? new Error('The upload was cancelled.') : new DOMException('The upload was cancelled.', 'AbortError')
}

function isAbortError(reason: unknown) {
  return (typeof DOMException !== 'undefined' && reason instanceof DOMException && reason.name === 'AbortError')
    || (reason instanceof Error && reason.name === 'AbortError')
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function mergeParts(...lists: readonly GalleryUploadPart[][]) {
  const parts = new Map<number, GalleryUploadPart>()
  for (const list of lists) {
    for (const part of list) {
      if (Number.isInteger(part.part_number) && part.part_number > 0 && typeof part.etag === 'string' && part.etag)
        parts.set(part.part_number, part)
    }
  }
  return [...parts.values()].sort((left, right) => left.part_number - right.part_number)
}

function readRecoveryEntries(): GalleryPdfRecoveryEntry[] {
  if (typeof localStorage === 'undefined')
    return []
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GALLERY_PDF_RECOVERY_KEY) || '[]')
    if (!Array.isArray(value))
      return []
    return value.filter((entry): entry is GalleryPdfRecoveryEntry => {
      if (!entry || typeof entry !== 'object')
        return false
      const candidate = entry as Partial<GalleryPdfRecoveryEntry>
      return typeof candidate.galleryId === 'string'
        && typeof candidate.uploadId === 'string'
        && typeof candidate.filename === 'string'
        && typeof candidate.mime_type === 'string'
        && Number.isFinite(candidate.size)
        && Number.isFinite(candidate.lastModified)
        && Array.isArray(candidate.parts)
        && (candidate.status === 'paused' || candidate.status === 'error')
    })
  }
  catch {
    return []
  }
}

function fileMatches(file: File, entry: GalleryPdfRecoveryEntry) {
  let sameFilename = false
  try {
    sameFilename = normalizeGalleryPdfFilename(file.name) === normalizeGalleryPdfFilename(entry.filename)
  }
  catch {
    return false
  }
  return sameFilename
    && file.size === entry.size
    && file.lastModified === entry.lastModified
    // Older recovery records may have captured an empty or octet-stream MIME
    // from the browser. The PDF header is validated before this match, and
    // the source API always receives the canonical PDF MIME below.
    && (entry.mime_type === GALLERY_PDF_MIME_TYPE || entry.mime_type === file.type || entry.mime_type === 'application/octet-stream' || !entry.mime_type)
}

export function normalizeGalleryPdfMimeType(_file: File) {
  return GALLERY_PDF_MIME_TYPE
}

/** Match the server's bounded source filename normalization before comparing a reloaded file. */
export function normalizeGalleryPdfFilename(value: string) {
  const name = value.trim()
  if (!name)
    throw new Error('filename is required')
  if (name.length > 240)
    throw new Error('filename is too long')
  const basename = name.replace(/.*[\\/]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!basename || basename === '.' || basename === '..')
    throw new Error('filename is invalid')
  return basename
}

export function validateGalleryPdf(file: File) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))
    throw new Error('Select a PDF file.')
  if (file.size <= 0)
    throw new Error('The PDF is empty.')
  if (file.size > GALLERY_SOURCE_MAX_BYTES)
    throw new Error(`The PDF is larger than the ${formatBytes(GALLERY_SOURCE_MAX_BYTES)} limit.`)
}

export function isPdfHeader(value: string | Uint8Array) {
  const header = typeof value === 'string' ? value : new TextDecoder().decode(value)
  return header.startsWith('%PDF-')
}

export function useGalleryPdfUpload(galleryId: Readonly<Ref<string>>, galleryVersion: Readonly<Ref<number>>, onComplete?: (gallery: GalleryManifest) => void) {
  const api = useBlogApi()
  const task = ref<GalleryPdfUploadTask | null>(null)
  const recoverableEntries = ref<GalleryPdfRecoveryEntry[]>(readRecoveryEntries())
  const recoverable = computed(() => recoverableEntries.value.filter(entry => entry.galleryId === galleryId.value))
  const progress = computed(() => task.value ? Math.round((task.value.uploadedBytes / task.value.size) * 100) : 0)
  const operations = new Map<string, AbortController>()
  const runPromises = new Map<string, Promise<void>>()
  const queuedRetries = new Map<string, Promise<void>>()
  let disposed = false
  let selectionGeneration = 0
  let selectionController: AbortController | null = null

  function writeRecoveryEntries() {
    if (typeof localStorage === 'undefined')
      return
    try {
      if (recoverableEntries.value.length)
        localStorage.setItem(GALLERY_PDF_RECOVERY_KEY, JSON.stringify(recoverableEntries.value))
      else
        localStorage.removeItem(GALLERY_PDF_RECOVERY_KEY)
    }
    catch {
      // Reload recovery is best effort when browser storage is unavailable.
    }
  }

  function removeRecovery(uploadId: string) {
    recoverableEntries.value = recoverableEntries.value.filter(entry => entry.uploadId !== uploadId)
    writeRecoveryEntries()
  }

  function persistRecovery(current: GalleryPdfUploadTask, status: 'paused' | 'error' = current.status === 'error' ? 'error' : 'paused') {
    if (!current.uploadId)
      return
    const entry: GalleryPdfRecoveryEntry = {
      galleryId: current.galleryId,
      uploadId: current.uploadId,
      filename: current.filename,
      mime_type: normalizeGalleryPdfMimeType(current.file),
      size: current.size,
      lastModified: current.file.lastModified,
      parts: [...current.parts],
      status,
      error: current.error,
      updatedAt: Date.now(),
    }
    const index = recoverableEntries.value.findIndex(item => item.uploadId === current.uploadId)
    if (index >= 0)
      recoverableEntries.value[index] = entry
    else
      recoverableEntries.value.push(entry)
    writeRecoveryEntries()
  }

  function ensureSelectionActive(generation: number, signal: AbortSignal) {
    if (disposed || generation !== selectionGeneration || signal.aborted)
      throw abortError()
  }

  async function createUpload(file: File, pageCount: number, generation: number, signal: AbortSignal) {
    // A reload can lose the in-memory task while the server still owns an
    // active or completed source. Reuse that source instead of starting a
    // second multipart object; matching name and size keeps a different file
    // from being attached to the immutable source metadata.
    const existingGallery = await api.getGallery(galleryId.value)
    ensureSelectionActive(generation, signal)
    const existingSource = existingGallery.source
    if (existingSource && existingSource.status !== 'aborted') {
      const existingFilename = typeof existingSource.filename === 'string' ? normalizeGalleryPdfFilename(existingSource.filename) : ''
      if (existingFilename !== normalizeGalleryPdfFilename(file.name) || existingSource.size !== file.size)
        throw new Error('This gallery already has a different source PDF. Select that file to resume its upload.')
      const existingUpload = await api.getGallerySourceUpload(galleryId.value, existingSource.id)
      ensureSelectionActive(generation, signal)
      return existingUpload.upload
    }
    const response = await api.startGallerySourceUpload(galleryId.value, { version: galleryVersion.value, filename: file.name, mime_type: normalizeGalleryPdfMimeType(file), size: file.size, page_count: pageCount })
    ensureSelectionActive(generation, signal)
    if (response.upload?.id)
      return response.upload
    if (response.source?.id) {
      const startedUpload = await api.getGallerySourceUpload(galleryId.value, response.source.id)
      ensureSelectionActive(generation, signal)
      return startedUpload.upload
    }
    throw new Error('The server did not return a gallery source upload.')
  }

  async function run(current: GalleryPdfUploadTask, recordedParts: GalleryUploadPart[] = [], generation = selectionGeneration) {
    const controller = new AbortController()
    operations.set(current.uploadId, controller)
    current.status = 'uploading'
    current.error = ''
    const ensureRunActive = () => {
      if (disposed || generation !== selectionGeneration || task.value !== current || controller.signal.aborted)
        throw abortError()
    }
    try {
      const state = await api.getGallerySourceUpload(current.galleryId, current.uploadId)
      ensureRunActive()
      current.parts = mergeParts(recordedParts, state.upload.parts)
      current.uploadedBytes = getRecordedGalleryPdfBytes(current.size, current.parts)
      persistRecovery(current)
      const ranges = getGalleryPdfPartRanges(current.size)
      const pending = ranges.filter(range => !current.parts.some(part => part.part_number === range.part_number))
      let nextIndex = 0
      const worker = async () => {
        while (nextIndex < pending.length) {
          if (controller.signal.aborted)
            throw abortError()
          const range = pending[nextIndex++]
          if (!range)
            return
          const response = await api.putGallerySourcePart(current.galleryId, current.uploadId, range.part_number, current.file.slice(range.start, range.end), controller.signal)
          if (!response?.etag)
            throw new Error(`Upload part ${range.part_number} did not return a receipt.`)
          current.parts = mergeParts(current.parts, [{ part_number: response.part_number, etag: response.etag, size: range.end - range.start }])
          current.uploadedBytes = getRecordedGalleryPdfBytes(current.size, current.parts)
          persistRecovery(current)
        }
      }
      await Promise.all(Array.from({ length: Math.min(GALLERY_MAX_CONCURRENT_PARTS, Math.max(1, pending.length)) }, () => worker()))
      ensureRunActive()
      if (state.upload.status !== 'completed' && state.source.status !== 'completed')
        await api.completeGallerySourceUpload(current.galleryId, current.uploadId, current.parts, controller.signal)
      ensureRunActive()
      const updated = await api.getGallery(current.galleryId)
      ensureRunActive()
      const pageCount = validateGalleryPageCount(updated.page_count)
      current.gallery = updated
      current.pageCount = pageCount
      current.uploadedBytes = current.size
      current.status = 'complete'
      removeRecovery(current.uploadId)
      if (!disposed && generation === selectionGeneration && task.value === current)
        onComplete?.(updated)
    }
    catch (reason: unknown) {
      if (isAbortError(reason) || controller.signal.aborted) {
        current.status = 'paused'
        persistRecovery(current)
      }
      else {
        current.status = 'error'
        current.error = errorMessage(reason, 'The PDF upload failed.')
        persistRecovery(current, 'error')
      }
      throw reason
    }
    finally {
      if (operations.get(current.uploadId) === controller)
        operations.delete(current.uploadId)
    }
  }

  function scheduleRun(current: GalleryPdfUploadTask, recordedParts: GalleryUploadPart[] = [], generation = selectionGeneration) {
    const previous = runPromises.get(current.uploadId)
    if (!previous) {
      const next = run(current, recordedParts, generation)
      runPromises.set(current.uploadId, next)
      next.finally(() => {
        if (runPromises.get(current.uploadId) === next)
          runPromises.delete(current.uploadId)
      }).catch(() => undefined)
      return next
    }
    const queued = queuedRetries.get(current.uploadId)
    if (queued)
      return queued
    const next = previous.catch(() => undefined).then(() => {
      if (disposed || generation !== selectionGeneration || task.value !== current)
        throw abortError()
      return run(current, current.parts, generation)
    })
    queuedRetries.set(current.uploadId, next)
    runPromises.set(current.uploadId, next)
    next.finally(() => {
      if (runPromises.get(current.uploadId) === next)
        runPromises.delete(current.uploadId)
      if (queuedRetries.get(current.uploadId) === next)
        queuedRetries.delete(current.uploadId)
    }).catch(() => undefined)
    return next
  }

  async function selectFile(file: File) {
    validateGalleryPdf(file)
    if (disposed)
      throw abortError()
    selectionController?.abort()
    const initController = new AbortController()
    selectionController = initController
    const generation = ++selectionGeneration
    try {
      const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
      ensureSelectionActive(generation, initController.signal)
      if (!isPdfHeader(header))
        throw new Error('The selected file does not have a valid PDF header.')
      if (galleryId.value === '')
        throw new Error('Create the gallery before uploading its PDF.')
      if (task.value?.status === 'uploading')
        cancel()
      await task.value?.document?.destroy()
      ensureSelectionActive(generation, initController.signal)
      const document = await openGalleryPdfDocument(file, initController.signal)
      let pageCount: number
      try {
        ensureSelectionActive(generation, initController.signal)
        pageCount = validateGalleryPageCount(document.pageCount)
      }
      catch (reason) {
        await document.destroy()
        throw reason
      }
      const recovery = recoverable.value.find(entry => fileMatches(file, entry))
      let upload: { id: string, parts: GalleryUploadPart[] }
      try {
        upload = recovery
          ? { id: recovery.uploadId, parts: recovery.parts }
          : await createUpload(file, pageCount, generation, initController.signal)
        ensureSelectionActive(generation, initController.signal)
      }
      catch (reason) {
        await document.destroy()
        throw reason
      }
      const current: GalleryPdfUploadTask = {
        galleryId: galleryId.value,
        uploadId: upload.id,
        file,
        filename: file.name,
        size: file.size,
        uploadedBytes: getRecordedGalleryPdfBytes(file.size, upload.parts),
        status: 'idle',
        error: '',
        parts: upload.parts,
        pageCount,
        gallery: null,
        document,
      }
      ensureSelectionActive(generation, initController.signal)
      task.value = current
      try {
        await scheduleRun(task.value, upload.parts, generation)
      }
      catch {
        // The task exposes its failure state to the form; callers can retry.
      }
    }
    finally {
      if (selectionController === initController)
        selectionController = null
    }
  }

  async function retry() {
    if (!task.value || task.value.status === 'uploading')
      return
    await scheduleRun(task.value, task.value.parts, selectionGeneration).catch(() => undefined)
  }

  function cancel() {
    if (!task.value)
      return
    const controller = operations.get(task.value.uploadId)
    controller?.abort()
    task.value.status = 'paused'
    persistRecovery(task.value)
  }

  function clear() {
    selectionGeneration += 1
    selectionController?.abort()
    selectionController = null
    if (task.value?.status === 'uploading')
      cancel()
    void task.value?.document?.destroy()
    task.value = null
  }

  onBeforeUnmount(() => {
    disposed = true
    selectionGeneration += 1
    selectionController?.abort()
    if (task.value?.status === 'uploading') {
      task.value.status = 'paused'
      persistRecovery(task.value)
    }
    for (const controller of operations.values())
      controller.abort()
    void task.value?.document?.destroy()
  })

  return { task, progress, recoverable, recoverableEntries: recoverable, selectFile, retry, cancel, clear, validate: validateGalleryPdf }
}
