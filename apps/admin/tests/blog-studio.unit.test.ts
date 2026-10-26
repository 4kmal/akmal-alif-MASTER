import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BLOG_EDITOR_COMMANDS } from '../app/composables/useBlogEditor'
import { convertLegacyHtmlToTiptap } from '../app/composables/useBlogLegacyConversion'
import { BLOG_MEDIA_MAX_CONCURRENT_PARTS, BLOG_MEDIA_MAX_SOURCE_BYTES, BLOG_MEDIA_PART_SIZE, getMediaPartRanges } from '../app/composables/useBlogMediaUpload'
import { cloneDraft, createEmptyDraft, formatBytes, isStaleDraftError } from '../app/utils/blog-studio'

const autosaveApi = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  checkpoint: vi.fn(),
}))

interface TestRef<T> {
  value: T
}
type TestWatchCallback = (value: unknown, previous: unknown) => void

let testWatchers = new WeakMap<object, TestWatchCallback[]>()

function createTestRef<T>(initialValue: T): TestRef<T> {
  let value = initialValue
  const ref = {} as TestRef<T>
  Object.defineProperty(ref, 'value', {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (nextValue: T) => {
      const previous = value
      value = nextValue
      for (const callback of testWatchers.get(ref) ?? [])
        callback(nextValue, previous)
    },
  })
  return ref
}

function installAutosaveGlobals() {
  testWatchers = new WeakMap()
  const globals = globalThis as unknown as Record<string, unknown>
  globals.ref = createTestRef
  globals.computed = (getter: () => unknown) => ({
    get value() {
      return getter()
    },
  })
  globals.watch = (source: TestRef<unknown>, callback: TestWatchCallback, options?: { immediate?: boolean }) => {
    const callbacks = testWatchers.get(source as object) ?? []
    callbacks.push(callback)
    testWatchers.set(source as object, callbacks)
    if (options?.immediate)
      callback(source.value, undefined)
  }
  globals.onBeforeUnmount = () => undefined
}

vi.mock('../app/composables/useBlogApi', () => ({
  useBlogApi: () => autosaveApi,
}))

describe('blog studio document state', () => {
  it('creates a private draft with an empty standard document', () => {
    const draft = createEmptyDraft()
    expect(draft.schema_version).toBe(1)
    expect(draft.content_json?.type).toBe('doc')
    expect(draft.content_html).toBe('<p></p>')
  })

  it('clones drafts without sharing editor JSON references', () => {
    const original = createEmptyDraft()
    const copy = cloneDraft(original)
    copy.content_json!.content![0] = { type: 'heading', attrs: { level: 1 } }
    expect(original.content_json!.content![0]).toEqual({ type: 'paragraph' })
  })

  it('recognises a stale draft response for review instead of retrying silently', () => {
    expect(isStaleDraftError({ status: 409, data: { current_version: 4 } })).toBe(true)
    expect(isStaleDraftError({ status: 409, data: { version: 4 } })).toBe(false)
  })
})

describe('legacy conversion review', () => {
  it('returns a review document and preserves the original HTML', () => {
    const html = '<h2>Story</h2><p>Hello <strong>there</strong></p><iframe src="https://example.test"></iframe>'
    const result = convertLegacyHtmlToTiptap(html)
    expect(result.originalHtml).toBe(html)
    expect(result.document.type).toBe('doc')
    expect(result.issues.some(issue => issue.tag === 'browser' || issue.tag === 'iframe')).toBe(true)
  })

  it('preserves authored heading IDs and reports lossy structure before approval', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM('<!doctype html>')
    const globals = globalThis as unknown as Record<string, unknown>
    const previousParser = globals.DOMParser
    const previousNode = globals.Node
    globals.DOMParser = dom.window.DOMParser
    globals.Node = dom.window.Node
    try {
      const result = convertLegacyHtmlToTiptap('<h2 id="chapter-one">Story</h2><ul><li>One<ul><li><strong>Nested</strong></li></ul></li></ul><table><caption>Data</caption><tr><td colspan="2">Value</td></tr></table><img src="/uploads/image.png" data-asset-id="asset-1" alt="Image">')
      expect(result.document.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2, id: 'chapter-one' } })
      expect(result.document.content?.some(node => node.type === 'bulletList')).toBe(true)
      expect(result.document.content?.find(node => node.type === 'blogMedia')).toMatchObject({ attrs: { assetId: 'asset-1' } })
      expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'table' })]))
    }
    finally {
      if (previousParser === undefined)
        delete globals.DOMParser
      else
        globals.DOMParser = previousParser
      if (previousNode === undefined)
        delete globals.Node
      else
        globals.Node = previousNode
      dom.window.close()
    }
  })
})

