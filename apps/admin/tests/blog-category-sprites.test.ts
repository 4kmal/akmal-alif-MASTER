// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import BlogCategorySprite from '../app/components/blog/BlogCategorySprite.vue'
import { BLOG_CATEGORY_SPRITES, blogCategorySprite } from '../app/utils/blog-category-sprites'
import { BLOG_CATEGORY_ICON_KEYS } from '../shared/utils/blog-category-icons'

afterEach(() => document.body.replaceChildren())

describe('blog category sprites', () => {
  it('draws every studio icon key plus uncategorised inside a 20×20 grid with one motion group', () => {
    for (const key of [...BLOG_CATEGORY_ICON_KEYS, 'uncategorised'] as const) {
      const sprite = BLOG_CATEGORY_SPRITES[key]
      expect(sprite, key).toBeDefined()
      expect(sprite.tint, key).toMatch(/^#[\da-f]{6}$/)
      expect(sprite.motion.frames.length, key).toBeGreaterThan(0)
      if (sprite.motion.kind === 'swap')
        expect(sprite.motion.frames, key).toHaveLength(2)
      if (sprite.motion.kind === 'scan')
        expect(sprite.motion.distance, key).toBeGreaterThan(0)
      for (const [x, y, width, height] of [...sprite.base, ...sprite.motion.frames.flat()]) {
        expect(x >= 0 && y >= 0 && width > 0 && height > 0, key).toBe(true)
        expect(x + width <= 20 && y + height <= 20, `${key} rect at ${x},${y}`).toBe(true)
      }
    }
    expect(Object.keys(BLOG_CATEGORY_SPRITES)).toHaveLength(BLOG_CATEGORY_ICON_KEYS.length + 1)
  })

  it('falls back to the general sprite for unknown keys and uncategorised for empty ones', () => {
    expect(blogCategorySprite('not-a-key')).toBe(BLOG_CATEGORY_SPRITES.general)
    expect(blogCategorySprite(null)).toBe(BLOG_CATEGORY_SPRITES.uncategorised)
    expect(blogCategorySprite('')).toBe(BLOG_CATEGORY_SPRITES.uncategorised)
  })

  it('renders a decorative, script-free SVG that carries its tint and motion kind', () => {
    const host = document.createElement('div')
    document.body.append(host)
    createApp({ render: () => h(BlogCategorySprite, { iconKey: 'islamic-heritage', play: 'always' }) }).mount(host)
    const tile = host.querySelector<HTMLElement>('.blog-sprite-tile')!
    const svg = tile.querySelector('svg')!
    expect(tile.dataset.motion).toBe('twinkle')
    expect(tile.dataset.play).toBe('always')
    expect(tile.style.getPropertyValue('--sprite-tint')).toBe(BLOG_CATEGORY_SPRITES['islamic-heritage'].tint)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('.blog-sprite__motion')).toHaveLength(1)
    expect(host.innerHTML).not.toMatch(/<script|on\w+=/i)
  })
})
