import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { cloneBlogMediaDocument, createBlogMediaSelectionGuard, getBlogPosterAssets, isCurrentBlogMediaDocument, isValidBlogClipIndex } from '../app/components/blog/blog-media-library-state'

describe('media library selection state', () => {
  it('rejects stale async work after a newer source selection begins', () => {
    const guard = createBlogMediaSelectionGuard()
    const first = guard.begin('asset-a')
    const second = guard.begin('asset-b')

    expect(guard.isCurrent(first, 'asset-a')).toBe(false)
    expect(guard.isCurrent(second, 'asset-b')).toBe(true)
    expect(guard.isCurrent(second, 'asset-a')).toBe(false)
  })

  it('accepts only real clip positions for the timeline selector', () => {
    expect(isValidBlogClipIndex(0, 2)).toBe(true)
    expect(isValidBlogClipIndex(1, 2)).toBe(true)
    expect(isValidBlogClipIndex(-1, 2)).toBe(false)
    expect(isValidBlogClipIndex(2, 2)).toBe(false)
    expect(isValidBlogClipIndex(1.5, 2)).toBe(false)
  })

  it('offers only ready still or GIF assets as poster choices', () => {
    const assets = [
      { id: 'video', kind: 'video' },
      { id: 'still', kind: 'image' },
      { id: 'animation', kind: 'gif' },
    ]

    expect(getBlogPosterAssets(assets).map(asset => asset.id)).toEqual(['still', 'animation'])
  })

  it('accepts the Vue ref proxy for the same GIF document during frame decoding', () => {
    const document = {
      kind: 'gif',
      clips: [],
      frames: [],
      output: { format: 'gif', width: 2, height: 2, fps: 15, quality: 80, loop: 0 },
    }
    const project = ref(document)

    expect(project.value).not.toBe(document)
    expect(isCurrentBlogMediaDocument(project.value, document)).toBe(true)
  })

  it('clones a reactive saved project document before reloading it', () => {
    const document = {
      kind: 'gif',
      clips: [{ id: 'clip-1', asset_id: 'asset-1' }],
      frames: [{ source_index: 0, delay_ms: 100, enabled: true }],
      output: { format: 'gif', width: 2, height: 2, fps: 15, quality: 80, loop: 0 },
    }
    const saved = reactive({ document })

    expect(() => structuredClone(saved.document)).toThrow()
    const clone = cloneBlogMediaDocument(saved.document)

    expect(clone).toEqual(document)
    expect(clone).not.toBe(document)
    expect(clone.clips).not.toBe(document.clips)
  })
})
