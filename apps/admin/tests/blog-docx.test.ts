import { Buffer, File as NodeFile } from 'node:buffer'
// @vitest-environment jsdom
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBlogDocx, importBlogDocx, sanitizeImportedBlogHtml } from '../app/utils/blog-docx'

vi.mock('mammoth', async () => {
  const module = await vi.importActual<typeof import('mammoth')>('mammoth')
  return { default: { ...module.default, convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options: object) => module.default.convertToHtml({ buffer: Buffer.from(input.arrayBuffer) }, options) } }
})

describe('word document interchange', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('exports real DOCX headings, formatting, links, lists and tables and imports it for review', async () => {
    const output = await exportBlogDocx({
      title: 'Studio roundtrip',
      html: '<h2>Section</h2><p><strong>Bold</strong> and <em>italic</em> <a href="https://www.akmalalif.com/blogs">archive</a>.</p><ol><li>First</li><li>Second</li></ol><table><tbody><tr><th>Topic</th><th>Value</th></tr><tr><td>Media</td><td>Private</td></tr></tbody></table>',
      resolveImage: async () => null,
    })
    expect(output.type).toContain('officedocument')
    const zip = await JSZip.loadAsync(await output.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('text')
    expect(xml).toContain('w:tbl')
    expect(xml).toContain('w:numPr')
    expect(xml).toContain('Heading1')
    const file = new NodeFile([await output.arrayBuffer()], 'roundtrip.docx', { type: output.type }) as File
    const result = await importBlogDocx(file)
    expect(result.html).toContain('<h2>Section</h2>')
    expect(result.html).toContain('<strong>Bold</strong>')
    expect(result.html).toContain('<table>')
    expect(result.html).toContain('https://www.akmalalif.com/blogs')
    expect(result.messages.join(' ')).toContain('pagination')
  })

  it('removes executable imported markup and keeps safe article formatting', () => {
    const html = sanitizeImportedBlogHtml('<h2 id="chapter">Chapter</h2><p onclick="alert(1)">Text<script>alert(1)</script><a href="javascript:alert(1)">link</a><img src="x" onerror="alert(2)"></p><iframe src="https://evil.example"></iframe>')
    expect(html).toContain('id="chapter"')
    expect(html).not.toMatch(/script|onclick|onerror|iframe|javascript:/)
  })

  it('rejects wrong formats and ZIP containers without a Word document', async () => {
    await expect(importBlogDocx(new NodeFile(['text'], 'draft.txt') as File)).rejects.toThrow('DOCX')
    const zip = new JSZip()
    zip.file('payload.txt', 'not a Word document')
    await expect(importBlogDocx(new NodeFile([await zip.generateAsync({ type: 'arraybuffer' })], 'fake.docx') as File)).rejects.toThrow('not a supported')
  })

  it('never fetches an external image and represents video with a destination link', async () => {
    const resolveImage = vi.fn(async () => null)
    const output = await exportBlogDocx({ title: 'Media', html: '<p><img src="https://other.example/private.png" alt="External illustration"></p><video src="/media/blog/clip.mp4" controls></video>', resolveImage })
    expect(resolveImage).not.toHaveBeenCalled()
    const zip = await JSZip.loadAsync(await output.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('text')
    const relationships = await zip.file('word/_rels/document.xml.rels')!.async('text')
    expect(xml).toContain('External illustration')
    expect(xml).toContain('Watch video')
    expect(relationships).toContain('/media/blog/clip.mp4')
  })

  it('preserves rules and exports finite image extents even with invalid authored widths', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 32, height: 16, close() {} }))
    const output = await exportBlogDocx({ title: 'Layout', html: '<hr><p><img src="/media/blog/test.png" width="bad%" alt="Illustration"></p>', resolveImage: async () => new Blob(['png'], { type: 'image/png' }) })
    const zip = await JSZip.loadAsync(await output.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('text')
    expect(xml).toContain('w:pBdr')
    expect(xml).not.toMatch(/NaN|Infinity/)
    expect(xml).toContain('Illustration')
  })
})
