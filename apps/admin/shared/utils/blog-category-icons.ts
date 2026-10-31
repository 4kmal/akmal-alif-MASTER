// Icon keys a blog category may use. The server validates against this list, the category manager
// offers it, and app/utils/blog-category-sprites.ts draws one sprite per key.
export const BLOG_CATEGORY_ICON_KEYS = [
  'civic-tech',
  'cybersecurity',
  'game-development',
  'robotics',
  'anthem',
  'internet-culture',
  'islamic-heritage',
  'psychology',
  'machine-learning',
  'neuroscience',
  'technology',
  'design',
  'education',
  'music',
  'news',
  'personal',
  'projects',
  'general',
] as const

export type BlogCategoryIconKey = (typeof BLOG_CATEGORY_ICON_KEYS)[number]

export function isBlogCategoryIconKey(value: unknown): value is BlogCategoryIconKey {
  return typeof value === 'string' && (BLOG_CATEGORY_ICON_KEYS as readonly string[]).includes(value)
}
