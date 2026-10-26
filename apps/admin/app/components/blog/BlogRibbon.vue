<!-- eslint-disable no-alert -->
<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { BlogRibbonTab } from './blog-ribbon-state'
import { Bold, CheckSquare, Code2, Highlighter, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Palette, Quote, Redo2, Search, Strikethrough, Subscript, Superscript, Table2, Type, Underline, Undo2 } from '@lucide/vue'
import { BLOG_RIBBON_TABS, moveBlogRibbonTab } from './blog-ribbon-state'

const props = defineProps<{
  editor: Editor | null
  findText?: (value: string) => unknown
  replaceText?: (value: string, replacement: string) => boolean
}>()

const emit = defineEmits<{
  insertMedia: []
}>()

const tabs = BLOG_RIBBON_TABS
const activeTab = ref<BlogRibbonTab>('Home')
const tabRefs = ref<Array<HTMLButtonElement | null>>([])
const findQuery = ref('')
const replaceQuery = ref('')
const linkUrl = ref('')
const linkLabel = ref('')

function run(callback: (editor: Editor) => void) {
  if (props.editor)
    callback(props.editor)
}

function setHeading(level: number) {
  run(editor => level === 0 ? editor.chain().focus().setParagraph().run() : editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run())
}

function setFontSize(value: string) {
  run(editor => editor.chain().focus().setMark('textStyle', { fontSize: value }).run())
}

function setLineHeight(value: string) {
  run(editor => editor.chain().focus().updateAttributes('paragraph', { lineHeight: value }).updateAttributes('heading', { lineHeight: value }).run())
}

function setIndent(delta: number) {
  run((editor) => {
    const node = editor.state.selection.$from.parent
    const current = Number(node.attrs.indent || 0)
    editor.chain().focus().updateAttributes(node.type.name === 'heading' ? 'heading' : 'paragraph', { indent: Math.max(0, current + delta) }).run()
  })
}

function insertLink() {
  if (!props.editor)
    return
  const href = linkUrl.value.trim() || window.prompt('Link URL')?.trim() || ''
  if (!href)
    return
  if (linkLabel.value.trim())
    props.editor.chain().focus().insertContent(linkLabel.value.trim()).setLink({ href }).run()
  else
    props.editor.chain().focus().setLink({ href }).run()
  linkUrl.value = ''
  linkLabel.value = ''
}

function find() {
  if (findQuery.value.trim())
    props.findText?.(findQuery.value.trim())
}

function replace() {
  if (findQuery.value.trim())
    props.replaceText?.(findQuery.value.trim(), replaceQuery.value)
}

function tabId(tab: BlogRibbonTab) {
  return `blog-ribbon-tab-${tab.toLocaleLowerCase()}`
}

function panelId(tab: BlogRibbonTab) {
  return `blog-ribbon-panel-${tab.toLocaleLowerCase()}`
}

function tabAt(index: number): BlogRibbonTab {
  return tabs[index] ?? tabs[0]
}

function setTabRef(index: number, element: unknown) {
  tabRefs.value[index] = element as HTMLButtonElement | null
}

function activateTab(tab: BlogRibbonTab, focus = false) {
  activeTab.value = tab
  if (!focus)
    return
  nextTick(() => tabRefs.value[tabs.indexOf(tab)]?.focus())
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  const nextIndex = moveBlogRibbonTab(index, event.key)
  if (nextIndex === null) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateTab(tabAt(index))
    }
    return
  }
  event.preventDefault()
  activateTab(tabAt(nextIndex), true)
}
</script>

