import type { BlogAsset, BlogMediaUploadPart } from '@/utils/blog-studio'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { inspectMedia } from '@/utils/blog-media'
import { formatBytes } from '@/utils/blog-studio'

export type MediaUploadStatus = 'queued' | 'uploading' | 'paused' | 'complete' | 'error' | 'cancelled'

export interface MediaUploadTask {
  id: string
  uploadId: string
  file: File
  asset: BlogAsset | null
  uploadedBytes: number
  totalBytes: number
  status: MediaUploadStatus
  error: string
  warning: string
  parts: BlogMediaUploadPart[]
  derivedFrom: string[]
}

export interface MediaUploadRecoveryEntry {
  id: string
  uploadId: string
  filename: string
  mime_type: string
  size: number
  lastModified: number
  derivedFrom: string[]
  asset: BlogAsset | null
  parts: BlogMediaUploadPart[]
  status: Extract<MediaUploadStatus, 'paused' | 'error'>
  error: string
  updatedAt: number
}

export const BLOG_MEDIA_PART_SIZE = 10 * 1024 * 1024
export const BLOG_MEDIA_MAX_SOURCE_BYTES = 250 * 1024 * 1024
export const BLOG_MEDIA_MAX_CONCURRENT_PARTS = 2
export const BLOG_MEDIA_UPLOAD_RECOVERY_KEY = 'akmal-blog-media-upload-recovery-v1'

type MediaMetadata = {
  kind: 'image' | 'gif' | 'video'
  width?: number
  height?: number
  duration_ms?: number
}

interface UploadOperation {
  generation: number
  controller: AbortController
  failure?: unknown
}

interface PartWaiter {
  resolve: (release: () => void) => void
  reject: (error: unknown) => void
  signal: AbortSignal
  onAbort: () => void
}

let activePartTransfers = 0
const partWaiters: PartWaiter[] = []

function abortError() {
  return new DOMException('The upload was cancelled.', 'AbortError')
}

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === 'AbortError'
    || reason instanceof Error && reason.name === 'AbortError'
}

function drainPartWaiters() {
  while (activePartTransfers < BLOG_MEDIA_MAX_CONCURRENT_PARTS && partWaiters.length) {
    const waiter = partWaiters.shift()!
    waiter.signal.removeEventListener('abort', waiter.onAbort)
    if (waiter.signal.aborted) {
      waiter.reject(abortError())
      continue
    }
    activePartTransfers++
    let released = false
    waiter.resolve(() => {
      if (released)
        return
      released = true
      activePartTransfers--
      drainPartWaiters()
    })
  }
}

function acquirePartSlot(signal: AbortSignal) {
  if (signal.aborted)
    return Promise.reject(abortError())
  if (activePartTransfers < BLOG_MEDIA_MAX_CONCURRENT_PARTS) {
    activePartTransfers++
    let released = false
    return Promise.resolve(() => {
      if (released)
        return
      released = true
      activePartTransfers--
      drainPartWaiters()
    })
  }
  return new Promise<() => void>((resolve, reject) => {
    const waiter: PartWaiter = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = partWaiters.indexOf(waiter)
        if (index >= 0)
          partWaiters.splice(index, 1)
        reject(abortError())
      },
    }
    signal.addEventListener('abort', waiter.onAbort, { once: true })
    partWaiters.push(waiter)
    drainPartWaiters()
  })
}

export function getMediaPartRanges(size: number) {
  const partCount = Math.ceil(Math.max(0, size) / BLOG_MEDIA_PART_SIZE)
  return Array.from({ length: partCount }, (_, index) => ({
    part_number: index + 1,
    start: index * BLOG_MEDIA_PART_SIZE,
    end: Math.min(size, (index + 1) * BLOG_MEDIA_PART_SIZE),
  }))
}

export function getRecordedMediaBytes(size: number, parts: BlogMediaUploadPart[]) {
  const ranges = new Map(getMediaPartRanges(size).map(range => [range.part_number, range]))
  return [...new Set(parts.map(part => part.part_number))].reduce((total, partNumber) => {
    const range = ranges.get(partNumber)
    return total + (range ? range.end - range.start : 0)
  }, 0)
}

function mergeUploadParts(...partLists: BlogMediaUploadPart[][]) {
  const parts = new Map<number, BlogMediaUploadPart>()
  for (const list of partLists) {
    for (const part of list) {
      if (Number.isInteger(part.part_number) && part.part_number > 0 && typeof part.etag === 'string' && part.etag)
        parts.set(part.part_number, part)
    }
  }
  return [...parts.values()].sort((left, right) => left.part_number - right.part_number)
}

function isMetadataFallbackError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason)
  return /metadata could not be read|cannot read the selected video|video has no readable duration/i.test(message)
}

