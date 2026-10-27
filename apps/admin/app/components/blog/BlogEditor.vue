<!-- eslint-disable no-alert -->
<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { BlogDocxImportReview } from '@/composables/useBlogDocuments'
import type { BlogAsset, BlogDraft, BlogMediaAttrs, BlogPostDetail, BlogRevision, LegacyConversionResult } from '@/utils/blog-studio'
import type { GallerySummary } from '@/utils/content-calendar'
import { Archive, ArrowLeft, Check, Clock3, Download, ExternalLink, FileText, History, LoaderCircle, PanelRight, Play, RefreshCw, RotateCcw, Save, Send, ShieldCheck, Upload, X } from '@lucide/vue'
import { EditorContent } from '@tiptap/vue-3'
import { useBlogApi } from '@/composables/useBlogApi'
import { useBlogAutosave } from '@/composables/useBlogAutosave'
import { useBlogDocuments } from '@/composables/useBlogDocuments'
import { useBlogEditor } from '@/composables/useBlogEditor'
import { convertLegacyHtmlToTiptap } from '@/composables/useBlogLegacyConversion'
import { preserveDraftEditsAfterServerSave, rebaseDraftOntoServer } from '@/composables/useBlogStudio'
import { cloneDraft, createEmptyDraft, formatDate, isStaleDraftError } from '@/utils/blog-studio'
import { normalizeYouTubeVideoId } from '@/utils/content-calendar'
import { getBlogPosterAssets } from './blog-media-library-state'
import BlogModal from './BlogModal.vue'

const route = useRoute()
const api = useBlogApi()
const postId = computed(() => String(route.params.id || ''))
const detail = ref<BlogPostDetail | null>(null)
const draft = ref<BlogDraft>(createEmptyDraft())
const loading = ref(true)
const error = ref('')
const taxonomy = ref<{ categories: { id: string, name: string, slug: string }[], tags: { id: string, name: string, slug: string }[] }>({ categories: [], tags: [] })
const taxonomyNames = reactive({ category: '', tag: '' })
const taxonomySaving = ref<'category' | 'tag' | null>(null)
const revisions = ref<BlogRevision[]>([])
const revisionsOpen = ref(false)
const previewOpen = ref(false)
const previewHtml = ref('')
const previewLoading = ref(false)
const inspectorOpen = ref(true)
const mediaDialogOpen = ref(false)
const mediaAssets = ref<BlogAsset[]>([])
const mediaLoading = ref(false)
const galleryDialogOpen = ref(false)
const gallerySummaries = ref<GallerySummary[]>([])
const galleryLoading = ref(false)
const youtubeDialogOpen = ref(false)
const youtubeVideoId = ref('')
const youtubeTitle = ref('')
const youtubeError = ref('')
const selectedMediaAttrs = ref<BlogMediaAttrs | null>(null)
const legacyReview = ref<LegacyConversionResult | null>(null)
const legacyReviewOpen = ref(false)
const legacyLocked = ref(false)
const originalLegacyHtml = ref('')
const staleReviewOpen = ref(false)
const staleServerDetail = ref<BlogPostDetail | null>(null)
const staleServerLoading = ref(false)
const staleServerError = ref('')
const staleApplyLoading = ref(false)
const staleLocalDraft = ref<BlogDraft | null>(null)
const localRecoveryReviewAvailable = ref(false)
const isPublishing = ref(false)
const statusNotice = ref('')
const docxInput = ref<HTMLInputElement | null>(null)
const docxReview = ref<BlogDocxImportReview | null>(null)
const docxLoading = ref(false)
let loadSequence = 0
let conflictRequestSequence = 0
let editSequence = 0
let mediaAssetsRequestSequence = 0

const autosave = useBlogAutosave(postId, draft, (saved) => {
  detail.value = saved
  statusNotice.value = 'Saved privately'
})
const editorState = useBlogEditor({
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  onUpdate(editor) {
    if (!draft.value || loading.value || legacyLocked.value)
      return
    draft.value.content_json = editor.getJSON()
    draft.value.content_html = editor.getHTML()
    autosave.markChanged()
    editSequence += 1
    if (autosave.state.value === 'stale' || staleReviewOpen.value || localRecoveryReviewAvailable.value)
      staleLocalDraft.value = cloneDraft(draft.value)
    refreshSelectedMedia(editor)
  },
})
const editor = editorState.editor
const activeEditor = computed(() => editor.value ?? null)
const wordCount = computed(() => {
  const text = editor.value?.state.doc.textContent.trim() ?? ''
  return text ? text.split(/\s+/).length : 0
})
const documents = useBlogDocuments()

const saveLabel = computed(() => {
  if (autosave.state.value === 'saving')
    return 'Saving…'
  if (autosave.state.value === 'offline')
    return 'Offline recovery'
  if (autosave.state.value === 'error')
    return 'Save failed'
  if (autosave.state.value === 'stale')
    return 'Review stale draft'
  if (autosave.state.value === 'recovery')
    return 'Recovery copy kept locally'
  if (autosave.state.value === 'unsaved')
    return 'Unsaved changes'
  return 'Saved privately'
})
const isStale = computed(() => autosave.state.value === 'stale')

async function addTaxonomy(kind: 'category' | 'tag') {
  const requestedPostId = postId.value
  const name = taxonomyNames[kind].trim()
  if (!name || taxonomySaving.value)
    return
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const collection = kind === 'category' ? 'categories' : 'tags'
  const existing = taxonomy.value[collection].find(item => item.slug === slug || item.name.toLowerCase() === name.toLowerCase())
  taxonomySaving.value = kind
  try {
    const updated = existing ? taxonomy.value : await api.createTaxonomy({ kind, name, slug })
    if (requestedPostId !== postId.value)
      return
    taxonomy.value = updated
    const selected = existing ?? updated[collection].find(item => item.slug === slug)
    if (!selected)
      throw new Error('The new item was not returned. Refresh the post before trying again.')
    if (kind === 'category')
      setDraftField('category_id', selected.id)
    else
      setDraftField('tag_ids', [...new Set([...draft.value.tag_ids, selected.id])])
    taxonomyNames[kind] = ''
    statusNotice.value = `${selected.name} selected for this draft.`
  }
  catch (reason: unknown) {
    if (requestedPostId === postId.value)
      error.value = reason instanceof Error ? reason.message : `Could not add the ${kind}.`
  }
  finally {
    taxonomySaving.value = null
  }
}

