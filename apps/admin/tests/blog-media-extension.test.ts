import StarterKit from '@tiptap/starter-kit'
// @vitest-environment jsdom
import { Editor } from '@tiptap/vue-3'
import { describe, expect, it } from 'vitest'
import { BlogMedia } from '../app/utils/blog-media-extension'

describe('blog media editor roundtrip', () => {
  it('serializes a real figure with an escaped caption and restores its media identity', () => {
    const editor = new Editor({ extensions: [StarterKit, BlogMedia], content: { type: 'doc', content: [{ type: 'blogMedia', attrs: { assetId: 'asset-one', kind: 'video', src: '/api/admin/blog/media/asset-one/source', alt: 'Demo', caption: '<A demo>', width: 60, align: 'right', posterAssetId: 'poster-one' } }] } })
    const html = editor.getHTML()
    expect(html).toContain('data-asset-id="asset-one"')
    expect(html).toContain('<figcaption>&lt;A demo&gt;</figcaption>')
    expect(html).toContain('margin-inline: auto 0')
    expect(html).toContain('/api/admin/blog/media/poster-one/source')
    editor.commands.setContent(html)
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ assetId: 'asset-one', kind: 'video', caption: '<A demo>', width: 60, align: 'right', posterAssetId: 'poster-one' })
    editor.destroy()
  })
  it('reads bare uploaded image attributes instead of inserting an empty node', () => {
    const editor = new Editor({ extensions: [StarterKit, BlogMedia], content: '<img data-blog-media="true" data-asset-id="gif-one" data-kind="gif" src="/api/admin/blog/media/gif-one/source" alt="An animated diagram">' })
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ assetId: 'gif-one', kind: 'gif', alt: 'An animated diagram', src: '/api/admin/blog/media/gif-one/source' })
    editor.destroy()
  })
})