function fallbackMetadata(file: File, reason: unknown): { metadata: MediaMetadata, warning: string } | null {
  if (!file.type.startsWith('video/') || !isMetadataFallbackError(reason))
    return null
  const detail = reason instanceof Error ? reason.message : 'The browser could not read video metadata.'
  return {
    metadata: { kind: 'video' },
    warning: `${detail} The original will be uploaded for server validation.`,
  }
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback
}

function isRecoveryEntry(value: unknown): value is MediaUploadRecoveryEntry {
  if (!value || typeof value !== 'object')
    return false
  const entry = value as Partial<MediaUploadRecoveryEntry>
  return typeof entry.id === 'string'
    && typeof entry.uploadId === 'string'
    && typeof entry.filename === 'string'
    && typeof entry.mime_type === 'string'
    && Number.isFinite(entry.size)
    && Number.isFinite(entry.lastModified)
    && Array.isArray(entry.derivedFrom)
    && Array.isArray(entry.parts)
    && (entry.status === 'paused' || entry.status === 'error')
}

function readRecoveryEntries(): MediaUploadRecoveryEntry[] {
  if (typeof localStorage === 'undefined')
    return []
  try {
    const raw = localStorage.getItem(BLOG_MEDIA_UPLOAD_RECOVERY_KEY)
    if (!raw)
      return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isRecoveryEntry) : []
  }
  catch {
    return []
  }
}

function sameFile(file: File, entry: MediaUploadRecoveryEntry) {
  return file.name === entry.filename
    && file.size === entry.size
    && (file.type || 'application/octet-stream') === entry.mime_type
    && file.lastModified === entry.lastModified
}

