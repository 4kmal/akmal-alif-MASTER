import type { JSONContent } from '@tiptap/vue-3'
import type { LegacyConversionIssue, LegacyConversionResult } from '@/utils/blog-studio'

const UNSUPPORTED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'canvas', 'svg'])
const BLOCK_NODE_TYPES = new Set(['blockquote', 'codeBlock', 'heading', 'horizontalRule', 'orderedList', 'paragraph', 'table', 'bulletList', 'blogMedia'])
const STRUCTURAL_TAGS = new Set(['address', 'aside', 'footer', 'header', 'main', 'nav'])

function issueFor(issues: LegacyConversionIssue[], tag: string, message: string) {
  const existing = issues.find(issue => issue.tag === tag)
  if (existing) {
    existing.count += 1
    return
  }
  issues.push({ tag, message, count: 1 })
}

function convertElement(element: Element, issues: LegacyConversionIssue[]): JSONContent[] {
  const tag = element.tagName.toLowerCase()
  if (element.hasAttribute('style') && !['img', 'video'].includes(tag))
    issueFor(issues, 'style', 'Inline styles are reviewed separately; unsupported declarations are omitted from the editor document.')
  if (UNSUPPORTED_TAGS.has(tag)) {
    issueFor(issues, tag, 'This element cannot be represented safely in the editor and stays in the original HTML revision.')
    return []
  }
  if (tag === 'br')
    return [{ type: 'hardBreak' }]
  if (tag === 'hr')
    return [{ type: 'horizontalRule' }]
  if (tag === 'img') {
    const src = element.getAttribute('src') ?? ''
    if (!src) {
      issueFor(issues, 'img', 'Image without a source was skipped.')
      return []
    }
    return [{ type: 'blogMedia', attrs: { assetId: element.getAttribute('data-asset-id') || `legacy:${src}`, kind: 'image', src, alt: element.getAttribute('alt') ?? '', caption: '', width: 100, align: 'left' } }]
  }
  if (tag === 'video') {
    const src = element.getAttribute('src') ?? element.querySelector('source')?.getAttribute('src') ?? ''
    if (!src) {
      issueFor(issues, 'video', 'Video without a source was skipped.')
      return []
    }
    return [{ type: 'blogMedia', attrs: { assetId: element.getAttribute('data-asset-id') || `legacy:${src}`, kind: 'video', src, alt: '', caption: '', width: 100, align: 'left' } }]
  }
  const children = Array.from(element.childNodes).flatMap((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? ''
      return text ? [{ type: 'text', text }] : []
    }
    if (child.nodeType === Node.ELEMENT_NODE)
      return convertElement(child as Element, issues)
    return []
  })
  if (tag === 'figure') {
    const caption = element.querySelector(':scope > figcaption')?.textContent?.trim()
    const media = children.find(child => child.type === 'blogMedia')
    if (media && caption)
      media.attrs = { ...(media.attrs ?? {}), caption }
    return media ? [media] : children
  }
  if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
    if (children.some(child => child.type === 'blogMedia'))
      return children
    if (children.some(child => BLOCK_NODE_TYPES.has(child.type ?? ''))) {
      issueFor(issues, 'structure', `Block content inside <${tag}> was flattened into separate editor blocks.`)
      return children
    }
    return [{ type: 'paragraph', content: children.length ? children : undefined }]
  }
  if (/^h[1-6]$/.test(tag)) {
    const attrs: Record<string, string | number> = { level: Number(tag.slice(1)) }
    const id = element.getAttribute('id')
    if (id)
      attrs.id = id
    return [{ type: 'heading', attrs, content: children.length ? children : undefined }]
  }
  if (tag === 'blockquote')
    return [{ type: 'blockquote', content: [{ type: 'paragraph', content: children.length ? children : undefined }] }]
  if (tag === 'pre')
    return [{ type: 'codeBlock', content: [{ type: 'text', text: element.textContent ?? '' }] }]
  if (tag === 'table') {
    if (element.querySelector(':scope > caption, :scope > colgroup, :scope > tfoot, [rowspan], [colspan], table table'))
      issueFor(issues, 'table', 'Table captions, spans, footers or nested tables are flattened before applying the conversion.')
    const rows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr')).map((row) => {
      const cells = Array.from(row.children).filter(cell => ['th', 'td'].includes(cell.tagName.toLowerCase())).map((cell) => {
        const converted = convertElement(cell, issues)
        const blocks = converted.filter(child => BLOCK_NODE_TYPES.has(child.type ?? ''))
        const inline = converted.filter(child => !BLOCK_NODE_TYPES.has(child.type ?? ''))
        if (blocks.length && inline.length)
          issueFor(issues, 'table', 'Mixed inline and block content in a table cell was flattened into block content.')
        const content = blocks.length ? blocks : [{ type: 'paragraph', content: inline.length ? inline : undefined }]
        return {
          type: cell.tagName.toLowerCase() === 'th' ? 'tableHeader' : 'tableCell',
          content,
        }
      })
      return { type: 'tableRow', content: cells }
    })
    if (rows.length)
      return [{ type: 'table', content: rows }]
    issueFor(issues, 'table', 'An empty table was skipped.')
    return []
  }
  if (tag === 'ul' || tag === 'ol') {
    const type = tag === 'ol' ? 'orderedList' : 'bulletList'
    const items = Array.from(element.children).filter(child => child.tagName.toLowerCase() === 'li').map((item) => {
      const converted = convertElement(item, issues)
      const itemContent: JSONContent[] = []
      let inline: JSONContent[] = []
      for (const child of converted) {
        const isList = child.type === 'bulletList' || child.type === 'orderedList'
        const isBlock = BLOCK_NODE_TYPES.has(child.type ?? '')
        if (isList || isBlock) {
          if (inline.length) {
            itemContent.push({ type: 'paragraph', content: inline })
            inline = []
          }
          itemContent.push(child)
        }
        else {
          inline.push(child)
        }
      }
      if (inline.length)
        itemContent.push({ type: 'paragraph', content: inline })
      if (!itemContent.length || itemContent[0]?.type !== 'paragraph')
        itemContent.unshift({ type: 'paragraph' })
      return { type: 'listItem', content: itemContent }
    })
    return [{ type, content: items }]
  }
  if (tag === 'li')
    return children
  if (tag === 'a') {
    return children.map(child => ({ ...child, marks: [...(child.marks ?? []), { type: 'link', attrs: { href: element.getAttribute('href') ?? '', target: '_blank', rel: 'noopener noreferrer' } }] }))
  }
  if (tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'u' || tag === 's' || tag === 'del' || tag === 'sub' || tag === 'sup' || tag === 'mark') {
    const mark = tag === 'strong' || tag === 'b' ? 'bold' : tag === 'u' ? 'underline' : tag === 's' || tag === 'del' ? 'strike' : tag === 'sub' ? 'subscript' : tag === 'sup' ? 'superscript' : tag === 'mark' ? 'highlight' : 'italic'
    return children.map(child => ({ ...child, marks: [...(child.marks ?? []), { type: mark }] }))
  }
  if (STRUCTURAL_TAGS.has(tag)) {
    issueFor(issues, 'structure', `<${tag}> is reduced to its content because the editor has no matching structural node.`)
    return children
  }
  return children
}

export function convertLegacyHtmlToTiptap(html: string): LegacyConversionResult {
  const issues: LegacyConversionIssue[] = []
  let content: JSONContent[] = []
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html')
    content = Array.from(document.body.childNodes).flatMap((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() ?? ''
        return text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : []
      }
      return node.nodeType === Node.ELEMENT_NODE ? convertElement(node as Element, issues) : []
    })
  }
  else {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    content = text ? [{ type: 'paragraph', content: [{ type: 'text', text }] }] : [{ type: 'paragraph' }]
    issueFor(issues, 'browser', 'Preview conversion ran without a DOM parser; formatting should be reviewed before applying.')
  }
  return {
    document: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    issues,
    originalHtml: html,
    convertedAt: new Date().toISOString(),
  }
}
