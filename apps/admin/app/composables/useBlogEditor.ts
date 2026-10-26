import type { Editor, JSONContent } from '@tiptap/vue-3'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyleKit } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { Extension, useEditor } from '@tiptap/vue-3'
import { BlogMedia } from '@/utils/blog-media-extension'

const EditorStyle = Extension.create({
  name: 'editorStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: { default: 0, parseHTML: (element: HTMLElement) => Number(element.getAttribute('data-indent') || 0), renderHTML: (attributes: { indent?: number }) => attributes.indent ? { 'data-indent': attributes.indent, 'style': `margin-left:${Number(attributes.indent) * 1.5}em` } : {} },
          lineHeight: { default: null, parseHTML: (element: HTMLElement) => element.style.lineHeight || null, renderHTML: (attributes: { lineHeight?: string | null }) => attributes.lineHeight ? { style: `line-height:${attributes.lineHeight}` } : {} },
        },
      },
      {
        types: ['heading'],
        attributes: {
          id: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('id'), renderHTML: (attributes: { id?: string | null }) => attributes.id ? { id: attributes.id } : {} },
        },
      },
    ]
  },
})

export interface BlogEditorOptions {
  content: JSONContent | string
  onUpdate: (editor: Editor) => void
}

export const BLOG_EDITOR_COMMANDS = [
  'undo',
  'redo',
  'toggleBold',
  'toggleItalic',
  'toggleUnderline',
  'toggleStrike',
  'toggleSubscript',
  'toggleSuperscript',
  'setColor',
  'toggleHighlight',
  'toggleBulletList',
  'toggleOrderedList',
  'toggleTaskList',
  'setTextAlign',
  'setLink',
  'toggleBlockquote',
  'toggleCodeBlock',
  'insertTable',
  'setFontFamily',
  'setFontSize',
  'setLineHeight',
] as const

export function useBlogEditor(options: BlogEditorOptions) {
  const editor = useEditor({
    content: options.content,
    extensions: [
      StarterKit,
      TextStyleKit,
      EditorStyle,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      BlogMedia,
    ],
    editorProps: {
      attributes: {
        'class': 'blog-editor__content',
        'spellcheck': 'true',
        'role': 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: updatedEditor }) => options.onUpdate(updatedEditor as unknown as Editor),
  })

  function insertMedia(attrs: Partial<import('@/utils/blog-studio').BlogMediaAttrs>) {
    if (!editor.value)
      return
    editor.value.chain().focus().insertContent({ type: 'blogMedia', attrs: { assetId: '', kind: 'image', src: '', alt: '', caption: '', width: 100, align: 'left', ...attrs } }).run()
  }

  function updateSelectedMedia(attrs: Partial<import('@/utils/blog-studio').BlogMediaAttrs>) {
    editor.value?.chain().focus().updateAttributes('blogMedia', attrs).run()
  }

  function selectedMedia(): import('@/utils/blog-studio').BlogMediaAttrs | null {
    const current = editor.value?.state.selection.$from.nodeAfter
    if (!current || current.type.name !== 'blogMedia')
      return null
    return current.attrs as import('@/utils/blog-studio').BlogMediaAttrs
  }

  function findText(query: string) {
    const instance = editor.value
    if (!instance || !query)
      return null
    const text = instance.state.doc.textBetween(0, instance.state.doc.content.size, '\n', '\uFFFC')
    const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    if (index < 0)
      return null
    const from = Math.max(1, index + 1)
    instance.chain().focus().setTextSelection({ from, to: from + query.length }).run()
    return { from, to: from + query.length }
  }

  function replaceText(query: string, replacement: string) {
    const match = findText(query)
    if (!match || !editor.value)
      return false
    editor.value.chain().focus().insertContentAt(match, replacement).run()
    return true
  }

  return { editor, insertMedia, updateSelectedMedia, selectedMedia, findText, replaceText }
}
