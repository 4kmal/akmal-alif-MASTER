// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BLOG_MEDIA_PART_SIZE,
  BLOG_MEDIA_UPLOAD_RECOVERY_KEY,
  useBlogMediaUpload,
} from '../app/composables/useBlogMediaUpload'

const api = vi.hoisted(() => ({
  startUpload: vi.fn(),
  getUpload: vi.fn(),
  putUploadPart: vi.fn(),
  completeUpload: vi.fn(),
  abortUpload: vi.fn(),
}))

vi.mock('../app/composables/useBlogApi', () => ({
  useBlogApi: () => api,
}))

vi.mock('@/utils/blog-media', () => ({
  inspectMedia: vi.fn(async (file: File) => ({
    kind: file.type === 'image/gif' ? 'gif' : file.type.startsWith('video/') ? 'video' : 'image',
    width: 640,
    height: 360,
    duration_ms: file.type.startsWith('video/') ? 1000 : 0,
  })),
}))

vi.mock('../app/composables/useBlogLegacyConversion', () => ({
  convertLegacyHtmlToTiptap: (html: string) => ({
    originalHtml: html,
    document: { type: 'doc', content: [] },
    issues: [],
  }),
}))

const storage = new Map<string, string>()

function installStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
}

function makeAsset(id: string, file: File) {
  return {
    id,
    name: file.name,
    mime_type: file.type,
    kind: file.type === 'image/gif' ? 'gif' : file.type.startsWith('video/') ? 'video' : 'image',
    size: file.size,
    width: 640,
    height: 360,
    duration_ms: file.type.startsWith('video/') ? 1000 : 0,
    url: `/media/${id}`,
    source_url: `/media/blog/${id}`,
    created_at: '2026-10-27T00:00:00.000Z',
  }
}

function makeFile(name: string, size = BLOG_MEDIA_PART_SIZE * 2 + 17, lastModified = 1234) {
  return new File([new Uint8Array(size)], name, { type: 'image/png', lastModified })
}

function installUploadApi() {
  let uploadNumber = 0
  api.startUpload.mockImplementation(async (payload: { filename: string, size: number }) => {
    uploadNumber++
    const file = makeFile(payload.filename, payload.size)
    const id = `upload-${uploadNumber}`
    return {
      asset: makeAsset(`asset-${uploadNumber}`, file),
      upload: { id, part_size: BLOG_MEDIA_PART_SIZE, parts: [] },
    }
  })
  api.getUpload.mockImplementation(async (id: string) => ({
    upload: { id, part_size: BLOG_MEDIA_PART_SIZE, parts: [] },
  }))
  api.putUploadPart.mockImplementation(async (_id: string, part: number) => ({
    part_number: part,
    etag: `etag-${part}`,
  }))
  api.completeUpload.mockImplementation(async (_id: string) => ({
    asset: {
      id: 'completed-asset',
      name: 'complete.png',
      mime_type: 'image/png',
      kind: 'image',
      size: BLOG_MEDIA_PART_SIZE * 2 + 17,
      url: '/media/completed-asset',
      source_url: '/media/blog/completed-asset',
      created_at: '2026-10-27T00:00:00.000Z',
    },
  }))
  api.abortUpload.mockResolvedValue({ aborted: true })
}

function resetApi() {
  vi.clearAllMocks()
  installUploadApi()
  storage.clear()
}

