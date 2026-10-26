import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model'
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

export interface BlogTextMatch {
  from: number
  to: number
  text: string
  marks: readonly Mark[]
}

/**
 * Collect text using the document's real ProseMirror positions. Text nodes
 * that only differ by marks are joined, while block boundaries and inline
 * atoms remain separators so a search can never cross a table cell or
 * paragraph accidentally.
 */
export function findBlogTextMatches(doc: ProseMirrorNode, query: string): BlogTextMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery)
    return []

  const groups = new Map<string, Array<{ from: number, to: number, text: string, marks: readonly Mark[] }>>()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text)
      return

    const resolved = doc.resolve(pos)
    const key = `${resolved.depth}:${resolved.start(resolved.depth)}:${resolved.parent.type.name}`
    const group = groups.get(key) ?? []
    group.push({ from: pos, to: pos + node.text.length, text: node.text, marks: node.marks })
    groups.set(key, group)
  })

  const matches: BlogTextMatch[] = []
  for (const slices of groups.values()) {
    slices.sort((left, right) => left.from - right.from)
    let searchable = ''
    const characters: Array<{ from: number, to: number, marks: readonly Mark[] } | null> = []
    let previous: { from: number, to: number } | undefined

    for (const slice of slices) {
      if (previous && previous.to !== slice.from) {
        searchable += '\u0000'
        characters.push(null)
      }
      for (let index = 0; index < slice.text.length; index += 1) {
        searchable += slice.text[index]
        characters.push({ from: slice.from + index, to: slice.from + index + 1, marks: slice.marks })
      }
      previous = slice
    }

    let offset = searchable.toLocaleLowerCase().indexOf(normalizedQuery)
    while (offset >= 0) {
      const first = characters[offset]
      const last = characters[offset + normalizedQuery.length - 1]
      if (first && last) {
        matches.push({
          from: first.from,
          to: last.to,
          text: searchable.slice(offset, offset + normalizedQuery.length),
          marks: first.marks,
        })
      }
      offset = searchable.toLocaleLowerCase().indexOf(normalizedQuery, offset + 1)
    }
  }

  return matches.sort((left, right) => left.from - right.from)
}

export function findNextBlogTextMatch(matches: readonly BlogTextMatch[], selectionFrom: number, selectionTo: number): BlogTextMatch | null {
  if (!matches.length)
    return null
  return matches.find(match => match.from >= selectionTo && match.from !== selectionFrom) ?? matches[0] ?? null
}

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
    const matches = findBlogTextMatches(instance.state.doc, query)
    const match = findNextBlogTextMatch(matches, instance.state.selection.from, instance.state.selection.to)
    if (!match)
      return null
    instance.chain().focus().setTextSelection({ from: match.from, to: match.to }).run()
    return { from: match.from, to: match.to }
  }

  function replaceText(query: string, replacement: string) {
    const instance = editor.value
    if (!instance || !query)
      return false

    const match = findNextBlogTextMatch(
      findBlogTextMatches(instance.state.doc, query),
      instance.state.selection.from,
      instance.state.selection.to,
    )
    if (!match)
      return false

    instance.view.focus()
    const transaction = instance.state.tr
    if (replacement)
      transaction.replaceWith(match.from, match.to, instance.state.schema.text(replacement, match.marks))
    else
      transaction.delete(match.from, match.to)
    instance.view.dispatch(transaction)
    return true
  }

  return { editor, insertMedia, updateSelectedMedia, selectedMedia, findText, replaceText }
}