const posterAssets = computed(() => getBlogPosterAssets(mediaAssets.value))
const selectedPosterAsset = computed(() => {
  const posterId = selectedMediaAttrs.value?.posterAssetId
  return posterId ? posterAssets.value.find(asset => asset.id === posterId) ?? null : null
})

function refreshSelectedMedia(instance: Editor | null = editor.value ?? null) {
  selectedMediaAttrs.value = instance ? editorState.selectedMedia() : null
}

function setDraftField<Key extends keyof BlogDraft>(key: Key, value: BlogDraft[Key]) {
  draft.value[key] = value
  autosave.markChanged()
  editSequence += 1
  if (autosave.state.value === 'stale' || staleReviewOpen.value || localRecoveryReviewAvailable.value)
    staleLocalDraft.value = cloneDraft(draft.value)
}

function collectDraftText(value: BlogDraft | null): string {
  if (!value)
    return ''
  if (!value.content_json)
    return value.content_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  const chunks: string[] = []
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object')
      return
    const candidate = node as { text?: unknown, content?: unknown }
    if (typeof candidate.text === 'string')
      chunks.push(candidate.text)
    if (Array.isArray(candidate.content)) {
      for (const child of candidate.content)
        visit(child)
      if (candidate.content.length)
        chunks.push('\n')
    }
  }
  visit(value.content_json)
  return chunks.join('').replace(/\n{3,}/g, '\n\n').trim()
}

function rememberLocalRecovery() {
  if (draft.value && (!staleLocalDraft.value || autosave.state.value === 'stale' || autosave.state.value === 'recovery' || !localRecoveryReviewAvailable.value))
    staleLocalDraft.value = cloneDraft(draft.value)
}

function syncEditorFromDraft(value: BlogDraft) {
  editor.value?.commands.setContent(value.content_json ?? value.content_html ?? { type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false })
  editor.value?.setEditable(value.content_json !== null)
  refreshSelectedMedia()
}

async function refreshRevisions() {
  const requestedPostId = postId.value
  const result = await api.listRevisions(requestedPostId)
  if (requestedPostId === postId.value)
    revisions.value = result.revisions
}

async function load() {
  const requestedPostId = postId.value
  const requestSequence = ++loadSequence
  loading.value = true
  error.value = ''
  try {
    const [result, tax] = await Promise.all([api.getPost(requestedPostId), api.getTaxonomy()])
    if (requestedPostId !== postId.value || requestSequence !== loadSequence)
      return
    detail.value = result
    draft.value = result.draft
    editSequence = 0
    staleReviewOpen.value = false
    staleServerDetail.value = null
    staleServerError.value = ''
    staleLocalDraft.value = null
    taxonomy.value = tax
    const isLegacy = result.draft.content_json === null
    legacyLocked.value = isLegacy
    originalLegacyHtml.value = isLegacy ? result.draft.content_html : ''
    legacyReview.value = isLegacy ? convertLegacyHtmlToTiptap(result.draft.content_html) : null
    legacyReviewOpen.value = Boolean(legacyReview.value)
    syncEditorFromDraft(result.draft)
    const recovered = autosave.inspectRecovery()
    localRecoveryReviewAvailable.value = Boolean(recovered)
    if (recovered)
      staleLocalDraft.value = recovered
  }
  catch (reason: unknown) {
    if (requestedPostId === postId.value && requestSequence === loadSequence)
      error.value = reason instanceof Error ? reason.message : 'Could not load this post.'
  }
  finally {
    if (requestSequence === loadSequence)
      loading.value = false
  }
}

async function saveCheckpoint() {
  error.value = ''
  try {
    const result = await autosave.checkpoint()
    if (!result) {
      error.value = autosave.lastError.value || 'Could not save the checkpoint.'
      return
    }
    statusNotice.value = `Checkpoint ${result.revision.version} saved`
    await refreshRevisions()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not save the checkpoint.'
  }
}

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
    event.preventDefault()
    void saveCheckpoint()
  }
}

function applyLegacyConversion() {
  if (!legacyReview.value)
    return
  editor.value?.commands.setContent(legacyReview.value.document, { emitUpdate: false })
  draft.value.content_json = legacyReview.value.document
  draft.value.content_html = editor.value?.getHTML() ?? draft.value.content_html
  legacyLocked.value = false
  editor.value?.setEditable(true)
  legacyReviewOpen.value = false
  legacyReview.value = null
  statusNotice.value = 'Legacy content converted. Review before saving.'
  autosave.markChanged()
}

function keepOriginalLegacy() {
  legacyReviewOpen.value = false
  legacyLocked.value = true
  editor.value?.setEditable(false)
  draft.value.content_json = null
  draft.value.content_html = originalLegacyHtml.value
  statusNotice.value = 'Original legacy HTML kept. Convert later from the review banner.'
}

function reopenLegacyReview() {
  if (legacyReview.value)
    legacyReviewOpen.value = true
}

async function reloadCurrent() {
  rememberLocalRecovery()
  autosave.keepRecovery()
  staleReviewOpen.value = false
  autosave.resetForReload()
  await load()
  localRecoveryReviewAvailable.value = Boolean(autosave.inspectRecovery())
  statusNotice.value = localRecoveryReviewAvailable.value
    ? 'Current server version loaded. Your recovery copy is still available for review.'
    : 'Current server version loaded.'
}

