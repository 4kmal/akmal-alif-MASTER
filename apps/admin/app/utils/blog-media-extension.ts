import type { DOMOutputSpec } from '@tiptap/pm/model'
import type { BlogMediaAttrs } from '@/utils/blog-studio'
import { mergeAttributes, Node } from '@tiptap/vue-3'
import { normalizeYouTubeVideoId } from '@/utils/content-calendar'

function readMediaAttributes(element: HTMLElement) {
  const figure = element.tagName.toLowerCase() === 'figure' ? element : null
  const media = figure?.querySelector('img,video') as HTMLElement | null ?? element
  return {
    assetId: element.dataset.assetId || media.dataset.assetId || '',
    kind: element.dataset.kind || media.dataset.kind || (media.tagName.toLowerCase() === 'video' ? 'video' : 'image'),
    src: media.getAttribute('src') || media.querySelector('source')?.getAttribute('src') || '',
    alt: media.getAttribute('alt') || '',
    caption: figure?.querySelector('figcaption')?.textContent || '',
    width: Number.parseInt(element.style.width || element.getAttribute('width') || '100', 10),
    align: element.dataset.align || 'left',
    posterAssetId: media.getAttribute('data-poster-asset-id') || undefined,
  }
}

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
        getAttrs: readMediaAttributes,
      },
      { tag: 'img[data-blog-media]', getAttrs: readMediaAttributes },
      { tag: 'video[data-blog-media]', getAttrs: readMediaAttributes },
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
      poster: attrs.posterAssetId ? `/api/admin/blog/media/${encodeURIComponent(attrs.posterAssetId)}/source` : undefined,
    }
    const media: DOMOutputSpec = attrs.kind === 'video'
      ? ['video', mergeAttributes(mediaAttrs, { 'data-blog-media': 'true', 'data-poster-asset-id': attrs.posterAssetId, 'playsinline': 'true' })]
      : ['img', mergeAttributes(mediaAttrs, { 'data-blog-media': 'true' })]
    const children: DOMOutputSpec[] = [media]
    if (attrs.caption)
      children.push(['figcaption', {}, attrs.caption])
    return ['figure', mergeAttributes(HTMLAttributes, {
      'data-blog-media': 'true',
      'data-asset-id': attrs.assetId,
      'data-kind': attrs.kind,
      'data-align': align,
      'style': `width:${width}%;margin-inline:${align === 'center' ? 'auto' : align === 'right' ? 'auto 0' : '0 auto'};`,
    }), ...children]
  },
})

export const BlogGallery = Node.create({
  name: 'blogGallery',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      manifestId: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'figure[data-blog-gallery]',
      getAttrs: (element: HTMLElement) => ({ manifestId: element.dataset.manifestId || '' }),
    }]
  },

  renderHTML({ HTMLAttributes }) {
    const manifestId = typeof HTMLAttributes.manifestId === 'string' ? HTMLAttributes.manifestId : ''
    return ['figure', mergeAttributes({ 'data-blog-gallery': 'true', 'data-manifest-id': manifestId }, HTMLAttributes), [
      'div',
      {
        'class': 'blog-gallery-node',
        'data-gallery-manifest-id': manifestId,
      },
      manifestId ? `Gallery ${manifestId}` : 'Gallery placeholder',
    ]]
  },
})

export const BlogYouTube = Node.create({
  name: 'blogYouTube',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      videoId: { default: '' },
      title: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'figure[data-blog-youtube]',
      getAttrs: (element: HTMLElement) => ({
        videoId: normalizeYouTubeVideoId(element.dataset.videoId) ?? '',
        title: element.dataset.title || element.querySelector('figcaption')?.textContent || '',
      }),
    }]
  },

  renderHTML({ HTMLAttributes }) {
    const videoId = normalizeYouTubeVideoId(HTMLAttributes.videoId) ?? ''
    const title = typeof HTMLAttributes.title === 'string' ? HTMLAttributes.title : ''
    if (!videoId) {
      return ['figure', { 'data-blog-youtube': 'true', 'data-video-id': '' }, [
        'div',
        { class: 'blog-youtube-node blog-youtube-node--invalid' },
        'YouTube video ID is invalid',
      ]]
    }
    const iframe: DOMOutputSpec = ['iframe', {
      'src': `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
      'title': title || 'YouTube video',
      'loading': 'lazy',
      'referrerpolicy': 'strict-origin-when-cross-origin',
      'allow': 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      'allowfullscreen': 'true',
      'data-blog-youtube': 'true',
      'data-video-id': videoId,
    }]
    const children: DOMOutputSpec[] = [iframe]
    if (title)
      children.push(['figcaption', {}, title])
    return ['figure', mergeAttributes({ 'data-blog-youtube': 'true', 'data-video-id': videoId, 'data-title': title }, HTMLAttributes), ...children]
  },
})
