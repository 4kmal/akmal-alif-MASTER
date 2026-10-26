import { describe, expect, it } from 'vitest'
import { createBlogMediaSelectionGuard, getBlogPosterAssets, isValidBlogClipIndex } from '../app/components/blog/blog-media-library-state'

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
})