<template>
  <section class="blog-ribbon" aria-label="Editor ribbon">
    <div class="blog-ribbon__tabs" role="tablist" aria-label="Editor tools" aria-orientation="horizontal">
      <button
        v-for="tab in tabs"
        :key="tab"
        :ref="setTabRef.bind(null, tabs.indexOf(tab))"
        type="button"
        class="blog-ribbon__tab"
        :class="{ 'is-active': activeTab === tab }"
        role="tab"
        :id="tabId(tab)"
        :aria-selected="activeTab === tab"
        :aria-controls="panelId(tab)"
        :tabindex="activeTab === tab ? 0 : -1"
        @click="activateTab(tab)"
        @keydown="onTabKeydown($event, tabs.indexOf(tab))"
      >
        {{ tab }}
      </button>
    </div>

    <div v-show="activeTab === 'Home'" :id="panelId('Home')" class="blog-ribbon__body" role="tabpanel" :aria-labelledby="tabId('Home')" :aria-hidden="activeTab !== 'Home'" tabindex="0">
      <div class="blog-ribbon__group">
        <button
          type="button" title="Undo (Ctrl+Z)" aria-label="Undo" class="
            blog-tool
          " :disabled="!editor?.can().undo()" @click="run(editor => editor.chain().focus().undo().run())"
        >
          <Undo2 :size="16" />
        </button>
        <button
          type="button" title="Redo (Ctrl+Y)" aria-label="Redo" class="
            blog-tool
          " :disabled="!editor?.can().redo()" @click="run(editor => editor.chain().focus().redo().run())"
        >
          <Redo2 :size="16" />
        </button>
      </div>
      <div class="blog-ribbon__group blog-ribbon__group--selects">
        <label class="sr-only" for="blog-font-family">Font family</label>
        <select id="blog-font-family" class="blog-tool-select" aria-label="Font family" @change="run(editor => editor.chain().focus().setFontFamily(($event.target as HTMLSelectElement).value).run())">
          <option value="Inter">
            Inter
          </option>
          <option value="Arial">
            Arial
          </option>
          <option value="Georgia">
            Georgia
          </option>
          <option value="Departure Mono">
            Departure Mono
          </option>
        </select>
        <label class="sr-only" for="blog-font-size">Font size</label>
        <select
          id="blog-font-size" class="blog-tool-select blog-tool-select--short" aria-label="Font size" @change="setFontSize(($event.target as HTMLSelectElement).value)"
        >
          <option value="14px">
            14
          </option><option value="16px" selected>
            16
          </option><option value="18px">
            18
          </option><option value="24px">
            24
          </option><option value="32px">
            32
          </option><option value="48px">
            48
          </option>
        </select>
        <label class="sr-only" for="blog-heading-level">Heading level</label>
        <select id="blog-heading-level" class="blog-tool-select" aria-label="Paragraph style" @change="setHeading(Number(($event.target as HTMLSelectElement).value))">
          <option value="0">
            Paragraph
          </option><option value="1">
            Heading 1
          </option><option value="2">
            Heading 2
          </option><option value="3">
            Heading 3
          </option>
        </select>
      </div>
      <div class="blog-ribbon__group">
        <button type="button" title="Bold" aria-label="Bold" class="blog-tool" :class="{ 'is-active': editor?.isActive('bold') }" @click="run(editor => editor.chain().focus().toggleBold().run())">
          <Bold :size="16" />
        </button>
        <button
          type="button" title="Italic" aria-label="Italic" class="blog-tool" :class="{ 'is-active': editor?.isActive('italic') }" @click="run(editor => editor.chain().focus().toggleItalic().run())"
        >
          <Italic :size="16" />
        </button>
        <button
          type="button" title="Underline" aria-label="Underline" class="
            blog-tool
          " :class="{ 'is-active': editor?.isActive('underline') }" @click="run(editor => editor.chain().focus().toggleUnderline().run())"
        >
          <Underline :size="16" />
        </button>
        <button
          type="button" title="Strikethrough" aria-label="Strikethrough" class="
            blog-tool
          " :class="{ 'is-active': editor?.isActive('strike') }" @click="run(editor => editor.chain().focus().toggleStrike().run())"
        >
          <Strikethrough :size="16" />
        </button>
        <button
          type="button" title="Subscript" aria-label="Subscript" class="
            blog-tool
          " @click="run(editor => editor.chain().focus().toggleSubscript().run())"
        >
          <Subscript :size="16" />
        </button>
        <button
          type="button" title="Superscript" aria-label="Superscript" class="
            blog-tool
          " @click="run(editor => editor.chain().focus().toggleSuperscript().run())"
        >
          <Superscript :size="16" />
        </button>
      </div>
      <div class="blog-ribbon__group">
        <label class="blog-color-tool" title="Text color"><Palette :size="16" /><input type="color" aria-label="Text color" value="#1a1a1a" @input="run(editor => editor.chain().focus().setColor(($event.target as HTMLInputElement).value).run())"></label>
        <label class="blog-color-tool" title="Highlight"><Highlighter :size="16" /><input type="color" aria-label="Highlight color" value="#fbda29" @input="run(editor => editor.chain().focus().toggleHighlight({ color: ($event.target as HTMLInputElement).value }).run())"></label>
      </div>
      <div class="blog-ribbon__group">
        <button
          type="button" title="Bullet list" aria-label="Bullet list" class="
            blog-tool
          " @click="run(editor => editor.chain().focus().toggleBulletList().run())"
        >
          <List :size="16" />
        </button>
        <button
          type="button" title="Numbered list" aria-label="Numbered list" class="
            blog-tool
          " @click="run(editor => editor.chain().focus().toggleOrderedList().run())"
        >
          <ListOrdered :size="16" />
        </button>
        <button
          type="button" title="Task list" aria-label="Task list" class="
            blog-tool
          " @click="run(editor => editor.chain().focus().toggleTaskList().run())"
        >
          <CheckSquare :size="16" />
        </button>
      </div>
    </div>

    <div v-show="activeTab === 'Insert'" :id="panelId('Insert')" class="blog-ribbon__body" role="tabpanel" :aria-labelledby="tabId('Insert')" :aria-hidden="activeTab !== 'Insert'" tabindex="0">
      <div class="blog-ribbon__group">
        <button type="button" class="blog-tool blog-tool--wide" @click="emit('insertMedia')">
          <ImagePlus :size="16" /> Media
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="run(editor => editor.chain().focus().setHorizontalRule().run())">
          <Minus :size="16" /> Rule
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="run(editor => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())">
          <Table2 :size="16" /> Table
        </button>
      </div>
      <div class="blog-ribbon__group">
        <input v-model="linkLabel" class="blog-inline-input" aria-label="Link text" placeholder="Text (optional)">
        <input
          v-model="linkUrl" class="blog-inline-input blog-inline-input--url" aria-label="Link URL" placeholder="https://"
        >
        <button type="button" class="blog-tool blog-tool--wide" @click="insertLink">
          <Link2 :size="16" /> Link
        </button>
      </div>
      <div class="blog-ribbon__group">
        <button type="button" class="blog-tool blog-tool--wide" @click="run(editor => editor.chain().focus().toggleBlockquote().run())">
          <Quote :size="16" /> Quote
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="run(editor => editor.chain().focus().toggleCodeBlock().run())">
          <Code2 :size="16" /> Code
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="run(editor => editor.chain().focus().setHardBreak().run())">
          <Type :size="16" /> Break
        </button>
      </div>
    </div>

    <div v-show="activeTab === 'Layout'" :id="panelId('Layout')" class="blog-ribbon__body" role="tabpanel" :aria-labelledby="tabId('Layout')" :aria-hidden="activeTab !== 'Layout'" tabindex="0">
      <div class="blog-ribbon__group blog-ribbon__group--selects">
        <label class="sr-only" for="blog-line-height">Line spacing</label>
        <select id="blog-line-height" class="blog-tool-select" aria-label="Line spacing" @change="setLineHeight(($event.target as HTMLSelectElement).value)">
          <option value="1.2">
            Compact
          </option><option value="1.5" selected>
            Comfortable
          </option><option value="1.8">
            Relaxed
          </option><option value="2">
            Double
          </option>
        </select>
      </div>
      <div class="blog-ribbon__group">
        <button type="button" class="blog-tool blog-tool--wide" :class="{ 'is-active': editor?.isActive({ textAlign: 'left' }) }" @click="run(editor => editor.chain().focus().setTextAlign('left').run())">
          Left
        </button>
        <button type="button" class="blog-tool blog-tool--wide" :class="{ 'is-active': editor?.isActive({ textAlign: 'center' }) }" @click="run(editor => editor.chain().focus().setTextAlign('center').run())">
          Center
        </button>
        <button type="button" class="blog-tool blog-tool--wide" :class="{ 'is-active': editor?.isActive({ textAlign: 'right' }) }" @click="run(editor => editor.chain().focus().setTextAlign('right').run())">
          Right
        </button>
        <button type="button" class="blog-tool blog-tool--wide" :class="{ 'is-active': editor?.isActive({ textAlign: 'justify' }) }" @click="run(editor => editor.chain().focus().setTextAlign('justify').run())">
          Justify
        </button>
      </div>
      <div class="blog-ribbon__group">
        <button type="button" class="blog-tool blog-tool--wide" @click="setIndent(-1)">
          Outdent
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="setIndent(1)">
          Indent
        </button>
      </div>
    </div>

    <div v-show="activeTab === 'Media'" :id="panelId('Media')" class="blog-ribbon__body" role="tabpanel" :aria-labelledby="tabId('Media')" :aria-hidden="activeTab !== 'Media'" tabindex="0">
      <div class="blog-ribbon__group">
        <button type="button" class="blog-tool blog-tool--wide" @click="emit('insertMedia')">
          <ImagePlus :size="16" /> Insert media
        </button>
        <span class="blog-ribbon__hint">Select a media block to edit width, alignment, alt text, caption and poster.</span>
      </div>
    </div>

    <div v-show="activeTab === 'Review'" :id="panelId('Review')" class="blog-ribbon__body blog-ribbon__body--review" role="tabpanel" :aria-labelledby="tabId('Review')" :aria-hidden="activeTab !== 'Review'" tabindex="0">
      <div class="blog-ribbon__group">
        <Search :size="16" aria-hidden="true" />
        <input v-model="findQuery" class="blog-inline-input" aria-label="Find text" placeholder="Find in document" @keydown.enter="find">
        <input v-model="replaceQuery" class="blog-inline-input" aria-label="Replace text" placeholder="Replace with">
        <button type="button" class="blog-tool blog-tool--wide" @click="find">
          Find next
        </button>
        <button type="button" class="blog-tool blog-tool--wide" @click="replace">
          Replace
        </button>
      </div>
      <span class="blog-ribbon__hint">Spellcheck is enabled in the writing surface. Ctrl+S saves a checkpoint.</span>
    </div>
  </section>
</template>
