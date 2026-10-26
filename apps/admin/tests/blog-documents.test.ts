// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useBlogDocuments } from '../app/composables/useBlogDocuments'

const upload = vi.hoisted(() => vi.fn())
vi.mock('../app/composables/useBlogMediaUpload', () => ({ useBlogMediaUpload: () => ({ upload }) }))
vi.mock('../app/utils/blog-docx', () => ({
  importBlogDocx: async () => ({ html: '<p>Picture: <img src="/__blog_import_image/0" alt="Original caption"></p>', images: [{ placeholder: '/__blog_import_image/0', blob: new Blob(['image'], { type: 'image/png' }), alt: 'A "quoted" image' }], messages: ['Review before applying'] }),
}))

describe('embedded Word images', () => {
  it('replaces the image source without nesting HTML inside a src attribute', async () => {
    upload.mockResolvedValue({ status: 'complete', asset: { id: 'uploaded-image', kind: 'image', source_url: '/api/admin/blog/media/uploaded-image/source' } })
    const result = await useBlogDocuments().importDocx(new File(['document'], 'article.docx', { lastModified: 1000 }))
    const parsed = new DOMParser().parseFromString(result.html, 'text/html')
    const image = parsed.querySelector('img')!
    expect(parsed.querySelectorAll('img')).toHaveLength(1)
    expect(image.getAttribute('src')).toBe('/api/admin/blog/media/uploaded-image/source')
    expect(image.getAttribute('alt')).toBe('A "quoted" image')
    expect(image.dataset.assetId).toBe('uploaded-image')
    expect(result.document.document.content?.some(node => node.type === 'blogMedia' && node.attrs?.assetId === 'uploaded-image')).toBe(true)
    expect((upload.mock.calls[0]![0] as File).lastModified).toBe(1000)
  })
})