function keepRecoveryCopy() {
  rememberLocalRecovery()
  autosave.keepRecovery()
  staleReviewOpen.value = false
  localRecoveryReviewAvailable.value = true
  statusNotice.value = 'Working copy kept locally. Reload the current version before merging.'
}

async function loadConflictServer() {
  const requestedPostId = postId.value
  const requestSequence = ++conflictRequestSequence
  staleServerLoading.value = true
  staleServerError.value = ''
  try {
    const result = await api.getPost(requestedPostId)
    if (requestedPostId === postId.value && requestSequence === conflictRequestSequence)
      staleServerDetail.value = result
  }
  catch (reason: unknown) {
    if (requestedPostId === postId.value && requestSequence === conflictRequestSequence)
      staleServerError.value = reason instanceof Error ? reason.message : 'Could not load the current server version.'
  }
  finally {
    if (requestSequence === conflictRequestSequence)
      staleServerLoading.value = false
  }
}

function openConflictReview() {
  rememberLocalRecovery()
  staleReviewOpen.value = true
  void loadConflictServer()
}

async function applyMyCopyToDraft() {
  const requestedPostId = postId.value
  const server = staleServerDetail.value
  const local = staleLocalDraft.value ?? autosave.inspectRecovery() ?? draft.value
  if (!server || !local || staleApplyLoading.value)
    return

  const editAtStart = editSequence
  const localSnapshot = cloneDraft(local)
  staleApplyLoading.value = true
  staleServerError.value = ''
  autosave.keepRecovery()
  try {
    const result = await api.saveDraft(requestedPostId, rebaseDraftOntoServer(localSnapshot, server.draft))
    if (requestedPostId !== postId.value)
      return

    const changedDuringApply = editSequence !== editAtStart
    autosave.resetForReload()
    detail.value = result
    if (changedDuringApply) {
      const currentDraft = draft.value
      if (currentDraft) {
        draft.value = preserveDraftEditsAfterServerSave(currentDraft, result.draft, true)
        detail.value = { ...result, draft: draft.value }
      }
      autosave.markChanged()
      rememberLocalRecovery()
      statusNotice.value = 'Your copy was applied. Newer edits remain unsaved and are queued privately.'
    }
    else {
      draft.value = preserveDraftEditsAfterServerSave(localSnapshot, result.draft, false)
      syncEditorFromDraft(result.draft)
      autosave.discardRecovery()
      staleLocalDraft.value = null
      localRecoveryReviewAvailable.value = false
      statusNotice.value = 'Your copy was applied to the private draft.'
    }
    staleReviewOpen.value = false
    staleServerDetail.value = null
  }
  catch (reason: unknown) {
    rememberLocalRecovery()
    autosave.keepRecovery()
    if (isStaleDraftError(reason)) {
      autosave.state.value = 'stale'
      autosave.lastError.value = 'The server changed again. Review the newest version before applying your copy.'
      staleReviewOpen.value = true
      await loadConflictServer()
    }
    else {
      staleServerError.value = reason instanceof Error ? reason.message : 'Could not apply your copy. It remains available locally.'
      staleReviewOpen.value = true
    }
  }
  finally {
    staleApplyLoading.value = false
  }
}

watch(() => autosave.state.value, (value) => {
  if (value === 'stale' || value === 'offline' || value === 'error' || value === 'recovery') {
    rememberLocalRecovery()
    localRecoveryReviewAvailable.value = true
  }
  if (value === 'stale') {
    staleReviewOpen.value = true
    void loadConflictServer()
  }
})

async function publish() {
  if (!detail.value || !draft.value || isPublishing.value)
    return
  if (!window.confirm('Publish this version to the public portfolio?'))
    return
  const publishingPostId = postId.value
  isPublishing.value = true
  try {
    const saved = await autosave.save()
    if (publishingPostId !== postId.value || !saved || autosave.state.value !== 'saved')
      return
    const result = await api.publishPost(publishingPostId, saved.draft.version)
    if (publishingPostId !== postId.value)
      return
    detail.value = result
    draft.value = result.draft
    statusNotice.value = 'Published'
    await refreshRevisions()
  }
  catch (reason: unknown) {
    if (isStaleDraftError(reason)) {
      autosave.state.value = 'stale'
      rememberLocalRecovery()
      staleReviewOpen.value = true
      void loadConflictServer()
    }
    else {
      error.value = reason instanceof Error ? reason.message : 'Could not publish this post.'
    }
  }
  finally {
    isPublishing.value = false
  }
}

async function updateStatus(status: 'draft' | 'archived') {
  const updatingPostId = postId.value
  try {
    const saved = await autosave.save()
    if (updatingPostId !== postId.value || !saved || autosave.state.value !== 'saved') {
      error.value = autosave.lastError.value || 'Save the current draft before changing its status.'
      return
    }
    const result = await api.setPostStatus(updatingPostId, status)
    if (updatingPostId !== postId.value)
      return
    detail.value = result
    draft.value = result.draft
    const isLegacy = result.draft.content_json === null
    legacyLocked.value = isLegacy
    originalLegacyHtml.value = isLegacy ? result.draft.content_html : ''
    legacyReview.value = isLegacy ? convertLegacyHtmlToTiptap(result.draft.content_html) : null
    legacyReviewOpen.value = Boolean(legacyReview.value)
    editor.value?.commands.setContent(result.draft.content_json ?? result.draft.content_html, { emitUpdate: false })
    editor.value?.setEditable(!isLegacy)
    statusNotice.value = status === 'archived' ? 'Post archived' : 'Post restored to drafts'
    await refreshRevisions()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not update post status.'
  }
}

async function openPreview() {
  const previewPostId = postId.value
  previewLoading.value = true
  error.value = ''
  try {
    const saved = await autosave.save()
    if (previewPostId !== postId.value || !saved || autosave.state.value !== 'saved') {
      error.value = autosave.lastError.value || 'Save the current draft before opening a preview.'
      return
    }
    const html = await api.getPreview(previewPostId)
    if (previewPostId !== postId.value)
      return
    previewHtml.value = html
    previewOpen.value = true
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load the private preview.'
  }
  finally {
    previewLoading.value = false
  }
}

