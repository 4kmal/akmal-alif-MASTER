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
    let html = imported.html
    const assets: BlogAsset[] = []
    for (const image of imported.images) {
      const task = await uploads.upload(new File([image.blob], `${image.placeholder}.bin`, { type: image.blob.type || 'image/png' }))
      if (task.status !== 'complete' || !task.asset)
        throw new Error(`DOCX image ${image.placeholder} could not be uploaded completely. Fix the upload and retry the import.`)
      assets.push(task.asset)
      const escaped = image.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      html = html.replace(new RegExp(escaped, 'g'), `<img src="${task.asset.source_url}" data-asset-id="${task.asset.id}" alt="${image.alt.replace(/"/g, '&quot;')}">`)
    }
    return { html, messages: imported.messages, assets, document: convertLegacyHtmlToTiptap(html) }
  }

  async function exportDocx(title: string, html: string, resolveImage: (src: string) => Promise<Blob | null>) {
    const adapter = await import('@/utils/blog-docx')
    return adapter.exportBlogDocx({ title, html, resolveImage })
  }

  return { ...uploads, importDocx, exportDocx }
}