export function useBlogMediaUpload(onComplete?: (asset: BlogAsset) => void) {
  const api = useBlogApi()
  const tasks = ref<MediaUploadTask[]>([])
  const recoverableEntries = ref<MediaUploadRecoveryEntry[]>(readRecoveryEntries())
  const recoverableCount = computed(() => recoverableEntries.value.length)
  const operations = new Map<string, UploadOperation>()
  const generations = new Map<string, number>()

  function writeRecoveryEntries() {
    if (typeof localStorage === 'undefined')
      return
    try {
      if (recoverableEntries.value.length)
        localStorage.setItem(BLOG_MEDIA_UPLOAD_RECOVERY_KEY, JSON.stringify(recoverableEntries.value))
      else
        localStorage.removeItem(BLOG_MEDIA_UPLOAD_RECOVERY_KEY)
    }
    catch {
      // Private recovery is best effort when storage is unavailable or full.
    }
  }

  function removeRecovery(id: string) {
    recoverableEntries.value = recoverableEntries.value.filter(entry => entry.id !== id)
    writeRecoveryEntries()
  }

  function persistTask(task: MediaUploadTask, status = task.status) {
    if (!task.uploadId || status === 'complete' || status === 'cancelled') {
      if (task.uploadId)
        removeRecovery(task.id)
      return
    }
    const entry: MediaUploadRecoveryEntry = {
      id: task.id,
      uploadId: task.uploadId,
      filename: task.file.name,
      mime_type: task.file.type || 'application/octet-stream',
      size: task.file.size,
      lastModified: task.file.lastModified,
      derivedFrom: [...task.derivedFrom],
      asset: task.asset,
      parts: [...task.parts],
      status: status === 'error' ? 'error' : 'paused',
      error: task.error,
      updatedAt: Date.now(),
    }
    const existing = recoverableEntries.value.findIndex(item => item.id === task.id)
    if (existing >= 0)
      recoverableEntries.value[existing] = entry
    else
      recoverableEntries.value.push(entry)
    writeRecoveryEntries()
  }

  function updateTask(id: string, patch: Partial<MediaUploadTask>) {
    const task = tasks.value.find(item => item.id === id)
    if (!task)
      return
    Object.assign(task, patch)
    if (task.status === 'complete' || task.status === 'cancelled')
      removeRecovery(task.id)
  }

  function beginOperation(task: MediaUploadTask) {
    const generation = (generations.get(task.id) ?? 0) + 1
    const operation = { generation, controller: new AbortController() }
    generations.set(task.id, generation)
    operations.set(task.id, operation)
    return operation
  }

  function isCurrent(task: MediaUploadTask, operation: UploadOperation) {
    return operations.get(task.id) === operation
      && generations.get(task.id) === operation.generation
      && !operation.controller.signal.aborted
      && task.status !== 'cancelled'
      && task.status !== 'paused'
  }

  function canUpdate(task: MediaUploadTask, operation: UploadOperation) {
    return operations.get(task.id) === operation
      && generations.get(task.id) === operation.generation
      && task.status !== 'cancelled'
      && task.status !== 'paused'
  }

  function finishOperation(task: MediaUploadTask, operation: UploadOperation) {
    if (operations.get(task.id) === operation)
      operations.delete(task.id)
  }

  async function inspect(file: File): Promise<{ metadata: MediaMetadata, warning: string }> {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/'))
      throw new Error('Select an image, GIF or video file with a supported media type.')
    try {
      return { metadata: await inspectMedia(file, file.type), warning: '' }
    }
    catch (reason: unknown) {
      const fallback = fallbackMetadata(file, reason)
      if (fallback)
        return fallback
      throw reason
    }
  }

  async function completeWithRecovery(task: MediaUploadTask, operation: UploadOperation) {
    try {
      return await api.completeUpload(task.uploadId, task.parts)
    }
    catch (firstReason: unknown) {
      if (!isCurrent(task, operation))
        throw firstReason
      // The first request may have committed before its response was lost. The
      // idempotent completion endpoint makes this retry safe after reconciliation.
      const state = await api.getUpload(task.uploadId)
      if (!isCurrent(task, operation))
        throw firstReason
      task.parts = mergeUploadParts(task.parts, state.upload.parts)
      task.uploadedBytes = getRecordedMediaBytes(task.file.size, task.parts)
      persistTask(task)
      return await api.completeUpload(task.uploadId, task.parts)
    }
  }

  async function runParts(task: MediaUploadTask, recordedParts: BlogMediaUploadPart[], operation: UploadOperation) {
    const recorded = mergeUploadParts(recordedParts)
    const ranges = getMediaPartRanges(task.file.size)
    const pending = ranges.map(range => range.part_number).filter(part => !recorded.some(item => item.part_number === part))
    task.parts = recorded
    task.uploadedBytes = getRecordedMediaBytes(task.file.size, recorded)
    persistTask(task)
    const worker = async () => {
      while (pending.length && isCurrent(task, operation)) {
        const partNumber = pending.shift()
        if (!partNumber)
          return
        const range = ranges[partNumber - 1]
        if (!range)
          throw new Error(`Upload part ${partNumber} is outside the source file.`)
        let release: (() => void) | undefined
        try {
          release = await acquirePartSlot(operation.controller.signal)
          if (!isCurrent(task, operation))
            return
          const response = await api.putUploadPart(task.uploadId, partNumber, task.file.slice(range.start, range.end), operation.controller.signal)
          if (!isCurrent(task, operation))
            return
          if (!response?.etag)
            throw new Error(`Upload part ${partNumber} did not return a server receipt.`)
          task.parts = mergeUploadParts(task.parts, [response])
          task.uploadedBytes = getRecordedMediaBytes(task.file.size, task.parts)
          persistTask(task)
        }
        catch (reason: unknown) {
          if (!isAbortError(reason) && canUpdate(task, operation)) {
            operation.failure = reason
            operation.controller.abort()
          }
          throw reason
        }
        finally {
          release?.()
        }
      }
    }
    await Promise.all(Array.from({ length: BLOG_MEDIA_MAX_CONCURRENT_PARTS }, () => worker()))
  }

  async function upload(file: File, derivedFrom: string[] = []) {
    const task: MediaUploadTask = {
      id: crypto.randomUUID(),
      uploadId: '',
      file,
      asset: null,
      uploadedBytes: 0,
      totalBytes: file.size,
      status: 'queued',
      error: '',
      warning: '',
      parts: [],
      derivedFrom: [...derivedFrom],
    }
    tasks.value.unshift(task)
    const operation = beginOperation(task)
    try {
      if (file.size > BLOG_MEDIA_MAX_SOURCE_BYTES)
        throw new Error('Source exceeds the 250 MiB project limit.')
      const inspected = await inspect(file)
      if (!isCurrent(task, operation))
        return task
      updateTask(task.id, { warning: inspected.warning })
      const started = await api.startUpload({ filename: file.name, mime_type: file.type || 'application/octet-stream', size: file.size, width: inspected.metadata.width, height: inspected.metadata.height, duration_ms: inspected.metadata.duration_ms, derived_from: derivedFrom })
      if (!isCurrent(task, operation)) {
        await api.abortUpload(started.upload.id)
        return task
      }
      updateTask(task.id, { asset: started.asset, uploadId: started.upload.id, parts: [], status: 'uploading', error: '' })
      await runParts(task, started.upload.parts, operation)
      if (!isCurrent(task, operation))
        return task
      const completed = await completeWithRecovery(task, operation)
      if (!isCurrent(task, operation))
        return task
      if (!completed?.asset)
        throw new Error('Upload completion did not return a usable asset.')
      updateTask(task.id, { asset: completed.asset, status: 'complete', uploadedBytes: task.file.size, error: '' })
      onComplete?.(completed.asset)
    }
    catch (reason: unknown) {
      if (canUpdate(task, operation)) {
        updateTask(task.id, { status: 'error', error: errorMessage(operation.failure ?? reason, 'Upload failed.') })
        persistTask(task, 'error')
      }
    }
    finally {
      finishOperation(task, operation)
    }
    return task
  }

  async function cancel(task: MediaUploadTask) {
    if (task.status === 'complete' || task.status === 'cancelled')
      return
    const uploadId = task.uploadId
    const operation = operations.get(task.id)
    operation?.controller.abort()
    if (operation)
      operations.delete(task.id)
    generations.set(task.id, (generations.get(task.id) ?? 0) + 1)
    updateTask(task.id, { status: 'cancelled', error: '' })
    removeRecovery(task.id)
    if (uploadId) {
      try {
        await api.abortUpload(uploadId)
      }
      catch {
        // The local task remains cancelled; a later server cleanup can still remove the upload.
      }
    }
  }

  function pause(task: MediaUploadTask) {
    if (task.status !== 'uploading')
      return
    const operation = operations.get(task.id)
    operation?.controller.abort()
    if (operation)
      operations.delete(task.id)
    generations.set(task.id, (generations.get(task.id) ?? 0) + 1)
    updateTask(task.id, { status: 'paused' })
    persistTask(task, 'paused')
  }

  async function resume(task: MediaUploadTask) {
    if (!task.uploadId || !['paused', 'error'].includes(task.status) || operations.has(task.id))
      return task
    const operation = beginOperation(task)
    updateTask(task.id, { status: 'uploading', error: '' })
    try {
      const state = await api.getUpload(task.uploadId)
      if (!isCurrent(task, operation))
        return task
      task.parts = mergeUploadParts(task.parts, state.upload.parts)
      task.uploadedBytes = getRecordedMediaBytes(task.file.size, task.parts)
      await runParts(task, task.parts, operation)
      if (!isCurrent(task, operation))
        return task
      const completed = await completeWithRecovery(task, operation)
      if (!isCurrent(task, operation))
        return task
      if (!completed?.asset)
        throw new Error('Upload completion did not return a usable asset.')
      updateTask(task.id, { asset: completed.asset, status: 'complete', uploadedBytes: task.file.size, error: '' })
      onComplete?.(completed.asset)
    }
    catch (reason: unknown) {
      if (canUpdate(task, operation)) {
        updateTask(task.id, { status: 'error', error: errorMessage(operation.failure ?? reason, 'Resume failed.') })
        persistTask(task, 'error')
      }
    }
    finally {
      finishOperation(task, operation)
    }
    return task
  }

  function findRecoverableUpload(file: File, entryId?: string) {
    return recoverableEntries.value.find(entry => (!entryId || entry.id === entryId) && sameFile(file, entry)) ?? null
  }

  async function recoverUpload(file: File, entryId?: string) {
    const entry = findRecoverableUpload(file, entryId)
    if (!entry)
      return null
    const task: MediaUploadTask = {
      id: entry.id,
      uploadId: entry.uploadId,
      file,
      asset: entry.asset,
      uploadedBytes: getRecordedMediaBytes(file.size, entry.parts),
      totalBytes: file.size,
      status: 'paused',
      error: entry.error,
      warning: '',
      parts: [...entry.parts],
      derivedFrom: [...entry.derivedFrom],
    }
    tasks.value.unshift(task)
    await resume(task)
    return task
  }

  function persistPendingTasks() {
    for (const task of tasks.value) {
      if (task.status === 'complete' || task.status === 'cancelled')
        continue
      if (task.uploadId)
        persistTask(task, task.status === 'error' ? 'error' : 'paused')
    }
  }

  function progress(task: MediaUploadTask) {
    return task.totalBytes ? Math.round((task.uploadedBytes / task.totalBytes) * 100) : 0
  }

  function progressLabel(task: MediaUploadTask) {
    return `${progress(task)}% · ${formatBytes(task.uploadedBytes)} of ${formatBytes(task.totalBytes)}`
  }

  if (typeof window !== 'undefined')
    window.addEventListener('beforeunload', persistPendingTasks)

  onBeforeUnmount(() => {
    for (const [taskId, operation] of operations) {
      operation.controller.abort()
      operations.delete(taskId)
      generations.set(taskId, (generations.get(taskId) ?? operation.generation) + 1)
      const task = tasks.value.find(item => item.id === taskId)
      if (task?.status === 'uploading')
        task.status = 'paused'
    }
    persistPendingTasks()
    if (typeof window !== 'undefined')
      window.removeEventListener('beforeunload', persistPendingTasks)
  })

  return {
    tasks,
    recoverableEntries,
    recoverableCount,
    upload,
    cancel,
    pause,
    resume,
    findRecoverableUpload,
    recoverUpload,
    progress,
    progressLabel,
  }
}