describe('editor command surface', () => {
  it('keeps ribbon actions mapped to standard editor commands', () => {
    expect(BLOG_EDITOR_COMMANDS).toEqual(expect.arrayContaining([
      'undo',
      'redo',
      'toggleBold',
      'toggleUnderline',
      'toggleTaskList',
      'setLink',
      'insertTable',
      'setFontSize',
      'setLineHeight',
    ]))
  })
})

describe('autosave and concurrency review', () => {
  beforeEach(() => {
    autosaveApi.saveDraft.mockReset()
    autosaveApi.checkpoint.mockReset()
  })

  it('debounces private saves and updates the server version', async () => {
    vi.useFakeTimers()
    installAutosaveGlobals()
    const draft = createEmptyDraft()
    draft.version = 3
    const savedDraft = { ...draft, version: 4, updated_at: '2026-10-27T00:00:00.000Z' }
    autosaveApi.saveDraft.mockResolvedValue({ post: { id: 'post-1' }, draft: savedDraft })
    const { useBlogAutosave } = await import('../app/composables/useBlogAutosave')
    const current = createTestRef(draft)
    const autosave = useBlogAutosave(createTestRef('post-1'), current)

    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(1_999)
    expect(autosaveApi.saveDraft).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(autosaveApi.saveDraft).toHaveBeenCalledWith('post-1', expect.objectContaining({ version: 3 }))
    expect(autosave.state.value).toBe('saved')
    expect(current.value.version).toBe(4)
    autosave.dispose()
    vi.useRealTimers()
  })

  it('stops on a stale response and exposes the server version for review', async () => {
    vi.useFakeTimers()
    installAutosaveGlobals()
    autosaveApi.saveDraft.mockRejectedValue({ status: 409, data: { current_version: 8 } })
    const { useBlogAutosave } = await import('../app/composables/useBlogAutosave')
    const autosave = useBlogAutosave(createTestRef('post-2'), createTestRef(createEmptyDraft()))

    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(autosave.state.value).toBe('stale')
    expect(autosave.staleVersion.value).toBe(8)
    expect(autosave.lastError.value).toContain('newer version')
    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(autosave.state.value).toBe('stale')
    expect(autosaveApi.saveDraft).toHaveBeenCalledTimes(1)
    autosave.dispose()
    vi.useRealTimers()
  })

  it('preserves edits made during a save and queues the newest snapshot', async () => {
    vi.useFakeTimers()
    installAutosaveGlobals()
    const first = deferred<{ post: { id: string }, draft: ReturnType<typeof createEmptyDraft> }>()
    const second = deferred<{ post: { id: string }, draft: ReturnType<typeof createEmptyDraft> }>()
    autosaveApi.saveDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const draft = createEmptyDraft()
    draft.version = 3
    draft.title = 'First title'
    const postId = createTestRef('post-queue')
    const current = createTestRef(draft)
    const { useBlogAutosave } = await import('../app/composables/useBlogAutosave')
    const autosave = useBlogAutosave(postId, current)

    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(autosaveApi.saveDraft).toHaveBeenCalledTimes(1)

    current.value = { ...current.value, title: 'Second title' }
    autosave.markChanged()
    first.resolve({
      post: { id: 'post-queue' },
      draft: { ...createEmptyDraft(), title: 'First title', version: 4, updated_at: '2026-10-27T00:00:01.000Z' },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(autosaveApi.saveDraft).toHaveBeenCalledTimes(2)
    expect(autosaveApi.saveDraft.mock.calls[1]?.[1]).toMatchObject({ title: 'Second title', version: 4 })

    second.resolve({
      post: { id: 'post-queue' },
      draft: { ...createEmptyDraft(), title: 'Second title', version: 5, updated_at: '2026-10-27T00:00:02.000Z' },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(current.value).toMatchObject({ title: 'Second title', version: 5 })
    expect(autosave.state.value).toBe('saved')
    autosave.dispose()
    vi.useRealTimers()
  })

  it('ignores a late save response after switching to another post', async () => {
    vi.useFakeTimers()
    installAutosaveGlobals()
    const pending = deferred<{ post: { id: string }, draft: ReturnType<typeof createEmptyDraft> }>()
    const next = deferred<{ post: { id: string }, draft: ReturnType<typeof createEmptyDraft> }>()
    autosaveApi.saveDraft.mockReturnValueOnce(pending.promise).mockReturnValueOnce(next.promise)
    const oldDraft = createEmptyDraft()
    oldDraft.title = 'Old post'
    const newDraft = createEmptyDraft()
    newDraft.title = 'New post'
    const postId = createTestRef('post-old')
    const current = createTestRef(oldDraft)
    const { useBlogAutosave } = await import('../app/composables/useBlogAutosave')
    const autosave = useBlogAutosave(postId, current)

    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)
    postId.value = 'post-new'
    current.value = newDraft
    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)
    pending.resolve({
      post: { id: 'post-old' },
      draft: { ...oldDraft, title: 'Late old response', version: 8 },
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(autosaveApi.saveDraft).toHaveBeenCalledTimes(2)
    expect(autosaveApi.saveDraft.mock.calls[1]?.[0]).toBe('post-new')
    expect(autosaveApi.saveDraft.mock.calls[1]?.[1]).toMatchObject({ title: 'New post' })
    next.resolve({
      post: { id: 'post-new' },
      draft: { ...newDraft, version: 2 },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(current.value).toMatchObject({ title: 'New post' })
    expect(autosave.state.value).toBe('saved')
    expect(autosaveApi.saveDraft).toHaveBeenCalledTimes(2)
    autosave.dispose()
    vi.useRealTimers()
  })

  it('keeps exact legacy HTML when metadata changes are saved', async () => {
    vi.useFakeTimers()
    installAutosaveGlobals()
    const draft = createEmptyDraft()
    draft.content_json = null
    draft.content_html = '<h2 id="legacy">Legacy source</h2><p>Exact source</p>'
    draft.title = 'Updated metadata'
    autosaveApi.saveDraft.mockResolvedValue({
      post: { id: 'post-legacy' },
      draft: { ...draft, version: 2 },
    })
    const { useBlogAutosave } = await import('../app/composables/useBlogAutosave')
    const autosave = useBlogAutosave(createTestRef('post-legacy'), createTestRef(draft))
    autosave.markChanged()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(autosaveApi.saveDraft.mock.calls[0]?.[1]).toMatchObject({
      title: 'Updated metadata',
      content_json: null,
      content_html: draft.content_html,
    })
    autosave.dispose()
    vi.useRealTimers()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('media upload operation state', () => {
  it('keeps raw parts at 10 MiB and limits workers to two', () => {
    const size = BLOG_MEDIA_PART_SIZE * 2 + 17
    const parts = getMediaPartRanges(size)
    expect(BLOG_MEDIA_MAX_CONCURRENT_PARTS).toBe(2)
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatchObject({ part_number: 1, start: 0, end: BLOG_MEDIA_PART_SIZE })
    expect(parts[2]).toMatchObject({ part_number: 3, start: BLOG_MEDIA_PART_SIZE * 2, end: size })
    expect(BLOG_MEDIA_MAX_SOURCE_BYTES).toBe(250 * 1024 * 1024)
  })

  it('formats source size labels for transfer status', () => {
    expect(formatBytes(BLOG_MEDIA_PART_SIZE)).toBe('10.0 MiB')
    expect(formatBytes(0)).toBe('0 B')
  })
})
