/* @vitest-environment jsdom */
import StarterKit from '@tiptap/starter-kit'
import { Editor } from '@tiptap/vue-3'
import { describe, expect, it } from 'vitest'
import { convertLegacyHtmlToTiptap } from '../app/composables/useBlogLegacyConversion'
import { BlogDiagram, BlogGallery, BlogYouTube } from '../app/utils/blog-media-extension'

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

  it('previews an approved diagram from the repo asset path and refuses unknown keys', () => {
    const editor = new Editor({
      extensions: [StarterKit, BlogDiagram],
      content: { type: 'doc', content: [
        { type: 'blogDiagram', attrs: { diagramKey: 'publictransport-live-data', caption: 'Figure 1' } },
        { type: 'blogDiagram', attrs: { diagramKey: '../../secrets', caption: 'x' } },
      ] },
    })
    const html = editor.getHTML()
    expect(html).toContain('src="/assets/blog/diagrams/publictransport-live-data.svg"')
    expect(html).toContain('<figcaption>Figure 1</figcaption>')
    expect(html).toContain('Diagram is not in the approved list')
    expect(html).not.toContain('secrets')
    editor.destroy()
  })

  it('keeps approved diagram references during legacy restoration and skips unknown ones', () => {
    const result = convertLegacyHtmlToTiptap('<figure data-blog-diagram data-diagram-key="publictransport-live-data" data-caption="How it works"></figure><figure data-blog-diagram data-diagram-key="nope"></figure>')
    expect(result.document.content?.map(node => node.type)).toEqual(['blogDiagram'])
    expect(result.document.content?.[0]?.attrs).toMatchObject({ diagramKey: 'publictransport-live-data', caption: 'How it works' })
    expect(result.issues).toEqual([{ tag: 'diagram', message: 'Diagram that is not in the approved list was skipped.', count: 1 }])
  })
})
