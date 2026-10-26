import type { BlogAsset, BlogMediaUploadPart } from '@/utils/blog-studio'
import { useBlogApi } from '@/composables/useBlogApi'
import { formatBytes } from '@/utils/blog-studio'

export interface MediaUploadTask {
  id: string
  uploadId: string
  file: File
  asset: BlogAsset | null
  uploadedBytes: number
  totalBytes: number
  status: 'queued' | 'uploading' | 'paused' | 'complete' | 'error' | 'cancelled'
  error: string
  parts: BlogMediaUploadPart[]
}

export const BLOG_MEDIA_PART_SIZE = 10 * 1024 * 1024
export const BLOG_MEDIA_MAX_SOURCE_BYTES = 250 * 1024 * 1024
export const BLOG_MEDIA_MAX_CONCURRENT_PARTS = 2

export function getMediaPartRanges(size: number) {
  const partCount = Math.ceil(Math.max(0, size) / BLOG_MEDIA_PART_SIZE)
  return Array.from({ length: partCount }, (_, index) => ({
    part_number: index + 1,
    start: index * BLOG_MEDIA_PART_SIZE,
    end: Math.min(size, (index + 1) * BLOG_MEDIA_PART_SIZE),
  }))
}

export function useBlogMediaUpload(onComplete?: (asset: BlogAsset) => void) {
  const api = useBlogApi()
  const tasks = ref<MediaUploadTask[]>([])
  const activeControllers = new Map<string, AbortController>()

  async function inspect(file: File) {
    try {
      const media = await import('@/utils/blog-media')
      return media.inspectMedia(file, file.type)
    }
    catch {
      return { kind: file.type.startsWith('video/') ? 'video' : file.type === 'image/gif' ? 'gif' : 'image', width: undefined, height: undefined, duration_ms: undefined }
    }
  }

  function updateTask(id: string, patch: Partial<MediaUploadTask>) {
    const task = tasks.value.find(item => item.id === id)
    if (task)
      Object.assign(task, patch)
  }

  async function upload(file: File, derivedFrom: string[] = []) {
    const task: MediaUploadTask = { id: crypto.randomUUID(), uploadId: '', file, asset: null, uploadedBytes: 0, totalBytes: file.size, status: 'queued', error: '', parts: [] }
    tasks.value.unshift(task)
    const metadata = await inspect(file)
    if (file.size > BLOG_MEDIA_MAX_SOURCE_BYTES) {
      updateTask(task.id, { status: 'error', error: 'Source exceeds the 250 MiB project limit.' })
      return task
    }
    if ((task.status as string) === 'cancelled')
      return task
    try {
      const started = await api.startUpload({ filename: file.name, mime_type: file.type || 'application/octet-stream', size: file.size, width: metadata.width, height: metadata.height, duration_ms: metadata.duration_ms, derived_from: derivedFrom })
      if ((task.status as string) === 'cancelled') {
        await api.abortUpload(started.upload.id)
        return task
      }
      updateTask(task.id, { asset: started.asset, uploadId: started.upload.id, parts: started.upload.parts, status: 'uploading' })
      await runParts(task, started.upload.parts)
      if ((task.status as string) === 'cancelled' || task.status === 'paused')
        return task
      const completed = await api.completeUpload(started.upload.id, task.parts)
      updateTask(task.id, { asset: completed.asset, status: 'complete', uploadedBytes: file.size })
      onComplete?.(completed.asset)
    }
    catch (reason: unknown) {
      if ((task.status as string) !== 'cancelled' && task.status !== 'paused')
        updateTask(task.id, { status: 'error', error: reason instanceof Error ? reason.message : 'Upload failed.' })
    }
    return task
  }

  async function runParts(task: MediaUploadTask, recordedParts: BlogMediaUploadPart[]) {
    if (!task.asset)
      return
    const uploadId = task.uploadId
    const recorded = new Map(recordedParts.map(part => [part.part_number, part]))
    const ranges = getMediaPartRanges(task.file.size)
    const pending = ranges.map(range => range.part_number).filter(part => !recorded.has(part))
    task.parts = [...recorded.values()]
    task.uploadedBytes = Math.min(task.file.size, recorded.size * BLOG_MEDIA_PART_SIZE)
    const taskController = new AbortController()
    activeControllers.set(task.id, taskController)
    const worker = async () => {
      while (pending.length && task.status === 'uploading') {
        const part = pending.shift()
        if (!part)
          return
        const start = (part - 1) * BLOG_MEDIA_PART_SIZE
        const end = Math.min(task.file.size, start + BLOG_MEDIA_PART_SIZE)
        const response = await api.putUploadPart(uploadId, part, task.file.slice(start, end), taskController.signal)
        task.parts.push(response)
        task.uploadedBytes = Math.min(task.file.size, task.uploadedBytes + (end - start))
      }
    }
    try {
      await Promise.all(Array.from({ length: BLOG_MEDIA_MAX_CONCURRENT_PARTS }, () => worker()))
    }
    finally {
      activeControllers.delete(task.id)
    }
  }

  async function cancel(task: MediaUploadTask) {
    activeControllers.get(task.id)?.abort()
    task.status = 'cancelled'
    if (!task.asset)
      return
    try {
      await api.abortUpload(task.uploadId)
    }
    catch {
      // A cancelled upload can still be reconciled from the server state.
    }
  }

  async function pause(task: MediaUploadTask) {
    activeControllers.get(task.id)?.abort()
    task.status = 'paused'
  }

  async function resume(task: MediaUploadTask) {
    if (!task.asset || task.status !== 'paused')
      return
    try {
      const state = await api.getUpload(task.uploadId)
      task.parts = state.upload.parts
      task.status = 'uploading'
      await runParts(task, state.upload.parts)
      if (task.status === 'uploading') {
        const completed = await api.completeUpload(task.uploadId, task.parts)
        updateTask(task.id, { asset: completed.asset, status: 'complete', uploadedBytes: task.file.size })
        onComplete?.(completed.asset)
      }
    }
    catch (reason: unknown) {
      updateTask(task.id, { status: 'error', error: reason instanceof Error ? reason.message : 'Resume failed.' })
    }
  }

  function progress(task: MediaUploadTask) {
    return task.totalBytes ? Math.round((task.uploadedBytes / task.totalBytes) * 100) : 0
  }

  function progressLabel(task: MediaUploadTask) {
    return `${progress(task)}% · ${formatBytes(task.uploadedBytes)} of ${formatBytes(task.totalBytes)}`
  }

  onBeforeUnmount(() => {
    for (const controller of activeControllers.values())
      controller.abort()
  })

  return { tasks, upload, cancel, pause, resume, progress, progressLabel }
}