async function waitFor(check: () => boolean, timeout = 1000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout)
      throw new Error('Timed out waiting for upload state.')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  installStorage()
  resetApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resumable blog upload resilience', () => {
  it('limits raw part transfers to two across simultaneous files and records exact bytes', async () => {
    let active = 0
    let maximum = 0
    api.putUploadPart.mockImplementation(async (_id: string, part: number) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 4))
      active--
      return { part_number: part, etag: `etag-${part}` }
    })

    const upload = useBlogMediaUpload()
    const first = upload.upload(makeFile('first.png'))
    const second = upload.upload(makeFile('second.png'))
    const [firstTask, secondTask] = await Promise.all([first, second])

    expect(maximum).toBe(2)
    expect(firstTask.status).toBe('complete')
    expect(secondTask.status).toBe('complete')
    expect(firstTask.uploadedBytes).toBe(firstTask.totalBytes)
    expect(upload.progress(firstTask)).toBe(100)
    expect(api.putUploadPart).toHaveBeenCalledTimes(6)
  })

  it('prevents double resume and cancellation during reconciliation from reviving a task', async () => {
    let releaseInitialPart!: () => void
    api.putUploadPart.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseInitialPart = resolve
      })
      return { part_number: 1, etag: 'initial-etag' }
    })

    const upload = useBlogMediaUpload()
    const pending = upload.upload(makeFile('cancel.png', BLOG_MEDIA_PART_SIZE))
    await waitFor(() => upload.tasks.value[0]?.status === 'uploading')
    const task = upload.tasks.value[0]!
    upload.pause(task)
    releaseInitialPart()
    await pending
    expect(task.status).toBe('paused')

    let releaseGet!: (value: { upload: { id: string, part_size: number, parts: { part_number: number, etag: string }[] } }) => void
    api.getUpload.mockImplementationOnce(() => new Promise((resolve) => {
      releaseGet = resolve
    }))
    const firstResume = upload.resume(task)
    await waitFor(() => api.getUpload.mock.calls.length === 1)
    const secondResume = upload.resume(task)
    await upload.cancel(task)
    releaseGet({ upload: { id: task.uploadId, part_size: BLOG_MEDIA_PART_SIZE, parts: [] } })
    await Promise.all([firstResume, secondResume])

    expect(task.status).toBe('cancelled')
    expect(api.putUploadPart).toHaveBeenCalledTimes(1)
    expect(storage.has(BLOG_MEDIA_UPLOAD_RECOVERY_KEY)).toBe(false)
  })

  it('retries a failed task from error and reconciles a lost completion response idempotently', async () => {
    let partAttempt = 0
    api.putUploadPart.mockImplementation(async (_id: string, part: number) => {
      partAttempt++
      if (partAttempt === 1)
        throw new Error('temporary transfer failure')
      return { part_number: part, etag: `etag-${part}` }
    })

    const upload = useBlogMediaUpload()
    const task = await upload.upload(makeFile('retry.png', BLOG_MEDIA_PART_SIZE))
    expect(task.status).toBe('error')
    expect(task.error).toContain('temporary transfer failure')
    expect(upload.recoverableCount.value).toBe(1)

    api.putUploadPart.mockImplementation(async (_id: string, part: number) => ({ part_number: part, etag: `etag-${part}` }))
    api.completeUpload
      .mockRejectedValueOnce(new Error('completion response lost'))
      .mockResolvedValueOnce({ asset: makeAsset('completed-retry', task.file) })
    api.getUpload.mockResolvedValueOnce({
      upload: { id: task.uploadId, part_size: BLOG_MEDIA_PART_SIZE, parts: task.parts },
    })

    await upload.resume(task)

    expect(task.status).toBe('complete')
    expect(api.completeUpload).toHaveBeenCalledTimes(2)
    expect(api.completeUpload.mock.calls[0]![0]).toBe(task.uploadId)
    expect(api.completeUpload.mock.calls[1]![0]).toBe(task.uploadId)
    expect(upload.recoverableCount.value).toBe(0)
  })

  it('persists metadata only, matches a reselected file exactly, and recovers after a new composable instance', async () => {
    let releaseInitialPart!: () => void
    api.putUploadPart.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseInitialPart = resolve
      })
      return { part_number: 1, etag: 'initial-etag' }
    })

    const original = makeFile('reload.png', BLOG_MEDIA_PART_SIZE, 9876)
    const firstUpload = useBlogMediaUpload()
    const pending = firstUpload.upload(original)
    await waitFor(() => firstUpload.tasks.value[0]?.status === 'uploading')
    const task = firstUpload.tasks.value[0]!
    firstUpload.pause(task)
    releaseInitialPart()
    await pending

    const persisted = JSON.parse(storage.get(BLOG_MEDIA_UPLOAD_RECOVERY_KEY)!)
    expect(persisted[0].filename).toBe('reload.png')
    expect(persisted[0].size).toBe(BLOG_MEDIA_PART_SIZE)
    expect(JSON.stringify(persisted)).not.toContain('base64')
    expect(JSON.stringify(persisted)).not.toContain('bytes')

    const reloaded = useBlogMediaUpload()
    expect(reloaded.recoverableCount.value).toBe(1)
    expect(reloaded.findRecoverableUpload(new File([new Uint8Array(BLOG_MEDIA_PART_SIZE)], 'reload.png', { type: 'image/png', lastModified: 1 }))).toBeNull()

    api.getUpload.mockResolvedValueOnce({
      upload: { id: task.uploadId, part_size: BLOG_MEDIA_PART_SIZE, parts: task.parts },
    })
    api.completeUpload.mockResolvedValueOnce({ asset: makeAsset('recovered', original) })
    const recovered = await reloaded.recoverUpload(new File([new Uint8Array(BLOG_MEDIA_PART_SIZE)], 'reload.png', { type: 'image/png', lastModified: 9876 }))

    expect(recovered?.status).toBe('complete')
    expect(reloaded.recoverableCount.value).toBe(0)
    expect(api.completeUpload).toHaveBeenCalledWith(task.uploadId, expect.any(Array))
  })
})

describe('dOCX upload gating', () => {
  it('rejects imported images when an upload does not reach complete', async () => {
    vi.doMock('@/utils/blog-docx', () => ({
      importBlogDocx: vi.fn(async () => ({
        html: '<p>{{image-1}}</p>',
        messages: [],
        images: [{ placeholder: '{{image-1}}', alt: 'Illustration', blob: new Blob(['image'], { type: 'image/png' }) }],
      })),
    }))
    api.putUploadPart.mockRejectedValue(new Error('upload failed'))
    const { useBlogDocuments } = await import('../app/composables/useBlogDocuments')
    const documents = useBlogDocuments()
    await expect(documents.importDocx(new File(['docx'], 'draft.docx'))).rejects.toThrow('could not be uploaded completely')
  })
})
