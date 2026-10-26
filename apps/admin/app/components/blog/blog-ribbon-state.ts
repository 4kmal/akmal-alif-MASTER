export const BLOG_RIBBON_TABS = ['Home', 'Insert', 'Layout', 'Media', 'Review'] as const

export type BlogRibbonTab = (typeof BLOG_RIBBON_TABS)[number]

export function moveBlogRibbonTab(index: number, key: string): number | null {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(key))
    return null

  if (key === 'Home')
    return 0
  if (key === 'End')
    return BLOG_RIBBON_TABS.length - 1

  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  return (index + direction + BLOG_RIBBON_TABS.length) % BLOG_RIBBON_TABS.length
}
