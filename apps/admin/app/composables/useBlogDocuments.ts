import type { BlogAsset } from '@/utils/blog-studio'
import { convertLegacyHtmlToTiptap } from '@/composables/useBlogLegacyConversion'
import { useBlogMediaUpload } from '@/composables/useBlogMediaUpload'

export interface BlogDocxImportReview {
  html: string
  messages: string[]
  assets: BlogAsset[]
  document: ReturnType<typeof convertLegacyHtmlToTiptap>
}

export function useBlogDocuments(onAsset?: (asset: BlogAsset) => void) {
  const uploads = useBlogMediaUpload(onAsset)

  async function importDocx(file: File): Promise<BlogDocxImportReview> {
    const adapter = await import('@/utils/blog-docx')
    const imported = await adapter.importBlogDocx(file)
    const parsed = new DOMParser().parseFromString(imported.html, 'text/html')
    const assets: BlogAsset[] = []
    for (const [index, image] of imported.images.entries()) {
      const mime = image.blob.type || 'image/png'
      const extension = ({ 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[mime] || 'png'
      const task = await uploads.upload(new File([image.blob], `docx-image-${index + 1}.${extension}`, { type: mime, lastModified: file.lastModified }))
      if (task.status !== 'complete' || !task.asset)
        throw new Error(`DOCX image ${image.placeholder} could not be uploaded completely. Fix the upload and retry the import.`)
      assets.push(task.asset)
      for (const element of parsed.querySelectorAll('img')) {
        if (element.getAttribute('src') !== image.placeholder)
          continue
        element.setAttribute('src', task.asset.source_url)
        element.setAttribute('data-asset-id', task.asset.id)
        element.setAttribute('data-kind', task.asset.kind)
        if (image.alt)
          element.setAttribute('alt', image.alt)
      }
    }
    const html = parsed.body.innerHTML
    return { html, messages: imported.messages, assets, document: convertLegacyHtmlToTiptap(html) }
  }

  async function exportDocx(title: string, html: string, resolveImage: (src: string) => Promise<Blob | null>) {
    const adapter = await import('@/utils/blog-docx')
    return adapter.exportBlogDocx({ title, html, resolveImage })
  }

  return { ...uploads, importDocx, exportDocx }
}
