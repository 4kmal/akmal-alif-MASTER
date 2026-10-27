/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { useBlogEditor } from '../app/composables/useBlogEditor'

function mountEditor(onSelectionUpdate: (assetId: string | null) => void) {
  let editorState!: ReturnType<typeof useBlogEditor>
  const onUpdate = vi.fn()
  const app = createApp(defineComponent({
    setup() {
      editorState = useBlogEditor({
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Select a block' }] },
            { type: 'blogMedia', attrs: { assetId: 'meme-asset', kind: 'image', src: '/media/meme.webp', alt: 'Approved meme', caption: '', width: 100, align: 'left' } },
          ],
        },
        onUpdate,
        onSelectionUpdate(editor) {
          const selection = editor.state.selection
          onSelectionUpdate(selection.node?.type.name === 'blogMedia' ? String(selection.node.attrs.assetId) : null)
        },
      })
      return () => h('div')
    },
  }))
  const host = document.createElement('div')
  document.body.append(host)
  app.mount(host)
  return { app, editorState, onUpdate }
}

describe('blog editor selection lifecycle', () => {
  it('refreshes media selection without treating selection-only transactions as edits', async () => {
    const selections: Array<string | null> = []
    const { app, editorState, onUpdate } = mountEditor(assetId => selections.push(assetId))
    await nextTick()

    const editor = editorState.editor.value
    expect(editor).toBeTruthy()
    onUpdate.mockClear()
    let mediaPosition = -1
    editor!.state.doc.descendants((node, position) => {
      if (node.type.name === 'blogMedia')
        mediaPosition = position
    })
    expect(mediaPosition).toBeGreaterThan(0)

    editor!.commands.setNodeSelection(mediaPosition)
    await nextTick()
    expect(selections.at(-1)).toBe('meme-asset')
    expect(onUpdate).not.toHaveBeenCalled()

    editor!.commands.setTextSelection(1)
    await nextTick()
    expect(selections.at(-1)).toBeNull()
    expect(onUpdate).not.toHaveBeenCalled()
    app.unmount()
  })
})
