import type { BlogMediaAttrs } from '@/utils/blog-studio'
import { mergeAttributes, Node } from '@tiptap/vue-3'

export const BlogMedia = Node.create({
  name: 'blogMedia',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      assetId: { default: '' },
      kind: { default: 'image' },
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
      width: { default: 100 },
      align: { default: 'left' },
      posterAssetId: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-blog-media]',
        getAttrs: (element: HTMLElement) => {
          const node = element
          const media = node.querySelector('img,video') as HTMLImageElement | HTMLVideoElement | null
          return {
            assetId: node.dataset.assetId ?? '',
            kind: node.dataset.kind ?? (media?.tagName.toLowerCase() === 'video' ? 'video' : 'image'),
            src: media?.getAttribute('src') ?? '',
            alt: media?.getAttribute('alt') ?? '',
            caption: node.querySelector('figcaption')?.textContent ?? '',
            width: Number.parseInt(node.style.width || '100', 10),
            align: node.dataset.align ?? 'left',
            posterAssetId: media?.getAttribute('data-poster-asset-id') ?? undefined,
          }
        },
      },
      { tag: 'img[data-blog-media]' },
      { tag: 'video[data-blog-media]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as BlogMediaAttrs
    const width = Math.max(1, Math.min(100, Number(attrs.width) || 100))
    const align = attrs.align === 'center' ? 'center' : attrs.align === 'right' ? 'right' : 'left'
    const mediaAttrs = {
      src: attrs.src,
      alt: attrs.alt,
      loading: 'lazy',
      controls: attrs.kind === 'video' ? 'controls' : undefined,
      poster: attrs.posterAssetId || undefined,
    }
    const media = attrs.kind === 'video'
      ? ['video', mergeAttributes(mediaAttrs, { 'data-blog-media': 'true', 'data-poster-asset-id': attrs.posterAssetId, 'playsinline': 'true' })]
      : ['img', mergeAttributes(mediaAttrs, { 'data-blog-media': 'true' })]
    const children: unknown[] = [media]
    if (attrs.caption)
      children.push(['figcaption', {}, attrs.caption])
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-blog-media': 'true',
      'data-asset-id': attrs.assetId,
      'data-kind': attrs.kind,
      'data-align': align,
      'style': `width:${width}%;margin-inline:${align === 'center' ? 'auto' : align === 'right' ? '0 0' : '0 auto'};`,
    }), children]
  },
})
