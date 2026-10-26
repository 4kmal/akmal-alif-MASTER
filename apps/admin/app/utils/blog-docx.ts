import type { IParagraphOptions, IRunOptions, ParagraphChild } from 'docx'
import DOMPurify from 'dompurify'

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }
interface ZipEntryStream {
  on: (event: string, callback: (...args: any[]) => void) => ZipEntryStream
  pause: () => void
  resume: () => void
}

const DOCX_INPUT_LIMIT = 20 * 1024 * 1024
const DOCX_EXPANDED_LIMIT = 100 * 1024 * 1024
const HTML_LIMIT = 512 * 1024

export interface ImportedBlogImage {
  placeholder: string
  blob: Blob
  alt: string
}

export interface ImportedBlogDocument {
  html: string
  messages: string[]
  images: ImportedBlogImage[]
}

export function sanitizeImportedBlogHtml(html: string) {
  const purifier = typeof DOMPurify.sanitize === 'function' ? DOMPurify : DOMPurify(window)
  return purifier.sanitize(html, {
    ALLOWED_TAGS: ['p', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'span', 'mark', 'br', 'hr', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'figure', 'figcaption', 'video', 'source', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'style', 'id', 'width', 'height', 'colspan', 'rowspan', 'start', 'controls', 'poster', 'type', 'data-asset-id', 'data-kind', 'data-blog-media', 'data-poster-asset-id', 'data-indent'],
    ALLOW_DATA_ATTR: false,
  })
}

export async function importBlogDocx(file: File): Promise<ImportedBlogDocument> {
  if (!/\.docx$/i.test(file.name) || file.size > DOCX_INPUT_LIMIT)
    throw new Error('Choose a DOCX file no larger than 20 MiB.')
  const data = await file.arrayBuffer()
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(data)
  const entries = Object.values(zip.files).filter(entry => !entry.dir)
  if (!zip.file('word/document.xml') || entries.length > 2000)
    throw new Error('This file is not a supported Word document.')
  let expanded = 0
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as unknown as { internalStream: (type: 'uint8array') => ZipEntryStream }).internalStream('uint8array')
      stream.on('data', (chunk: Uint8Array) => {
        expanded += chunk.byteLength
        if (expanded > DOCX_EXPANDED_LIMIT) {
          stream.pause()
          reject(new Error('The expanded document exceeds the 100 MiB import limit.'))
        }
      }).on('error', reject).on('end', () => resolve()).resume()
    })
  }
  const module = await import('mammoth')
  const mammoth = module.default
  const images: ImportedBlogImage[] = []
  const conversionWarnings: string[] = []
  const result = await mammoth.convertToHtml({ arrayBuffer: data }, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    styleMap: ['p[style-name=\'Heading 1\'] => h2:fresh', 'p[style-name=\'Heading 2\'] => h3:fresh', 'p[style-name=\'Heading 3\'] => h4:fresh'],
    convertImage: mammoth.images.imgElement(async (image) => {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.contentType)) {
        conversionWarnings.push(`An embedded ${image.contentType} image could not be imported. Replace it with PNG, JPEG, GIF or WebP.`)
        return { src: '' }
      }
      const bytes = await image.readAsArrayBuffer()
      const placeholder = `/__blog_import_image/${images.length}`
      images.push({ placeholder, blob: new Blob([bytes], { type: image.contentType }), alt: (image as typeof image & { altText?: string }).altText || '' })
      return { src: placeholder }
    }),
  })
  if (new TextEncoder().encode(result.value).byteLength > HTML_LIMIT)
    throw new Error('The document is too large for a blog article. Split it into smaller articles.')
  const html = sanitizeImportedBlogHtml(result.value)
  const messages = [...result.messages.map(message => message.message), ...conversionWarnings]
  if (html !== result.value)
    messages.push('Unsupported or unsafe markup was removed. Review the imported article before applying it.')
  messages.push('Word pagination, headers and footers are not part of the web article layout. Review tables and media before applying.')
  return { html, messages: [...new Set(messages)], images }
}

function hexColor(value: string) {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex)
    return (hex.length === 3 ? [...hex].map(letter => letter + letter).join('') : hex).toUpperCase()
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  return rgb ? rgb.slice(1, 4).map(number => Math.min(255, Number(number)).toString(16).padStart(2, '0')).join('').toUpperCase() : undefined
}