async function loadRevisions() {
  revisionsOpen.value = !revisionsOpen.value
  if (revisionsOpen.value) {
    try {
      await refreshRevisions()
    }
    catch (reason: unknown) {
      error.value = reason instanceof Error ? reason.message : 'Could not load revisions.'
    }
  }
}

async function restore(revision: BlogRevision) {
  if (!window.confirm(`Restore “${revision.title || 'Untitled'}” to the working draft?`))
    return
  try {
    const result = await api.restoreRevision(postId.value, draft.value.version, revision.id)
    detail.value = result
    draft.value = result.draft
    const isLegacy = result.draft.content_json === null
    legacyLocked.value = isLegacy
    originalLegacyHtml.value = isLegacy ? result.draft.content_html : ''
    legacyReview.value = isLegacy ? convertLegacyHtmlToTiptap(result.draft.content_html) : null
    legacyReviewOpen.value = Boolean(legacyReview.value)
    editor.value?.commands.setContent(result.draft.content_json ?? result.draft.content_html, { emitUpdate: false })
    editor.value?.setEditable(!isLegacy)
    revisionsOpen.value = false
    statusNotice.value = 'Revision restored to the private draft'
    await refreshRevisions()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not restore this revision.'
  }
}

async function loadMediaAssets() {
  const requestSequence = ++mediaAssetsRequestSequence
  mediaLoading.value = true
  try {
    const result = await api.listMedia()
    if (requestSequence === mediaAssetsRequestSequence)
      mediaAssets.value = result.assets
  }
  catch (reason: unknown) {
    if (requestSequence === mediaAssetsRequestSequence)
      error.value = reason instanceof Error ? reason.message : 'Could not load media.'
  }
  finally {
    if (requestSequence === mediaAssetsRequestSequence)
      mediaLoading.value = false
  }
}

async function openMediaDialog() {
  mediaDialogOpen.value = true
  await loadMediaAssets()
}

async function openGalleryDialog() {
  galleryDialogOpen.value = true
  galleryLoading.value = true
  try {
    const result = await api.listGalleries()
    gallerySummaries.value = result.galleries.filter(gallery => gallery.status === 'finalized')
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load finalized galleries.'
  }
  finally {
    galleryLoading.value = false
  }
}

function insertGallery(manifestId: string) {
  if (!editorState.insertGallery(manifestId)) {
    error.value = 'That gallery is no longer available. Refresh the gallery list and try again.'
    return
  }
  galleryDialogOpen.value = false
  statusNotice.value = 'Gallery inserted'
}

function openYouTubeDialog() {
  youtubeVideoId.value = ''
  youtubeTitle.value = ''
  youtubeError.value = ''
  youtubeDialogOpen.value = true
}

function insertYouTube() {
  const videoId = normalizeYouTubeVideoId(youtubeVideoId.value)
  if (!videoId) {
    youtubeError.value = 'Use a valid 11-character YouTube video ID or URL.'
    return
  }
  if (!editorState.insertYouTube(videoId, youtubeTitle.value)) {
    youtubeError.value = 'This YouTube video could not be inserted.'
    return
  }
  youtubeDialogOpen.value = false
  statusNotice.value = 'YouTube video inserted'
}

function insertAsset(asset: BlogAsset) {
  editorState.insertMedia({ assetId: asset.id, kind: asset.kind, src: asset.source_url, alt: asset.name, caption: '', width: 100, align: 'left' })
  mediaDialogOpen.value = false
  statusNotice.value = `${asset.name} inserted`
}

function updateSelectedMedia(key: 'width' | 'align' | 'alt' | 'caption' | 'posterAssetId', value: string | number) {
  editorState.updateSelectedMedia({ [key]: value } as never)
  refreshSelectedMedia()
  autosave.markChanged()
}

function exportHtml() {
  const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${draft.value.title}</title></head><body>${draft.value.content_html}</body></html>`], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${draft.value.slug || 'post'}.html`
  link.click()
  URL.revokeObjectURL(url)
}

function printPdf() {
  const popup = window.open('', '_blank', 'noopener,noreferrer')
  if (!popup)
    return
  popup.document.write(`<!doctype html><html><head><title>${draft.value.title}</title><style>body{font:16px/1.6 Inter,Arial;max-width:760px;margin:40px auto;padding:0 20px}img,video{max-width:100%}</style></head><body>${draft.value.content_html}</body></html>`)
  popup.document.close()
  popup.focus()
  popup.print()
}

function chooseDocx() {
  docxInput.value?.click()
}

async function onDocxFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file)
    return
  docxLoading.value = true
  error.value = ''
  try {
    docxReview.value = await documents.importDocx(file)
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not import this DOCX file.'
  }
  finally {
    docxLoading.value = false
  }
}

function applyDocxConversion() {
  if (!docxReview.value)
    return
  editor.value?.commands.setContent(docxReview.value.document.document, { emitUpdate: false })
  draft.value.content_json = docxReview.value.document.document
  draft.value.content_html = editor.value?.getHTML() ?? docxReview.value.html
  docxReview.value = null
  autosave.markChanged()
  statusNotice.value = 'DOCX content applied after review'
}

