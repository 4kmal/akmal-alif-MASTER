import type { BlogCategoryIconKey } from '#shared/utils/blog-category-icons'

// 20×20 pixel sprites for blog categories. Each rect is [x, y, width, height, tone]; tones map to CSS
// variables in blog-studio.css so the sprites follow the admin theme. The motion group is animated with
// steps() keyframes: blink and twinkle toggle visibility, bob/sway/scan shift by whole pixels, and swap
// alternates between two frames.
export type SpriteTone = 'ink' | 'mid' | 'light' | 'accent'
export type SpriteRect = readonly [number, number, number, number, SpriteTone]
export type SpriteMotionKind = 'blink' | 'twinkle' | 'bob' | 'sway' | 'scan' | 'swap'

export interface BlogCategorySpriteDefinition {
  label: string
  tint: string
  base: readonly SpriteRect[]
  motion: {
    kind: SpriteMotionKind
    frames: readonly (readonly SpriteRect[])[]
    distance?: number
  }
}

export type BlogSpriteKey = BlogCategoryIconKey | 'uncategorised'

export const BLOG_CATEGORY_SPRITES: Readonly<Record<BlogSpriteKey, BlogCategorySpriteDefinition>> = Object.freeze({
  'uncategorised': {
    label: 'Dashed box with a blinking question mark',
    tint: '#94a3b8',
    base: [
      [3, 3, 3, 1, 'ink'],
      [8, 3, 4, 1, 'ink'],
      [14, 3, 3, 1, 'ink'],
      [3, 16, 3, 1, 'ink'],
      [8, 16, 4, 1, 'ink'],
      [14, 16, 3, 1, 'ink'],
      [3, 6, 1, 3, 'ink'],
      [3, 11, 1, 3, 'ink'],
      [16, 6, 1, 3, 'ink'],
      [16, 11, 1, 3, 'ink'],
    ],
    motion: { kind: 'twinkle', frames: [[[8, 6, 4, 1, 'mid'], [11, 7, 1, 2, 'mid'], [10, 9, 1, 1, 'mid'], [9, 10, 1, 2, 'mid'], [9, 13, 1, 1, 'mid']]] },
  },
  'psychology': {
    label: 'Head in profile with thought sparks',
    tint: '#c084fc',
    base: [
      [6, 4, 6, 1, 'mid'],
      [5, 5, 8, 8, 'mid'],
      [13, 7, 2, 4, 'mid'],
      [15, 9, 1, 1, 'mid'],
      [7, 13, 4, 3, 'mid'],
      [7, 7, 3, 1, 'ink'],
      [8, 9, 3, 1, 'ink'],
      [12, 8, 1, 1, 'ink'],
      [6, 5, 2, 2, 'light'],
    ],
    motion: { kind: 'twinkle', frames: [[[16, 2, 1, 1, 'accent'], [17, 4, 1, 1, 'accent'], [15, 4, 1, 1, 'accent'], [18, 1, 1, 1, 'accent']]] },
  },
  'machine-learning': {
    label: 'Chip with a pulsing core',
    tint: '#38bdf8',
    base: [
      [5, 5, 10, 10, 'ink'],
      [6, 6, 8, 8, 'mid'],
      [6, 3, 1, 2, 'ink'],
      [9, 3, 2, 2, 'ink'],
      [13, 3, 1, 2, 'ink'],
      [6, 15, 1, 2, 'ink'],
      [9, 15, 2, 2, 'ink'],
      [13, 15, 1, 2, 'ink'],
      [3, 6, 2, 1, 'ink'],
      [3, 9, 2, 2, 'ink'],
      [3, 13, 2, 1, 'ink'],
      [15, 6, 2, 1, 'ink'],
      [15, 9, 2, 2, 'ink'],
      [15, 13, 2, 1, 'ink'],
    ],
    motion: { kind: 'swap', frames: [[[8, 8, 4, 4, 'accent']], [[9, 9, 2, 2, 'light']]] },
  },
  'neuroscience': {
    label: 'Neurons passing a signal',
    tint: '#f472b6',
    base: [
      [6, 5, 8, 1, 'ink'],
      [10, 6, 1, 7, 'ink'],
      [12, 14, 3, 1, 'ink'],
      [3, 4, 3, 3, 'mid'],
      [14, 3, 3, 3, 'mid'],
      [9, 13, 3, 3, 'mid'],
      [15, 13, 3, 3, 'mid'],
      [4, 5, 1, 1, 'light'],
      [15, 4, 1, 1, 'light'],
    ],
    motion: { kind: 'scan', distance: 7, frames: [[[6, 5, 1, 1, 'accent']]] },
  },
  'civic-tech': {
    label: 'Bar chart with a bobbing map pin',
    tint: '#f59e0b',
    base: [
      [4, 12, 3, 5, 'mid'],
      [8, 9, 3, 8, 'mid'],
      [12, 7, 3, 10, 'mid'],
      [3, 17, 14, 1, 'ink'],
      [4, 12, 3, 1, 'light'],
      [8, 9, 3, 1, 'light'],
      [12, 7, 3, 1, 'light'],
    ],
    motion: { kind: 'bob', frames: [[[14, 1, 4, 3, 'accent'], [15, 4, 2, 1, 'accent'], [15, 2, 2, 1, 'ink']]] },
  },
  'cybersecurity': {
    label: 'Shield with a glowing keyhole',
    tint: '#3b82f6',
    base: [
      [5, 3, 10, 2, 'mid'],
      [4, 5, 12, 6, 'mid'],
      [5, 11, 10, 2, 'mid'],
      [6, 13, 8, 2, 'mid'],
      [8, 15, 4, 2, 'mid'],
      [6, 5, 2, 4, 'light'],
    ],
    motion: { kind: 'swap', frames: [[[9, 7, 2, 2, 'ink'], [9, 9, 2, 3, 'ink']], [[9, 7, 2, 2, 'accent'], [9, 9, 2, 3, 'accent']]] },
  },
  'game-development': {
    label: 'Gamepad with alternating buttons',
    tint: '#8b5cf6',
    base: [
      [4, 6, 12, 1, 'mid'],
      [3, 7, 14, 6, 'mid'],
      [2, 9, 2, 5, 'mid'],
      [16, 9, 2, 5, 'mid'],
      [5, 9, 3, 1, 'ink'],
      [6, 8, 1, 3, 'ink'],
    ],
    motion: { kind: 'swap', frames: [[[13, 8, 2, 2, 'accent'], [11, 10, 2, 2, 'ink']], [[13, 8, 2, 2, 'ink'], [11, 10, 2, 2, 'accent']]] },
  },
  'robotics': {
    label: 'Robot head with blinking eyes',
    tint: '#fb923c',
    base: [
      [9, 3, 2, 3, 'ink'],
      [9, 2, 2, 1, 'accent'],
      [4, 6, 12, 9, 'mid'],
      [3, 9, 1, 3, 'ink'],
      [16, 9, 1, 3, 'ink'],
      [7, 13, 6, 1, 'ink'],
      [5, 7, 2, 1, 'light'],
    ],
    motion: { kind: 'blink', frames: [[[6, 9, 3, 2, 'light'], [11, 9, 3, 2, 'light'], [7, 9, 1, 2, 'ink'], [12, 9, 1, 2, 'ink']]] },
  },
  'anthem': {
    label: 'Javelin helmet with a visor glint',
    tint: '#2dd4bf',
    base: [
      [5, 3, 10, 2, 'mid'],
      [4, 5, 12, 9, 'mid'],
      [5, 14, 10, 2, 'mid'],
      [7, 16, 6, 1, 'mid'],
      [6, 8, 8, 3, 'ink'],
      [9, 3, 2, 2, 'light'],
      [5, 12, 2, 1, 'ink'],
      [13, 12, 2, 1, 'ink'],
    ],
    motion: { kind: 'scan', distance: 5, frames: [[[7, 9, 2, 1, 'light']]] },
  },
  'internet-culture': {
    label: 'Two chat bubbles taking turns',
    tint: '#fb7185',
    base: [
      [2, 3, 10, 6, 'mid'],
      [3, 9, 2, 2, 'mid'],
      [8, 10, 10, 6, 'ink'],
      [15, 16, 2, 2, 'ink'],
    ],
    motion: {
      kind: 'swap',
      frames: [
        [[4, 5, 2, 2, 'light'], [7, 5, 2, 2, 'light']],
        [[10, 12, 2, 2, 'accent'], [13, 12, 2, 2, 'accent']],
      ],
    },
  },
  'islamic-heritage': {
    label: 'Domed building with a twinkling star',
    tint: '#10b981',
    base: [
      [9, 2, 2, 2, 'accent'],
      [8, 4, 4, 1, 'mid'],
      [7, 5, 6, 1, 'mid'],
      [6, 6, 8, 2, 'mid'],
      [5, 8, 10, 2, 'mid'],
      [4, 10, 12, 7, 'mid'],
      [9, 13, 2, 4, 'ink'],
      [6, 12, 1, 2, 'ink'],
      [13, 12, 1, 2, 'ink'],
      [3, 17, 14, 1, 'ink'],
      [7, 6, 2, 1, 'light'],
    ],
    motion: { kind: 'twinkle', frames: [[[16, 2, 1, 3, 'accent'], [15, 3, 3, 1, 'accent']]] },
  },
  'technology': {
    label: 'Laptop with a blinking cursor',
    tint: '#6366f1',
    base: [
      [4, 4, 12, 9, 'ink'],
      [5, 5, 10, 7, 'mid'],
      [2, 13, 16, 2, 'mid'],
      [3, 15, 14, 1, 'ink'],
      [6, 6, 4, 1, 'light'],
      [6, 8, 6, 1, 'light'],
      [6, 10, 3, 1, 'light'],
    ],
    motion: { kind: 'blink', frames: [[[10, 10, 1, 1, 'accent'], [11, 10, 1, 1, 'accent']]] },
  },
  'design': {
    label: 'Paint palette with cycling colours',
    tint: '#e879f9',
    base: [
      [4, 5, 11, 9, 'mid'],
      [3, 7, 1, 5, 'mid'],
      [15, 7, 2, 4, 'mid'],
      [6, 14, 6, 2, 'mid'],
      [12, 10, 2, 2, 'ink'],
      [15, 2, 1, 5, 'ink'],
      [14, 1, 3, 1, 'accent'],
    ],
    motion: {
      kind: 'swap',
      frames: [
        [[6, 7, 2, 2, 'accent'], [9, 6, 2, 2, 'light'], [6, 10, 2, 2, 'ink']],
        [[6, 7, 2, 2, 'light'], [9, 6, 2, 2, 'ink'], [6, 10, 2, 2, 'accent']],
      ],
    },
  },
  'education': {
    label: 'Graduation cap with a swinging tassel',
    tint: '#84cc16',
    base: [
      [9, 4, 2, 1, 'mid'],
      [6, 5, 8, 1, 'mid'],
      [3, 6, 14, 2, 'mid'],
      [6, 8, 8, 1, 'mid'],
      [9, 9, 2, 1, 'mid'],
      [6, 10, 8, 3, 'ink'],
      [7, 13, 6, 1, 'ink'],
      [9, 6, 2, 1, 'light'],
      [16, 7, 1, 2, 'accent'],
    ],
    motion: { kind: 'sway', frames: [[[16, 9, 1, 3, 'accent'], [15, 12, 3, 2, 'accent']]] },
  },
  'music': {
    label: 'Bobbing music note',
    tint: '#ef4444',
    base: [[14, 12, 1, 1, 'accent'], [16, 9, 1, 1, 'accent'], [3, 17, 12, 1, 'ink']],
    motion: {
      kind: 'bob',
      frames: [[[4, 13, 5, 3, 'mid'], [5, 12, 3, 1, 'mid'], [5, 16, 3, 1, 'mid'], [8, 4, 2, 10, 'ink'], [10, 4, 4, 2, 'ink'], [12, 6, 2, 2, 'ink'], [5, 13, 1, 1, 'light']]],
    },
  },
  'news': {
    label: 'Newspaper with a scrolling highlight',
    tint: '#a8a29e',
    base: [
      [4, 3, 12, 14, 'light'],
      [4, 3, 12, 1, 'ink'],
      [4, 16, 12, 1, 'ink'],
      [4, 3, 1, 14, 'ink'],
      [15, 3, 1, 14, 'ink'],
      [6, 5, 8, 2, 'mid'],
      [6, 9, 8, 1, 'ink'],
      [6, 11, 8, 1, 'ink'],
      [6, 13, 5, 1, 'ink'],
    ],
    motion: { kind: 'scan', distance: 5, frames: [[[6, 9, 3, 1, 'accent']]] },
  },
  'personal': {
    label: 'Avatar that blinks',
    tint: '#22d3ee',
    base: [[7, 3, 6, 6, 'mid'], [5, 10, 10, 1, 'mid'], [4, 11, 12, 6, 'mid'], [8, 4, 2, 1, 'light'], [9, 8, 2, 1, 'ink']],
    motion: { kind: 'blink', frames: [[[8, 6, 1, 1, 'ink'], [11, 6, 1, 1, 'ink']]] },
  },
  'projects': {
    label: 'Kanban board with a card moving across',
    tint: '#eab308',
    base: [
      [2, 3, 16, 14, 'mid'],
      [3, 5, 4, 11, 'light'],
      [8, 5, 4, 11, 'light'],
      [13, 5, 4, 11, 'light'],
      [3, 6, 4, 2, 'ink'],
      [3, 9, 4, 2, 'ink'],
      [13, 9, 4, 2, 'ink'],
    ],
    motion: { kind: 'scan', distance: 5, frames: [[[8, 6, 4, 2, 'accent']]] },
  },
  'general': {
    label: 'Grid where one tile flips',
    tint: '#9ca3af',
    base: [[3, 3, 6, 6, 'mid'], [11, 3, 6, 6, 'mid'], [3, 11, 6, 6, 'mid'], [4, 4, 2, 1, 'light']],
    motion: { kind: 'swap', frames: [[[11, 11, 6, 6, 'accent']], [[13, 11, 2, 6, 'accent']]] },
  },
})

export function blogCategorySprite(iconKey: string | null | undefined): BlogCategorySpriteDefinition {
  if (iconKey == null || iconKey === '' || iconKey === 'uncategorised')
    return BLOG_CATEGORY_SPRITES.uncategorised
  return (BLOG_CATEGORY_SPRITES as Record<string, BlogCategorySpriteDefinition>)[iconKey] ?? BLOG_CATEGORY_SPRITES.general
}