export async function exportBlogDocx(options: {
  title: string
  html: string
  resolveImage: (src: string) => Promise<Blob | null>
}): Promise<Blob> {
  const docx = await import('docx')
  const { Document: WordDocument, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, WidthType, HeadingLevel, AlignmentType, BorderStyle, LevelFormat, Packer } = docx
  const parsed = new DOMParser().parseFromString(sanitizeImportedBlogHtml(options.html), 'text/html')
  type Block = InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  const origin = /^https?:/.test(window.location.origin) ? window.location.origin : 'http://localhost'

  async function imageRuns(element: Element): Promise<ParagraphChild[]> {
    const src = element.getAttribute('src') || ''
    if (!src)
      return []
    const url = new URL(src, origin)
    if (url.origin !== origin)
      return [new TextRun({ text: element.getAttribute('alt') || 'External image' })]
    const blob = await options.resolveImage(src)
    if (!blob)
      return [new ExternalHyperlink({ link: url.href, children: [new TextRun({ text: element.getAttribute('alt') || 'View image', style: 'Hyperlink' })] })]
    let imageBlob = blob
    let imageType: 'png' | 'jpg' | 'gif' | 'bmp' = blob.type === 'image/jpeg' ? 'jpg' : 'png'
    const image = await createImageBitmap(blob)
    const widthAttribute = element.getAttribute('width') || ''
    const parsedWidth = Number.parseFloat(widthAttribute)
    const requestedWidth = Number.isFinite(parsedWidth) && parsedWidth > 0 ? (widthAttribute.endsWith('%') ? 600 * parsedWidth / 100 : parsedWidth) : 600
    const scale = Math.min(1, Math.min(600, Math.max(20, requestedWidth)) / image.width)
    const dimensions = { width: Math.round(image.width * scale), height: Math.round(image.height * scale) }
    if (!['image/png', 'image/jpeg'].includes(blob.type)) {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (!context)
        throw new Error('The image could not be converted for Word export.')
      context.drawImage(image, 0, 0)
      imageBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed.')), 'image/png'))
      imageType = 'png'
    }
    image.close()
    const runs: ParagraphChild[] = [new ImageRun({ type: imageType, data: await imageBlob.arrayBuffer(), transformation: dimensions, altText: { title: element.getAttribute('alt') || '', description: element.getAttribute('alt') || '', name: 'Blog image' } })]
    if (blob.type === 'image/gif')
      runs.push(new ExternalHyperlink({ link: url.href, children: [new TextRun({ text: 'View animated GIF', style: 'Hyperlink' })] }))
    return runs
  }

  async function inline(node: Node, inherited: IRunOptions = {}): Promise<ParagraphChild[]> {
    if (node.nodeType === 3)
      return [new TextRun({ ...inherited, text: node.textContent || '' })]
    if (node.nodeType !== 1)
      return []
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (tag === 'br')
      return [new TextRun({ break: 1 })]
    if (tag === 'img')
      return imageRuns(element)
    if (tag === 'video') {
      const target = element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || ''
      const runs: ParagraphChild[] = []
      const poster = element.getAttribute('poster')
      if (poster) {
        const image = parsed.createElement('img')
        image.setAttribute('src', poster)
        image.setAttribute('alt', 'Video poster')
        runs.push(...await imageRuns(image))
      }
      if (target) {
        const link = new URL(target, origin)
        if (['https:', 'http:'].includes(link.protocol))
          runs.push(new ExternalHyperlink({ link: link.href, children: [new TextRun({ text: 'Watch video', style: 'Hyperlink' })] }))
      }
      return runs
    }
    const style: Mutable<IRunOptions> = { ...inherited }
    if (['b', 'strong', 'th'].includes(tag))
      style.bold = true
    if (['i', 'em'].includes(tag))
      style.italics = true
    if (tag === 'u')
      style.underline = {}
    if (['s', 'strike'].includes(tag))
      style.strike = true
    if (tag === 'sup')
      style.superScript = true
    if (tag === 'sub')
      style.subScript = true
    if (['code', 'pre'].includes(tag))
      style.font = 'Courier New'
    if (element.style.fontFamily)
      style.font = element.style.fontFamily.replace(/["']/g, '').split(',')[0]!.trim()
    if (element.style.fontSize) {
      const size = Number.parseFloat(element.style.fontSize) * (element.style.fontSize.endsWith('px') ? 0.75 : 1)
      if (Number.isFinite(size))
        style.size = Math.round(size * 2)
    }
    const color = hexColor(element.style.color)
    const background = hexColor(element.style.backgroundColor)
    if (color)
      style.color = color
    if (background)
      style.shading = { fill: background }
    const children: ParagraphChild[] = []
    for (const child of element.childNodes)
      children.push(...await inline(child, style))
    if (tag === 'a') {
      try {
        const target = new URL(element.getAttribute('href') || '', origin)
        if (['https:', 'http:', 'mailto:'].includes(target.protocol))
          return [new ExternalHyperlink({ link: target.href, children })]
      }
      catch {
        return children
      }
    }
    return children
  }

  async function blocks(parent: Element, list?: { ordered: boolean, level: number }): Promise<Block[]> {
    const result: Block[] = []
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) {
        if (node.textContent?.trim())
          result.push(new Paragraph({ children: await inline(node) }))
        continue
      }
      if (node.nodeType !== 1)
        continue
      const element = node as HTMLElement
      const tag = element.tagName.toLowerCase()
      if (tag === 'hr') {
        result.push(new Paragraph({ border: { bottom: { color: '808080', style: BorderStyle.SINGLE, size: 6 } }, spacing: { before: 160, after: 160 } }))
        continue
      }
      if (['ul', 'ol'].includes(tag)) {
        result.push(...await blocks(element, { ordered: tag === 'ol', level: Math.min(8, list ? list.level + 1 : 0) }))
        continue
      }
      if (tag === 'table') {
        const rows: InstanceType<typeof TableRow>[] = []
        for (const row of element.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr')) {
          const cells: InstanceType<typeof TableCell>[] = []
          for (const cell of row.children) {
            const children = await blocks(cell)
            cells.push(new TableCell({ children: children.length ? children : [new Paragraph({ children: await inline(cell) })], columnSpan: Math.max(1, Number(cell.getAttribute('colspan')) || 1), rowSpan: Math.max(1, Number(cell.getAttribute('rowspan')) || 1) }))
          }
          rows.push(new TableRow({ children: cells }))
        }
        result.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
        continue
      }
      if (['div', 'figure', 'section', 'tbody', 'thead', 'tfoot'].includes(tag)) {
        result.push(...await blocks(element, list))
        continue
      }
      const children: ParagraphChild[] = []
      if (tag === 'li') {
        for (const child of element.childNodes) {
          if (child.nodeType !== 1 || !['ul', 'ol'].includes((child as Element).tagName.toLowerCase()))
            children.push(...await inline(child))
        }
      }
      else {
        children.push(...await inline(element))
      }
      const paragraph: Mutable<IParagraphOptions> = { children, spacing: { after: 160, line: 300 } }
      const lineHeight = Number(element.style.lineHeight)
      if (Number.isFinite(lineHeight) && lineHeight >= 1 && lineHeight <= 3)
        paragraph.spacing = { after: 160, line: Math.round(lineHeight * 240) }
      const indent = Number(element.getAttribute('data-indent'))
      if (Number.isInteger(indent) && indent > 0 && indent <= 8)
        paragraph.indent = { left: 360 * indent }
      if (/^h[2-4]$/.test(tag))
        paragraph.heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][Number(tag[1]) - 2]
      const alignment = element.style.textAlign
      if (alignment)
        paragraph.alignment = alignment === 'center' ? AlignmentType.CENTER : alignment === 'right' ? AlignmentType.RIGHT : alignment === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT
      if (tag === 'blockquote')
        paragraph.indent = { left: 360 }
      if (tag === 'li' && list) {
        if (list.ordered)
          paragraph.numbering = { reference: 'blog-numbering', level: list.level }
        else
          paragraph.bullet = { level: list.level }
      }
      result.push(new Paragraph(paragraph))
      if (tag === 'li') {
        for (const nested of element.children) {
          if (['ul', 'ol'].includes(nested.tagName.toLowerCase())) {
            const wrapper = parsed.createElement('div')
            wrapper.appendChild(nested.cloneNode(true))
            result.push(...await blocks(wrapper, list))
          }
        }
      }
    }
    return result
  }

  const children: Block[] = [new Paragraph({ text: options.title, heading: HeadingLevel.TITLE }), ...await blocks(parsed.body)]
  const wordDocument = new WordDocument({
    title: options.title,
    creator: 'Akmal Alif',
    numbering: { config: [{ reference: 'blog-numbering', levels: Array.from({ length: 9 }, (_, level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, start: 1, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 180 } } } })) }] },
    sections: [{ children }],
  })
  return Packer.toBlob(wordDocument)
}
