/* @vitest-environment jsdom */
import StarterKit from '@tiptap/starter-kit'
import { Editor } from '@tiptap/vue-3'
import { describe, expect, it } from 'vitest'
import { convertLegacyHtmlToTiptap } from '../app/composables/useBlogLegacyConversion'
import { BlogGallery, BlogYouTube } from '../app/utils/blog-media-extension'

describe('blog gallery and YouTube nodes', () => {
  it('round trips a gallery manifest reference without accepting arbitrary markup', () => {
    const editor = new Editor({
      extensions: [StarterKit, BlogGallery],
      content: { type: 'doc', content: [{ type: 'blogGallery', attrs: { manifestId: 'gallery-revision-1' } }] },
    })
    expect(editor.getJSON().content?.[0]?.attrs?.manifestId).toBe('gallery-revision-1')
    expect(editor.getHTML()).toContain('data-blog-gallery="true"')
    expect(editor.getHTML()).toContain('data-gallery-manifest-id="gallery-revision-1"')
    editor.destroy()
  })

  it('accepts the four shared video IDs and emits a no-cookie embed', () => {
    for (const videoId of ['hez2yR4GyTA', 'Lk7qlmClqhw', 'M0n6kiUxZgA', 'jCXWIQ74Jlg']) {
      const editor = new Editor({
        extensions: [StarterKit, BlogYouTube],
        content: { type: 'doc', content: [{ type: 'blogYouTube', attrs: { videoId, title: 'Intro' } }] },
      })
      expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ videoId, title: 'Intro' })
      expect(editor.getHTML()).toContain(`youtube-nocookie.com/embed/${videoId}`)
      expect(editor.getHTML()).not.toContain('javascript:')
      editor.destroy()
    }
  })

  it('keeps legacy gallery and YouTube references during schema-1 restoration review', () => {
    const result = convertLegacyHtmlToTiptap('<figure data-blog-gallery data-manifest-id="gallery-1"></figure><figure data-blog-youtube data-video-id="M0n6kiUxZgA" data-title="Demo"></figure>')
    expect(result.document.content?.map(node => node.type)).toEqual(['blogGallery', 'blogYouTube'])
    expect(result.issues).toEqual([])
  })
})
