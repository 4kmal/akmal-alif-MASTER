import sanitizeHtml from 'sanitize-html'

export const BLOG_SCHEMA_VERSION = 1
export const BLOG_MAX_CANONICAL_BYTES = 512 * 1024
const MAX_DOCUMENT_NODES = 10_000
const MAX_DOCUMENT_DEPTH = 64
const MAX_TEXT_LENGTH = 200_000

export interface BlogMediaReference {
  id: string
  kind: 'image' | 'gif' | 'video'
  publicUrl: string
  sourceUrl: string
  name?: string
}

export interface RenderBlogContentOptions {
  mode?: 'public' | 'preview'
  resolveMedia?: (assetId: string) => Promise<BlogMediaReference | null>
}

export function blogByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

interface TiptapNode {
  type?: unknown
  text?: unknown
  attrs?: Record<string, unknown>
  marks?: unknown
  content?: unknown
}

interface RenderState {
  nodes: number
  text: number
}

function fail(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, label: string, limit = 1_000): string {
  if (typeof value !== 'string')
    fail(`${label} must be a string`)
  if (value.length > limit)
    fail(`${label} is too long`)
  return value
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function escapeText(value: unknown): string {
  const result = text(value, 'text', MAX_TEXT_LENGTH)
  return escapeHtml(result)
}

function safeUrl(value: unknown, label: string, allowMedia = false): string {
  const candidate = text(value, label, 2_048).trim()
  if (candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\'))
    return candidate
  if (allowMedia && /^\/media\/(?:blog|legacy)\/[\w.~!$&'()*+,;=:@%/-]+$/.test(candidate))
    return candidate
  try {
    const url = new URL(candidate)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:')
      return url.toString()
  }
  catch {
    // Fall through to the same error for malformed and unsafe URLs.
  }
  fail(`${label} must be a safe URL`)
}

function safeCssValue(value: unknown, kind: 'fontFamily' | 'fontSize' | 'color' | 'backgroundColor'): string | null {
  if (value == null || value === '')
    return null
  const candidate = text(value, kind, 160).trim()
  if (kind === 'fontFamily') {
    const families = new Set(['Inter', 'Poppins', 'Orbitron', 'Departure Mono', 'Arial', 'Georgia', 'system-ui', 'sans-serif', 'serif', 'monospace'])
    if (families.has(candidate))
      return candidate
    fail('Unsupported font family')
  }
  if (kind === 'fontSize') {
    if (/^(?:[1-9]|[1-5]\d|6[0-4])(?:px|rem|em|%)$/.test(candidate))
      return candidate
    fail('Unsupported font size')
  }
  if (/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(candidate))
    return candidate
  fail(`Unsupported ${kind}`)
}

function styleFromAttributes(attrs: Record<string, unknown> | undefined): string {
  if (!attrs)
    return ''
  const styles: string[] = []
  const textAlign = attrs.textAlign
  if (textAlign !== undefined && textAlign !== null) {
    const value = text(textAlign, 'textAlign', 16)
    if (!['left', 'center', 'right', 'justify'].includes(value))
      fail('Unsupported text alignment')
    styles.push(`text-align:${value}`)
  }
  if (attrs.lineHeight !== undefined && attrs.lineHeight !== null) {
    const value = Number(attrs.lineHeight)
    if (!Number.isFinite(value) || value < 1 || value > 3)
      fail('Unsupported line height')
    styles.push(`line-height:${value}`)
  }
  if (attrs.indent !== undefined) {
    const value = Number(attrs.indent)
    if (!Number.isInteger(value) || value < 0 || value > 8)
      fail('Unsupported indentation')
    if (value)
      styles.push(`margin-left:${value * 2}em`)
  }
  return styles.join(';')
}

function markStyle(attrs: Record<string, unknown> | undefined): string {
  if (!attrs)
    return ''
  const styles: string[] = []
  for (const kind of ['fontFamily', 'fontSize', 'color', 'backgroundColor'] as const) {
    const value = safeCssValue(attrs[kind], kind)
    if (value)
      styles.push(`${kind.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)}:${escapeHtml(value)}`)
  }
  return styles.join(';')
}

function marksFor(value: unknown): Array<{ type: string, attrs?: Record<string, unknown> }> {
  if (value == null)
    return []
  if (!Array.isArray(value))
    fail('marks must be an array')
  return value.map((mark) => {
    if (!isRecord(mark) || typeof mark.type !== 'string')
      fail('Invalid mark')
    if (mark.attrs !== undefined && !isRecord(mark.attrs))
      fail('Invalid mark attributes')
    return { type: mark.type, attrs: mark.attrs as Record<string, unknown> | undefined }
  })
}

function childrenFor(node: TiptapNode): TiptapNode[] {
  if (node.content == null)
    return []
  if (!Array.isArray(node.content))
    fail('Node content must be an array')
  return node.content.map((child) => {
    if (!isRecord(child))
      fail('Invalid document node')
    return child as TiptapNode
  })
}

function attrsFor(node: TiptapNode): Record<string, unknown> | undefined {
  if (node.attrs == null)
    return undefined
  if (!isRecord(node.attrs))
    fail('Node attributes must be an object')
  return node.attrs
}

function openTag(tag: string, attrs: Record<string, string | undefined> = {}): string {
  const rendered = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeHtml(value as string)}"`)
    .join('')
  return `<${tag}${rendered}>`
}

function applyMarks(content: string, marks: Array<{ type: string, attrs?: Record<string, unknown> }>): string {
  let result = content
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`
        break
      case 'italic':
        result = `<em>${result}</em>`
        break
      case 'strike':
        result = `<s>${result}</s>`
        break
      case 'underline':
        result = `<u>${result}</u>`
        break
      case 'code':
        result = `<code>${result}</code>`
        break
      case 'link': {
        const href = safeUrl(mark.attrs?.href, 'link href')
        const target = mark.attrs?.target == null ? undefined : text(mark.attrs.target, 'link target', 32)
        if (target && !['_blank', '_self', '_parent', '_top'].includes(target))
          fail('Unsupported link target')
        result = `${openTag('a', {
          href,
          target,
          rel: target === '_blank' ? 'noopener noreferrer' : undefined,
        }) + result}</a>`
        break
      }
      case 'textStyle': {
        const style = markStyle(mark.attrs)
        if (style)
          result = `${openTag('span', { style }) + result}</span>`
        break
      }
      case 'highlight': {
        const color = safeCssValue(mark.attrs?.color, 'backgroundColor')
        result = `${openTag('mark', color ? { style: `background-color:${escapeHtml(color)}` } : {}) + result}</mark>`
        break
      }
      default:
        fail(`Unsupported mark: ${mark.type}`)
    }
  }
  return result
}

async function renderNode(node: TiptapNode, state: RenderState, depth: number, options: Required<RenderBlogContentOptions>): Promise<string> {
  if (depth > MAX_DOCUMENT_DEPTH)
    fail('Document nesting is too deep')
  state.nodes += 1
  if (state.nodes > MAX_DOCUMENT_NODES)
    fail('Document is too large')
  const type = text(node.type, 'node type', 64)
  const attrs = attrsFor(node)
  const children = async () => {
    const rendered = []
    for (const child of childrenFor(node))
      rendered.push(await renderNode(child, state, depth + 1, options))
    return rendered.join('')
  }

  switch (type) {
    case 'doc':
      if (depth !== 0)
        fail('doc must be the root node')
      return children()
    case 'text':
      if (node.content != null)
        fail('text nodes cannot have content')
      state.text += typeof node.text === 'string' ? node.text.length : 0
      if (state.text > MAX_TEXT_LENGTH)
        fail('Document text is too large')
      return applyMarks(escapeText(node.text), marksFor(node.marks))
    case 'paragraph': {
      const style = styleFromAttributes(attrs)
      return `${openTag('p', style ? { style } : {}) + await children()}</p>`
    }
    case 'heading': {
      const level = Number(attrs?.level ?? 1)
      if (!Number.isInteger(level) || level < 1 || level > 6)
        fail('Heading level must be between 1 and 6')
      const style = styleFromAttributes(attrs)
      const id = attrs?.id == null ? undefined : text(attrs.id, 'heading id', 128)
      if (id && !/^\w[\w.:-]{0,127}$/.test(id))
        fail('Unsupported heading id')
      return `${openTag(`h${level}`, { id, style: style || undefined }) + await children()}</h${level}>`
    }
    case 'blockquote':
      return `<blockquote>${await children()}</blockquote>`
    case 'codeBlock': {
      const language = attrs?.language == null ? undefined : text(attrs.language, 'code language', 64)
      if (language && !/^[\w+-]+$/.test(language))
        fail('Unsupported code language')
      return `${openTag('pre') + openTag('code', language ? { class: `language-${language}` } : {}) + await children()}</code></pre>`
    }
    case 'hardBreak':
      return '<br>'
    case 'horizontalRule':
      return '<hr>'
    case 'bulletList':
      return `<ul>${await children()}</ul>`
    case 'taskList':
      return `<ul class="task-list" data-type="taskList">${await children()}</ul>`
    case 'orderedList': {
      const start = attrs?.start == null ? undefined : Number(attrs.start)
      if (start !== undefined && (!Number.isInteger(start) || start < 1 || start > 10_000))
        fail('Invalid ordered list start')
      return `${openTag('ol', start && start !== 1 ? { start: String(start) } : {}) + await children()}</ol>`
    }
    case 'listItem':
      return `<li>${await children()}</li>`
    case 'taskItem': {
      const checked = attrs?.checked == null ? false : attrs.checked
      if (typeof checked !== 'boolean')
        fail('Task item checked state is invalid')
      return `<li class="task-item" data-type="taskItem" data-checked="${checked ? 'true' : 'false'}"><input type="checkbox" disabled${checked ? ' checked' : ''}>${await children()}</li>`
    }
    case 'table':
      return `<table><tbody>${await children()}</tbody></table>`
    case 'tableRow':
      return `<tr>${await children()}</tr>`
    case 'tableCell':
    case 'tableHeader': {
      const tag = type === 'tableHeader' ? 'th' : 'td'
      const colspan = attrs?.colspan == null ? undefined : Number(attrs.colspan)
      const rowspan = attrs?.rowspan == null ? undefined : Number(attrs.rowspan)
      if (colspan !== undefined && (!Number.isInteger(colspan) || colspan < 1 || colspan > 20))
        fail('Invalid table colspan')
      if (rowspan !== undefined && (!Number.isInteger(rowspan) || rowspan < 1 || rowspan > 20))
        fail('Invalid table rowspan')
      return `${openTag(tag, {
        colspan: colspan && colspan > 1 ? String(colspan) : undefined,
        rowspan: rowspan && rowspan > 1 ? String(rowspan) : undefined,
      }) + await children()}</${tag}>`
    }
    case 'blogMedia': {
      const assetId = text(attrs?.assetId, 'blogMedia assetId', 128)
      if (!options.resolveMedia)
        fail('Media resolver is unavailable')
      const media = await options.resolveMedia(assetId)
      if (!media)
        fail('Referenced media asset is unavailable')
      const kind = attrs?.kind
      if (kind !== media.kind)
        fail('Referenced media kind does not match the asset')
      const alt = text(attrs?.alt ?? '', 'blogMedia alt', 500)
      const caption = attrs?.caption == null ? '' : text(attrs.caption, 'blogMedia caption', 1_000)
      const width = attrs?.width == null ? 100 : Number(attrs.width)
      if (!Number.isFinite(width) || width < 1 || width > 100)
        fail('blogMedia width must be between 1 and 100')
      const align = attrs?.align == null ? 'center' : text(attrs.align, 'blogMedia align', 16)
      if (!['left', 'center', 'right'].includes(align))
        fail('Unsupported blogMedia alignment')
      const source = options.mode === 'preview' ? media.sourceUrl : media.publicUrl
      const className = `
        blog-media
        blog-media-${align}
      `
      const wrapperStart = openTag('figure', { class: className, style: `width:${width}%` })
      if (media.kind === 'video') {
        const posterId = attrs?.posterAssetId == null ? null : text(attrs.posterAssetId, 'blogMedia posterAssetId', 128)
        let poster: string | undefined
        if (posterId) {
          const posterMedia = await options.resolveMedia(posterId)
          if (!posterMedia || (posterMedia.kind !== 'image' && posterMedia.kind !== 'gif'))
            fail('Referenced poster asset is unavailable')
          poster = options.mode === 'preview' ? posterMedia.sourceUrl : posterMedia.publicUrl
        }
        const video = `${openTag('video', {
          'controls': 'controls',
          'preload': 'metadata',
          poster,
          'src': source,
          'data-asset-id': media.id,
        })}</video>`
        return `${wrapperStart + video + (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '')}</figure>`
      }
      const image = openTag('img', {
        'src': source,
        alt,
        'loading': 'lazy',
        'decoding': 'async',
        'data-asset-id': media.id,
      })
      return `${wrapperStart + image + (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '')}</figure>`
    }
    default:
      fail(`Unsupported document node: ${type}`)
  }
}

export async function renderTiptapDocument(document: unknown, options: RenderBlogContentOptions = {}): Promise<string> {
  if (!isRecord(document) || document.type !== 'doc')
    fail('content_json must be a Tiptap document')
  const html = await renderNode(document as TiptapNode, { nodes: 0, text: 0 }, 0, {
    mode: options.mode ?? 'public',
    resolveMedia: options.resolveMedia ?? (async () => null),
  })
  if (blogByteLength(html) > BLOG_MAX_CANONICAL_BYTES)
    fail('Rendered content is too large')
  return html
}

const LEGACY_MEDIA_PATH = /^\/(?:assets|blog|media)\/[\w.~!$&'()*+,;=:@%/?#-]+$/

function decodeLegacyPath(value: string): string | null {
  let decoded = value
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded)
        return decoded
      decoded = next
    }
    catch {
      return null
    }
  }
  return decoded
}

export function normalizeLegacyMediaPath(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  const candidate = value.trim()
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || Array.from(candidate).some(character => character.charCodeAt(0) < 32))
    return null
  if (!LEGACY_MEDIA_PATH.test(candidate))
    return null
  const decoded = decodeLegacyPath(candidate)
  if (!decoded)
    return null
  const decodedPath = decoded.split(/[?#]/, 1)[0]
  if (!decodedPath)
    return null
  if (!/^\/(?:assets|blog|media)\//.test(decodedPath) || decodedPath.split('/').includes('..'))
    return null
  if (decodedPath === '/media/blog/originals' || decodedPath.startsWith('/media/blog/originals/'))
    return null
  return candidate
}

export function legacyMediaKind(value: string): 'image' | 'gif' | 'video' {
  const pathname = value.split(/[?#]/, 1)[0] || ''
  const extension = pathname.toLowerCase().split('.').pop() || ''
  if (extension === 'gif')
    return 'gif'
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv', 'ogg'].includes(extension))
    return 'video'
  return 'image'
}

export function legacyMediaPathsFromHtml(value: unknown): Set<string> {
  if (typeof value !== 'string')
    return new Set()
  const paths = new Set<string>()
  const attributes = /\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi
  for (const match of value.matchAll(attributes)) {
    const candidate = match[1]
    if (!candidate)
      continue
    const path = normalizeLegacyMediaPath(candidate)
    if (path)
      paths.add(path)
  }
  return paths
}

function normalizeHeadingId(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  const id = value.trim()
  return /^\w[\w.:-]{0,127}$/.test(id) ? id : null
}

function sanitizeHeadingTag(tagName: string, attribs: Record<string, string>) {
  const safeAttribs = { ...attribs }
  const id = normalizeHeadingId(safeAttribs.id)
  if (id)
    safeAttribs.id = id
  else
    delete safeAttribs.id
  return { tagName, attribs: safeAttribs }
}

function legacyMediaAttribute(value: unknown): boolean {
  return normalizeLegacyMediaPath(value) !== null
}

export function sanitizeLegacyBlogHtml(value: unknown): string {
  const source = text(value ?? '', 'content_html', BLOG_MAX_CANONICAL_BYTES)
  if (blogByteLength(source) > BLOG_MAX_CANONICAL_BYTES)
    fail('content_html is too large')
  const html = sanitizeHtml(source, {
    allowedTags: [
      'a',
      'article',
      'b',
      'blockquote',
      'br',
      'code',
      'del',
      'em',
      'figcaption',
      'figure',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'i',
      'img',
      'input',
      'li',
      'ol',
      'p',
      'pre',
      's',
      'source',
      'strong',
      'table',
      'tbody',
      'td',
      'tfoot',
      'th',
      'thead',
      'tr',
      'u',
      'ul',
      'video',
    ],
    allowedAttributes: {
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
      'input': ['type', 'checked', 'disabled'],
      'h1': ['id'],
      'h2': ['id'],
      'h3': ['id'],
      'h4': ['id'],
      'h5': ['id'],
      'h6': ['id'],
      'ul': ['data-type'],
      'li': ['data-type', 'data-checked'],
      'video': ['src', 'poster', 'controls', 'preload', 'width', 'height'],
      'source': ['src', 'type'],
      '*': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: {
      img: (_tagName, attribs) => {
        if (legacyMediaAttribute(attribs.src))
          return { tagName: 'img', attribs }
        const safeAttribs = { ...attribs }
        delete safeAttribs.src
        return { tagName: 'img', attribs: safeAttribs }
      },
      video: (_tagName, attribs) => {
        const safeAttribs = { ...attribs }
        if (!legacyMediaAttribute(safeAttribs.src))
          delete safeAttribs.src
        if (!legacyMediaAttribute(safeAttribs.poster))
          delete safeAttribs.poster
        return { tagName: 'video', attribs: safeAttribs }
      },
      source: (_tagName, attribs) => {
        if (legacyMediaAttribute(attribs.src))
          return { tagName: 'source', attribs }
        const safeAttribs = { ...attribs }
        delete safeAttribs.src
        return { tagName: 'source', attribs: safeAttribs }
      },
      input: (_tagName, attribs) => {
        const safeAttribs: Record<string, string> = { type: 'checkbox', disabled: 'disabled' }
        if (attribs.checked !== undefined)
          safeAttribs.checked = 'checked'
        return { tagName: 'input', attribs: safeAttribs }
      },
      h1: (_tagName, attribs) => sanitizeHeadingTag('h1', attribs),
      h2: (_tagName, attribs) => sanitizeHeadingTag('h2', attribs),
      h3: (_tagName, attribs) => sanitizeHeadingTag('h3', attribs),
      h4: (_tagName, attribs) => sanitizeHeadingTag('h4', attribs),
      h5: (_tagName, attribs) => sanitizeHeadingTag('h5', attribs),
      h6: (_tagName, attribs) => sanitizeHeadingTag('h6', attribs),
    },
  })
  if (blogByteLength(html) > BLOG_MAX_CANONICAL_BYTES)
    fail('Sanitized content is too large')
  return html
}

export function snapshotDraft(draft: Record<string, unknown>): string {
  return JSON.stringify({
    version: draft.version,
    schema_version: draft.schema_version,
    title: draft.title,
    slug: draft.slug,
    excerpt: draft.excerpt,
    category_id: draft.category_id ?? null,
    tag_ids: Array.isArray(draft.tag_ids) ? draft.tag_ids : [],
    cover_image_url: draft.cover_image_url ?? null,
    cover_image_alt: draft.cover_image_alt ?? null,
    read_minutes: draft.read_minutes,
    meta_title: draft.meta_title ?? null,
    meta_description: draft.meta_description ?? null,
    content_json: draft.content_json ?? null,
    content_html: draft.content_html,
    updated_at: draft.updated_at,
  })
}