async function exportDocx() {
  docxLoading.value = true
  error.value = ''
  try {
    const blob = await documents.exportDocx(draft.value.title || 'post', draft.value.content_html, async (src) => {
      try {
        const response = await fetch(src, { credentials: 'include' })
        return response.ok ? response.blob() : null
      }
      catch {
        return null
      }
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${draft.value.slug || 'post'}.docx`
    link.click()
    URL.revokeObjectURL(url)
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not export this DOCX file.'
  }
  finally {
    docxLoading.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void load()
  void loadMediaAssets()
})
watch(postId, (value, previous) => {
  if (value && value !== previous)
    void load()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <main class="blog-editor-page">
    <div class="blog-editor-heading">
      <div class="blog-editor-heading__main">
        <NuxtLink to="/admin/blog/posts" class="blog-back-link">
          <ArrowLeft :size="16" /> Posts
        </NuxtLink>
        <div class="blog-title-row">
          <input :value="draft.title" class="blog-title-input" aria-label="Post title" placeholder="Untitled post" @input="setDraftField('title', ($event.target as HTMLInputElement).value)">
          <span class="blog-status" :data-status="detail?.post.status">{{ detail?.post.status ?? 'draft' }}</span>
        </div>
        <p class="blog-editor-slug">
          /{{ draft.slug || 'draft-slug' }} <span v-if="detail?.post.published_version">· published v{{ detail.post.published_version }}</span>
        </p>
      </div>
      <div class="blog-editor-actions">
        <span class="blog-save-state" :data-state="autosave.state"><span
          class="blog-save-dot"
        /> {{ saveLabel }}</span>
        <button type="button" class="blog-button blog-button--quiet" :disabled="previewLoading" @click="openPreview">
          <Play :size="16" /> Preview
        </button>
        <button type="button" class="blog-button blog-button--quiet" @click="saveCheckpoint">
          <Save :size="16" /> Checkpoint
        </button>
        <button
          v-if="detail?.post.status === 'archived'" type="button" class="
            blog-button blog-button--quiet
          " @click="updateStatus('draft')"
        >
          <RotateCcw :size="16" /> Recover
        </button>
        <button
          v-else-if="detail?.post.status === 'published'" type="button" class="
            blog-button blog-button--quiet
          " @click="updateStatus('draft')"
        >
          <RotateCcw :size="16" /> Unpublish
        </button>
        <button v-else type="button" class="blog-button blog-button--quiet" @click="updateStatus('archived')">
          <Archive :size="16" /> Archive
        </button>
        <button type="button" class="blog-button blog-button--primary" :disabled="isPublishing || isStale" @click="publish">
          <Send :size="16" /> {{ isPublishing ? 'Publishing…' : 'Publish' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <p v-if="statusNotice" class="blog-alert blog-alert--notice" role="status">
      <Check :size="16" /> {{ statusNotice }}
    </p>
    <p v-if="legacyLocked" class="blog-alert blog-alert--notice" role="status">
      <ShieldCheck :size="16" /> Legacy HTML is preserved and the writing surface is locked until you approve its conversion.
      <button type="button" class="blog-text-button" @click="reopenLegacyReview">
        Review conversion
      </button>
    </p>
    <p v-if="isStale && !staleReviewOpen" class="blog-alert blog-alert--error" role="alert">
      <ShieldCheck :size="16" /> A newer private draft is available. Your local copy is preserved.
      <button type="button" class="blog-text-button" @click="openConflictReview">
        Review conflict
      </button>
    </p>
    <p v-else-if="localRecoveryReviewAvailable && !staleReviewOpen" class="blog-alert blog-alert--notice" role="status">
      <ShieldCheck :size="16" /> A local recovery copy is available for this draft.
      <button type="button" class="blog-text-button" @click="openConflictReview">
        Review recovery copy
      </button>
    </p>

    <div v-if="loading" class="blog-state">
      <LoaderCircle class="blog-spin" :size="23" /> Loading editor…
    </div>
    <template v-else>
      <section class="blog-editor-shell">
        <BlogRibbon :editor="activeEditor" :find-text="editorState.findText" :replace-text="editorState.replaceText" @insert-media="openMediaDialog" @insert-gallery="openGalleryDialog" @insert-you-tube="openYouTubeDialog" />
        <div class="blog-editor-body">
          <div class="blog-editor-paper-wrap">
            <EditorContent :editor="editor" />
          </div>
          <aside v-if="inspectorOpen" class="blog-inspector" aria-label="Post details">
            <div class="blog-inspector__header">
              <h2>Post details</h2><button
                type="button" class="blog-icon-button" aria-label="Close details" @click="inspectorOpen = false"
              >
                <X :size="16" />
              </button>
            </div>
            <label class="blog-field"><span>Slug</span><input :value="draft.slug" autocomplete="off" :disabled="Boolean(detail?.post.published_version)" @input="setDraftField('slug', ($event.target as HTMLInputElement).value)"></label>
            <label class="blog-field"><span>Excerpt</span><textarea :value="draft.excerpt" rows="3" @input="setDraftField('excerpt', ($event.target as HTMLTextAreaElement).value)" /></label>
            <label class="blog-field"><span>Category</span><select :value="draft.category_id ?? ''" @change="setDraftField('category_id', ($event.target as HTMLSelectElement).value || null)"><option value="">Uncategorised</option><option v-for="category in taxonomy.categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label>
            <details class="blog-taxonomy-disclosure">
              <summary>Add category</summary>
              <form class="blog-taxonomy-create" @submit.prevent="addTaxonomy('category')">
                <label class="blog-field"><span>New category</span><input v-model="taxonomyNames.category" required maxlength="160" :disabled="taxonomySaving !== null" autocomplete="off"></label>
                <button type="submit" class="blog-button" :disabled="taxonomySaving !== null || !taxonomyNames.category.trim()">{{ taxonomySaving === 'category' ? 'Adding…' : 'Add category' }}</button>
              </form>
            </details>
            <fieldset class="blog-field blog-tag-options">
              <legend>Tags</legend>
              <p v-if="!taxonomy.tags.length" class="blog-inspector__empty">Add a tag to start organizing this post.</p>
              <label v-for="tag in taxonomy.tags" :key="tag.id" class="blog-toggle"><input type="checkbox" :checked="draft.tag_ids.includes(tag.id)" @change="setDraftField('tag_ids', ($event.target as HTMLInputElement).checked ? [...draft.tag_ids, tag.id] : draft.tag_ids.filter(id => id !== tag.id))"><span>{{ tag.name }}</span></label>
            </fieldset>
            <form class="blog-taxonomy-create" @submit.prevent="addTaxonomy('tag')">
              <label class="blog-field"><span>New tag</span><input v-model="taxonomyNames.tag" required maxlength="160" :disabled="taxonomySaving !== null" autocomplete="off"></label>
              <button type="submit" class="blog-button" :disabled="taxonomySaving !== null || !taxonomyNames.tag.trim()">{{ taxonomySaving === 'tag' ? 'Adding…' : 'Add tag' }}</button>
            </form>
            <label class="blog-field"><span>Cover image URL</span><input :value="draft.cover_image_url" type="url" placeholder="Protected asset URL" @input="setDraftField('cover_image_url', ($event.target as HTMLInputElement).value)"></label>
            <label class="blog-field"><span>Cover alt text</span><input :value="draft.cover_image_alt" @input="setDraftField('cover_image_alt', ($event.target as HTMLInputElement).value)"></label>
            <label class="blog-field"><span>Read time (minutes)</span><input :value="draft.read_minutes" type="number" min="1" max="999" @input="setDraftField('read_minutes', Number(($event.target as HTMLInputElement).value) || 1)"></label>
            <details class="blog-inspector__section">
              <summary>SEO</summary><div
                class="blog-inspector__section-body"
              >
                <label
                  class="blog-field"
                ><span>Meta title</span><input :value="draft.meta_title" @input="setDraftField('meta_title', ($event.target as HTMLInputElement).value)"></label><label
                  class="blog-field"
                ><span>Meta description</span><textarea :value="draft.meta_description" rows="3" @input="setDraftField('meta_description', ($event.target as HTMLTextAreaElement).value)" /></label>
              </div>
            </details>
            <details class="blog-inspector__section">
              <summary>Media block</summary><div
                class="blog-inspector__section-body"
              >
                <template v-if="selectedMediaAttrs">
                  <label
                    class="blog-field"
                  ><span>Width {{ selectedMediaAttrs.width }}%</span><input :value="selectedMediaAttrs.width" type="range" min="1" max="100" @input="updateSelectedMedia('width', Number(($event.target as HTMLInputElement).value))"></label><label
                    class="blog-field"
                  ><span>Alignment</span><select :value="selectedMediaAttrs.align" @change="updateSelectedMedia('align', ($event.target as HTMLSelectElement).value)"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label
                    class="blog-field"
                  ><span>Alt text</span><input :value="selectedMediaAttrs.alt" @input="updateSelectedMedia('alt', ($event.target as HTMLInputElement).value)"></label><label
                    class="blog-field"
                  ><span>Caption</span><input :value="selectedMediaAttrs.caption" @input="updateSelectedMedia('caption', ($event.target as HTMLInputElement).value)"></label><template v-if="selectedMediaAttrs.kind === 'video'"><label
                    class="blog-field"
                  ><span>Poster frame</span><select :value="selectedMediaAttrs.posterAssetId ?? ''" @change="updateSelectedMedia('posterAssetId', ($event.target as HTMLSelectElement).value)"><option value="">No poster</option><option v-for="asset in posterAssets" :key="asset.id" :value="asset.id">{{ asset.name }} · {{ asset.kind }}</option></select></label><p v-if="selectedPosterAsset" class="blog-inspector__media-note">
                    Using {{ selectedPosterAsset.name }} as the video poster.
                  </p><p v-else class="blog-inspector__media-note">
                    Choose a ready image or GIF asset. Generate named posters in the media library first.
                  </p><button type="button" class="blog-text-button" :disabled="mediaLoading" @click="loadMediaAssets">
                    <RefreshCw :size="14" :class="{ 'blog-spin': mediaLoading }" /> {{ mediaLoading ? 'Refreshing…' : 'Refresh poster choices' }}
                  </button></template>
                </template><p
                  v-else class="blog-inspector__empty"
                >
                  Select a media block in the document to edit it.
                </p>
              </div>
            </details>
          </aside>
          <button v-else type="button" class="blog-inspector-toggle" aria-label="Open post details" @click="inspectorOpen = true">
            <PanelRight :size="17" />
          </button>
        </div>
      </section>

      <div class="blog-editor-footer">
        <span><Clock3 :size="15" /> Last server update {{ formatDate(draft.updated_at) }}</span>
        <span><FileText :size="15" /> {{ wordCount }} words</span>
        <span><ShieldCheck :size="15" /> Private autosave after 2 seconds of inactivity</span>
        <div class="blog-editor-footer__actions">
          <button
            type="button" class="blog-text-button" @click="loadRevisions"
          >
            <History :size="15" /> Revisions
          </button><button
            type="button" class="blog-text-button" @click="exportHtml"
          >
            <Download :size="15" /> HTML
          </button><button
            type="button" class="blog-text-button" @click="printPdf"
          >
            <FileText :size="15" /> Browser PDF
          </button><button
            type="button" class="blog-text-button" :disabled="docxLoading" @click="chooseDocx"
          >
            <Upload :size="15" /> Import DOCX
          </button><button
            type="button" class="blog-text-button" :disabled="docxLoading" @click="exportDocx"
          >
            <Download :size="15" /> Export DOCX
          </button><input
            ref="docxInput" type="file" class="sr-only" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" @change="onDocxFile"
          >
        </div>
      </div>
    </template>

    <BlogModal
      v-if="legacyReview"
      v-model:open="legacyReviewOpen"
      title="Legacy conversion review"
      description="Review the legacy HTML conversion before applying it to the private draft."
      modal-class="blog-modal--wide"
    >
      <div class="blog-modal__header">
        <div>
          <p class="blog-eyebrow">
            Legacy conversion review
          </p><h2 id="legacy-title">
            Review before applying
          </h2>
        </div><button
          type="button" class="blog-icon-button" aria-label="Keep original HTML" @click="keepOriginalLegacy"
        >
          <X :size="18" />
        </button>
      </div>
      <p class="blog-modal__intro">
        The original HTML remains preserved as the source revision. This preview converts only supported structures into the standard editor document.
      </p>
      <div class="blog-conversion-grid">
        <div>
          <h3>Conversion report</h3><ul
            v-if="legacyReview.issues.length" class="blog-issue-list"
          >
            <li v-for="issue in legacyReview.issues" :key="issue.tag">
              <strong>&lt;{{ issue.tag }}&gt;</strong> ×{{ issue.count }} — {{ issue.message }}
            </li>
          </ul><p
            v-else class="blog-empty-note"
          >
            No unsupported structures found.
          </p>
        </div><div>
          <h3>Original source</h3><pre
            class="blog-source-preview"
          >{{ originalLegacyHtml }}</pre>
        </div>
      </div>
      <div class="blog-modal__footer">
        <button
          type="button" class="blog-button" @click="keepOriginalLegacy"
        >
          Keep original for now
        </button><button
          type="button" class="blog-button blog-button--primary" @click="applyLegacyConversion"
        >
          Apply converted draft
        </button>
      </div>
    </BlogModal>

    <BlogModal
      v-model:open="staleReviewOpen"
      title="Draft conflict review"
      description="Compare your private recovery copy with the latest server draft before applying it."
    >
      <div class="blog-modal__header">
        <div>
          <p class="blog-eyebrow">
            Concurrency check
          </p><h2 id="stale-title">
            Review before applying
          </h2>
        </div><button type="button" class="blog-icon-button" aria-label="Keep recovery copy and close" @click="keepRecoveryCopy">
          <X :size="18" />
        </button>
      </div>
      <p class="blog-modal__intro">
        Your private copy and the latest server draft are shown separately. Applying your copy uses the server version shown below and remains a private draft.
      </p>
      <div v-if="staleServerLoading" class="blog-state blog-state--small">
        <LoaderCircle :size="18" class="blog-spin" /> Loading the latest server version…
      </div>
      <p v-else-if="staleServerError" class="blog-alert blog-alert--error" role="alert">
        {{ staleServerError }} Your recovery copy remains available locally.
      </p>
      <div v-else-if="staleServerDetail" class="blog-conflict-grid">
        <article class="blog-conflict-pane">
          <h3>Your recovery copy</h3>
          <dl class="blog-conflict-meta">
            <div><dt>Title</dt><dd>{{ (staleLocalDraft ?? draft).title || 'Untitled' }}</dd></div>
            <div><dt>Slug</dt><dd>{{ (staleLocalDraft ?? draft).slug || '—' }}</dd></div>
            <div><dt>Local version</dt><dd>v{{ (staleLocalDraft ?? draft).version }}</dd></div>
          </dl>
          <pre class="blog-conflict-content">{{ collectDraftText(staleLocalDraft ?? draft) || '(empty document)' }}</pre>
        </article>
        <article class="blog-conflict-pane">
          <h3>Latest server draft</h3>
          <dl class="blog-conflict-meta">
            <div><dt>Title</dt><dd>{{ staleServerDetail.draft.title || 'Untitled' }}</dd></div>
            <div><dt>Slug</dt><dd>{{ staleServerDetail.draft.slug || '—' }}</dd></div>
            <div><dt>Server version</dt><dd>v{{ staleServerDetail.draft.version }}</dd></div>
          </dl>
          <pre class="blog-conflict-content">{{ collectDraftText(staleServerDetail.draft) || '(empty document)' }}</pre>
        </article>
      </div>
      <div class="blog-modal__footer">
        <button type="button" class="blog-button" @click="keepRecoveryCopy">
          Keep my copy locally
        </button><button type="button" class="blog-button" :disabled="staleApplyLoading" @click="reloadCurrent">
          Reload server version
        </button><button type="button" class="blog-button blog-button--primary" :disabled="!staleServerDetail || staleServerLoading || staleApplyLoading" @click="applyMyCopyToDraft">
          {{ staleApplyLoading ? 'Applying…' : 'Apply my copy to private draft' }}
        </button>
      </div>
    </BlogModal>

    <BlogModal v-model:open="previewOpen" title="Private preview" modal-class="blog-modal--preview">
      <div
        class="blog-modal__header"
      >
        <div>
          <p
            class="blog-eyebrow"
          >
            Private preview
          </p><h2 id="preview-title">
            Reader view
          </h2>
        </div><button
          type="button" class="blog-icon-button" aria-label="Close preview" @click="previewOpen = false"
        >
          <X :size="18" />
        </button>
      </div><iframe
        class="blog-preview-frame" :srcdoc="previewHtml" title="Private blog preview" sandbox="allow-same-origin"
      />
    </BlogModal>

    <BlogModal v-model:open="revisionsOpen" title="Draft history">
      <div
        class="blog-modal__header"
      >
        <div>
          <p
            class="blog-eyebrow"
          >
            Draft history
          </p><h2 id="revision-title">
            Revisions
          </h2>
        </div><button
          type="button" class="blog-icon-button" aria-label="Close revisions" @click="revisionsOpen = false"
        >
          <X :size="18" />
        </button>
      </div><div
        v-if="!revisions.length" class="blog-empty-note"
      >
        No checkpoints yet. Ctrl+S creates one.
      </div><div
        v-else class="blog-revision-list"
      >
        <div
          v-for="revision in revisions" :key="revision.id" class="
            blog-revision-row
          "
        >
          <div><strong>v{{ revision.version }} · {{ revision.title || 'Untitled' }}</strong><span>{{ revision.kind ?? 'checkpoint' }} · {{ formatDate(revision.created_at) }}</span></div><button
            type="button" class="blog-button blog-button--quiet" @click="restore(revision)"
          >
            <RotateCcw :size="15" /> Restore to draft
          </button>
        </div>
      </div>
    </BlogModal>

    <BlogModal v-model:open="mediaDialogOpen" title="Media library" modal-class="blog-modal--wide">
      <div
        class="blog-modal__header"
      >
        <div>
          <p
            class="blog-eyebrow"
          >
            Insert
          </p><h2 id="media-picker-title">
            Media library
          </h2>
        </div><button
          type="button" class="blog-icon-button" aria-label="Close media library" @click="mediaDialogOpen = false"
        >
          <X :size="18" />
        </button>
      </div><div
        v-if="mediaLoading" class="blog-state blog-state--small"
      >
        <LoaderCircle
          :size="18" class="blog-spin"
        /> Loading media…
      </div><div
        v-else-if="!mediaAssets.length" class="blog-empty-note"
      >
        No published or private media assets yet. Upload one in the media library.
      </div><div
        v-else class="blog-picker-grid"
      >
        <button
          v-for="asset in mediaAssets" :key="asset.id" type="button" class="
            blog-picker-card
          " @click="insertAsset(asset)"
        >
          <img v-if="asset.kind !== 'video'" :src="asset.source_url" :alt="asset.name"><div
            v-else class="blog-picker-card__video"
          >
            <Play :size="20" />
          </div><strong>{{ asset.name }}</strong><span>{{ asset.kind }} · {{ asset.mime_type }}</span>
        </button>
      </div><div
        class="blog-modal__footer"
      >
        <NuxtLink
          to="/admin/blog/media" class="blog-button"
        >
          <ExternalLink :size="15" /> Open media library
        </NuxtLink>
      </div>
    </BlogModal>
    <BlogModal v-model:open="galleryDialogOpen" title="Insert gallery" modal-class="blog-modal--wide">
      <div class="blog-modal__header">
        <div>
          <p class="blog-eyebrow">Insert</p>
          <h2>Finalized galleries</h2>
        </div>
        <button type="button" class="blog-icon-button" aria-label="Close gallery picker" @click="galleryDialogOpen = false">
          <X :size="18" />
        </button>
      </div>
      <p class="blog-modal__intro">Only immutable finalized revisions can appear in a published article.</p>
      <div v-if="galleryLoading" class="blog-state blog-state--small">
        <LoaderCircle :size="18" class="blog-spin" /> Loading galleries…
      </div>
      <div v-else-if="!gallerySummaries.length" class="blog-empty-note">
        No finalized galleries yet. Create one in the Galleries workspace.
      </div>
      <div v-else class="blog-picker-grid">
        <button v-for="gallery in gallerySummaries" :key="`${gallery.id}:${gallery.revision}`" type="button" class="blog-picker-card" @click="insertGallery(gallery.manifest_id || gallery.id)">
          <span class="blog-picker-card__video" aria-hidden="true"><FileText :size="20" /></span>
          <strong>{{ gallery.title || 'Untitled gallery' }}</strong>
          <span>Revision {{ gallery.revision }} · {{ gallery.page_count }} pages</span>
        </button>
      </div>
      <div class="blog-modal__footer">
        <NuxtLink to="/admin/blog/galleries" class="blog-button"><ExternalLink :size="15" /> Open galleries</NuxtLink>
      </div>
    </BlogModal>
    <BlogModal v-model:open="youtubeDialogOpen" title="Insert YouTube video">
      <div class="blog-modal__header">
        <div>
          <p class="blog-eyebrow">Insert</p>
          <h2>YouTube video</h2>
        </div>
        <button type="button" class="blog-icon-button" aria-label="Close YouTube dialog" @click="youtubeDialogOpen = false">
          <X :size="18" />
        </button>
      </div>
      <form class="blog-modal__form" @submit.prevent="insertYouTube">
        <label class="blog-field"><span>Video ID or URL</span><input v-model="youtubeVideoId" required maxlength="200" placeholder="hez2yR4GyTA" autocomplete="off"></label>
        <label class="blog-field"><span>Title (optional)</span><input v-model="youtubeTitle" maxlength="180" placeholder="Talk title"></label>
        <p v-if="youtubeError" class="blog-alert blog-alert--error" role="alert">{{ youtubeError }}</p>
        <div class="blog-modal__footer"><button type="submit" class="blog-button blog-button--primary">Insert video</button></div>
      </form>
    </BlogModal>
    <BlogModal v-if="docxReview" :open="true" title="DOCX import review" modal-class="blog-modal--wide" @update:open="docxReview = null">
      <div
        class="blog-modal__header"
      >
        <div>
          <p
            class="blog-eyebrow"
          >
            DOCX import review
          </p><h2 id="docx-title">
            Review converted content
          </h2>
        </div><button
          type="button" class="blog-icon-button" aria-label="Cancel DOCX import" @click="docxReview = null"
        >
          <X :size="18" />
        </button>
      </div><p
        class="blog-modal__intro"
      >
        Images were uploaded as private immutable source assets. Apply only after checking the converted text and any reported lossy constructs.
      </p><div
        class="blog-conversion-grid"
      >
        <div>
          <h3>Conversion report</h3><ul
            v-if="docxReview.messages.length || docxReview.document.issues.length" class="
              blog-issue-list
            "
          >
            <li v-for="message in docxReview.messages" :key="message">
              {{ message }}
            </li><li v-for="issue in docxReview.document.issues" :key="issue.tag">
              <strong>&lt;{{ issue.tag }}&gt;</strong> ×{{ issue.count }} — {{ issue.message }}
            </li>
          </ul><p
            v-else class="blog-empty-note"
          >
            No lossy constructs reported.
          </p>
        </div><div>
          <h3>Converted HTML preview</h3><div
            class="blog-source-preview" v-html="docxReview.html"
          />
        </div>
      </div><div
        class="blog-modal__footer"
      >
        <button
          type="button" class="blog-button" @click="docxReview = null"
        >
          Keep current draft
        </button><button
          type="button" class="blog-button blog-button--primary" @click="applyDocxConversion"
        >
          Apply converted draft
        </button>
      </div>
    </BlogModal>
  </main>
</template>
