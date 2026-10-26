import { describe, expect, it, vi } from 'vitest'
import { BLOG_EDITOR_COMMANDS } from '../app/composables/useBlogEditor'
import { convertLegacyHtmlToTiptap } from '../app/composables/useBlogLegacyConversion'
import { BLOG_MEDIA_MAX_CONCURRENT_PARTS, BLOG_MEDIA_MAX_SOURCE_BYTES, BLOG_MEDIA_PART_SIZE, getMediaPartRanges } from '../app/composables/useBlogMediaUpload'
import { cloneDraft, createEmptyDraft, formatBytes, isStaleDraftError } from '../app/utils/blog-studio'

const autosaveApi = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  checkpoint: vi.fn(),
}))

function createTestRef<T>(value: T) {
  return { value }
}

function installAutosaveGlobals() {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.ref = createTestRef
  globals.computed = (getter: () => unknown) => ({
    get value() {
      return getter()
    },
  })
  globals.watch = () => undefined
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
    autosave.dispose()
    vi.useRealTimers()
  })
})

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
