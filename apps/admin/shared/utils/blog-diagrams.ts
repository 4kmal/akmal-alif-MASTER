// Diagrams are reviewed SVG files in the portfolio repo (assets/blog/diagrams/<key>.svg).
// Keep this list in step with BLOG_DIAGRAMS in the portfolio's js/blog-diagram.js; a root test compares them.
export interface BlogDiagramDefinition {
  key: string
  title: string
}

export const BLOG_DIAGRAMS: readonly BlogDiagramDefinition[] = Object.freeze([
  { key: 'publictransport-live-data', title: 'How publictransport.my assembles live buses and estimated trains' },
])

export const BLOG_DIAGRAM_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function blogDiagramPath(key: string): string {
  return `/assets/blog/diagrams/${key}.svg`
}

export function findBlogDiagram(key: unknown): BlogDiagramDefinition | null {
  if (typeof key !== 'string' || key.length > 64 || !BLOG_DIAGRAM_KEY_PATTERN.test(key))
    return null
  return BLOG_DIAGRAMS.find(diagram => diagram.key === key) ?? null
}
