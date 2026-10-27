<script setup lang="ts">
import type { GalleryManifest, GalleryPage, GalleryRevisionSummary } from '@/utils/content-calendar'
import { ArrowLeft, Check, ChevronDown, ChevronUp, FileText, LoaderCircle, LockKeyhole, Save, Send, ShieldCheck, Upload, X } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { useGalleryPdfUpload } from '@/composables/useGalleryPdfUpload'
import { formatBytes, formatDate } from '@/utils/blog-studio'
import BlogModal from './BlogModal.vue'

const route = useRoute()
const api = useBlogApi()
const galleryId = computed(() => String(route.params.id || ''))
const gallery = ref<GalleryManifest | null>(null)
const revisions = ref<GalleryRevisionSummary[]>([])
const loading = ref(true)
const saving = ref(false)
const finalizing = ref(false)
const processingPages = ref(false)
const processingPage = ref(0)
const error = ref('')
const notice = ref('')
const sourceInput = ref<HTMLInputElement | null>(null)
const selectedRevision = ref('')
const previewPage = ref<GalleryPage | null>(null)
const showSourceRules = ref(false)
const orderDirty = ref(false)
const pageMetadataDirty = ref(false)
const renderAbortController = ref<AbortController | null>(null)

const form = reactive({
  title: '',
})

const galleryVersion = computed(() => gallery.value?.version ?? 0)
const displayPages = computed<GalleryPage[]>(() => {
  if (!gallery.value)
    return []
  const existing = new Map(gallery.value.pages.map(page => [page.page_number, page]))
  const pageCount = Math.max(gallery.value.page_count, gallery.value.pages.length)
  return Array.from({ length: pageCount }, (_, index) => (existing.get(index + 1) ?? {
    page_number: index + 1,
    original_page: index + 1,
    order: index,
    title: null,
    caption: null,
    visible: true,
    status: 'pending',
    width: null,
    height: null,
    image_asset_id: null,
    thumbnail_asset_id: null,
    asset_id: null,
    image: null,
    thumbnail: null,
  }) as GalleryPage)
})
const upload = useGalleryPdfUpload(galleryId, galleryVersion, (updated) => {
  gallery.value = updated
  syncForm(updated)
  notice.value = 'Original PDF uploaded. Page rendering can continue from the saved manifest.'
  void refreshRevisions()
})

function syncForm(value: GalleryManifest) {
  form.title = value.title
}

async function refreshRevisions() {
  if (!galleryId.value)
    return
  try {
    revisions.value = (await api.listGalleryRevisions(galleryId.value)).revisions
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load finalized revisions.'
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.getGallery(galleryId.value)
    gallery.value = result
    syncForm(result)
    await refreshRevisions()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load the gallery.'
  }
  finally {
    loading.value = false
  }
}

async function onSourceFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!file)
    return
  error.value = ''
  notice.value = ''
  try {
    await upload.selectFile(file)
    if (upload.task.value?.status === 'error')
      error.value = upload.task.value.error
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not start the PDF upload.'
  }
}

async function saveDraft() {
  if (!gallery.value || saving.value)
    return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    // Keep the local permutation and page metadata while the gallery-level CAS
    // update returns a fresh server snapshot. The response may still contain
    // the old order, so taking this snapshot before replacing gallery.value is
    // essential.
    const localPages = (orderDirty.value || pageMetadataDirty.value)
      ? orderedPages().map(page => ({ ...page }))
      : []
    const payload: { version: number, title: string, page_count?: number, resume_page?: number } = {
      version: gallery.value.version,
      title: form.title.trim(),
      resume_page: gallery.value.resume.next_page,
    }
    if (gallery.value.page_count > 0)
      payload.page_count = gallery.value.page_count
    gallery.value = await api.updateGallery(gallery.value.id, payload)
    if (orderDirty.value) {
      const pageIds = localPages.map(page => page.id).filter((id): id is string => Boolean(id))
      if (pageIds.length !== localPages.length)
        throw new Error('Every attached page needs a server ID before its order can be saved.')
      gallery.value = await api.reorderGalleryPages(gallery.value.id, { version: gallery.value.version, page_ids: pageIds })
    }
    if (pageMetadataDirty.value) {
      for (const page of localPages) {
        if (!page.id || !page.image_asset_id || !page.thumbnail_asset_id)
          continue
        gallery.value = await api.updateGalleryPage(gallery.value.id, page.id, {
          version: gallery.value.version,
          page: {
            original_page: page.page_number,
            title: page.title,
            caption: page.caption,
            order: page.order,
            visible: page.visible,
            asset_id: page.image_asset_id,
            thumbnail_asset_id: page.thumbnail_asset_id,
          },
        })
      }
    }
    orderDirty.value = false
    pageMetadataDirty.value = false
    syncForm(gallery.value)
    notice.value = 'Gallery draft saved.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not save the gallery draft. Refresh and review the conflict.'
  }
  finally {
    saving.value = false
  }
}

async function createNewDraft() {
  if (!gallery.value || gallery.value.status !== 'finalized' || saving.value)
    return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    // A revision view may carry only manifest metadata, so read the current
    // owner row before sending the CAS version used to reopen the draft.
    const current = await api.getGallery(gallery.value.id)
    gallery.value = await api.createGalleryDraft(current.id, current.version)
    orderDirty.value = false
    pageMetadataDirty.value = false
    syncForm(gallery.value)
    await refreshRevisions()
    notice.value = 'A new editable gallery draft is ready. The finalized revision remains immutable.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not create a new gallery draft. Refresh and review the conflict.'
  }
  finally {
    saving.value = false
  }
}

function orderedPages() {
  return displayPages.value.slice().sort((left, right) => left.order - right.order || left.page_number - right.page_number)
}

function movePage(page: GalleryPage, delta: -1 | 1) {
  if (!gallery.value || gallery.value.status === 'finalized')
    return
  const pages = orderedPages()
  if (pages.some(item => !item.id)) {
    error.value = 'Render and attach every page before changing the order.'
    return
  }
  const index = pages.findIndex(item => item.page_number === page.page_number)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= pages.length)
    return
  const other = pages[nextIndex]
  if (!other)
    return
  const order = page.order
  page.order = other.order
  other.order = order
  gallery.value.pages = pages
  orderDirty.value = true
  notice.value = 'Page order changed locally. Save the draft to commit it.'
}

async function finalize() {
  if (!gallery.value || finalizing.value || gallery.value.status === 'finalized')
    return
  const incomplete = gallery.value.page_count < 1
    || gallery.value.pages.length !== gallery.value.page_count
    || gallery.value.pages.some(page => page.status !== 'complete' || !page.image_asset_id || !page.thumbnail_asset_id)
  if (incomplete) {
    error.value = 'Render and attach every page image and thumbnail before finalizing.'
    return
  }
  finalizing.value = true
  error.value = ''
  try {
    gallery.value = await api.finalizeGallery(gallery.value.id, { version: gallery.value.version })
    syncForm(gallery.value)
    await refreshRevisions()
    notice.value = `Revision ${gallery.value.revision} finalized and locked.`
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not finalize this gallery revision.'
  }
  finally {
    finalizing.value = false
  }
}

async function uploadDerivedBlob(blob: Blob, filename: string, width: number, height: number) {
  const file = new File([blob], filename, { type: 'image/webp', lastModified: Date.now() })
  const started = await api.startUpload({ filename, mime_type: 'image/webp', size: file.size, width, height })
  const ranges = []
  for (let offset = 0, part = 1; offset < file.size; offset += 10 * 1024 * 1024, part += 1)
    ranges.push({ part_number: part, start: offset, end: Math.min(file.size, offset + 10 * 1024 * 1024) })
  const parts = []
  for (const range of ranges) {
    const receipt = await api.putUploadPart(started.upload.id, range.part_number, file.slice(range.start, range.end))
    parts.push(receipt)
  }
  return (await api.completeUpload(started.upload.id, parts)).asset
}

async function renderAndAttachPages() {
  if (!gallery.value || !upload.task.value?.file || processingPages.value)
    return
  const document = upload.task.value.document
  if (!document) {
    error.value = 'Select the source PDF again to start a rendering session.'
    return
  }
  processingPages.value = true
  renderAbortController.value = new AbortController()
  error.value = ''
  notice.value = ''
  try {
    const existingPages = new Map(gallery.value.pages.map(page => [page.page_number, page]))
    const pageCount = Math.max(gallery.value.page_count, gallery.value.pages.length)
    const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1)
      .filter((pageNumber) => {
        const page = existingPages.get(pageNumber)
        return !page || page.status !== 'complete' || !page.image_asset_id || !page.thumbnail_asset_id
      })
    for (const pageNumber of pageNumbers) {
      const page = existingPages.get(pageNumber) ?? {
        page_number: pageNumber,
        original_page: pageNumber,
        order: pageNumber - 1,
        title: null,
        caption: null,
        visible: true,
        status: 'pending' as const,
      }
      processingPage.value = page.page_number
      const rendered = await document.renderPagePair(page.page_number, renderAbortController.value.signal)
      const image = await uploadDerivedBlob(rendered.full.blob, `${gallery.value.id}-page-${page.page_number}.webp`, rendered.full.width, rendered.full.height)
      const thumb = await uploadDerivedBlob(rendered.thumbnail.blob, `${gallery.value.id}-page-${page.page_number}-thumb.webp`, rendered.thumbnail.width, rendered.thumbnail.height)
      gallery.value = await api.attachGalleryPage(gallery.value.id, {
        version: gallery.value.version,
        page: {
          original_page: page.page_number,
          title: page.title,
          caption: page.caption,
          order: page.order,
          visible: page.visible,
          asset_id: image.id,
          thumbnail_asset_id: thumb.id,
        },
      })
      existingPages.set(pageNumber, gallery.value.pages.find(item => item.page_number === pageNumber) ?? page)
    }
    notice.value = 'All complete pages are attached. Review the order, then finalize a new immutable revision.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Page rendering stopped. Retry from the next incomplete page.'
  }
  finally {
    processingPages.value = false
    processingPage.value = 0
    renderAbortController.value = null
  }
}

function cancelRendering() {
  renderAbortController.value?.abort()
}

async function openRevision() {
  if (!selectedRevision.value)
    return
  try {
    gallery.value = await api.getGalleryRevision(galleryId.value, selectedRevision.value)
    syncForm(gallery.value)
    notice.value = `Viewing finalized revision ${gallery.value.revision}.`
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load that finalized revision.'
  }
}

function imageUrl(page: GalleryPage, thumbnail = false) {
  const asset = thumbnail ? page.thumbnail : page.image
  const assetId = thumbnail ? page.thumbnail_asset_id : page.image_asset_id
  return asset?.source_url || (assetId ? `/api/admin/blog/media/${encodeURIComponent(assetId)}/source` : '')
}

onMounted(load)
</script>

<template>
  <main class="blog-studio-page">
    <div class="blog-page-heading">
      <div>
        <NuxtLink to="/admin/blog/galleries" class="blog-back-link">
          <ArrowLeft :size="16" /> Galleries
        </NuxtLink>
        <p class="blog-eyebrow">
          Private gallery workspace
        </p>
        <h1>{{ form.title || 'Untitled gallery' }}</h1>
        <p class="blog-page-intro">
          Upload one PDF, render pages at native pixels, and save a finalized manifest when every derived asset has been checked.
        </p>
      </div>
      <div class="blog-page-actions">
        <span v-if="gallery" class="blog-status" :data-status="gallery.status">{{ gallery.status }} · v{{ gallery.version }}</span>
        <button v-if="gallery?.status === 'finalized'" type="button" class="blog-button" :disabled="saving || loading" @click="createNewDraft">
          <FileText :size="16" /> {{ saving ? 'Creating…' : 'Edit as new draft' }}
        </button>
        <button type="button" class="blog-button" :disabled="saving || loading || gallery?.status === 'finalized'" @click="saveDraft">
          <Save :size="16" /> {{ saving ? 'Saving…' : 'Save draft' }}
        </button>
        <button type="button" class="blog-button blog-button--primary" :disabled="finalizing || loading || gallery?.status === 'finalized'" @click="finalize">
          <Send :size="16" /> {{ finalizing ? 'Finalizing…' : 'Finalize revision' }}
        </button>
      </div>
    </div>
    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="blog-alert blog-alert--notice" role="status">
      <Check :size="16" /> {{ notice }}
    </p>
    <section v-if="loading" class="blog-state">
      <LoaderCircle
        :size="22" class="blog-spin"
      /> Loading gallery…
    </section>
    <template v-else-if="gallery">
      <section class="blog-panel gallery-editor-grid">
        <div>
          <div class="blog-panel__header">
            <div>
              <p class="blog-eyebrow">
                Manifest metadata
              </p><h2>Gallery details</h2>
            </div><LockKeyhole :size="21" aria-hidden="true" />
          </div>
          <label class="blog-field"><span>Title</span><input v-model="form.title" maxlength="180" :disabled="gallery.status === 'finalized'"></label>
          <p class="blog-panel__note">
            <ShieldCheck :size="15" /> Source PDFs remain owner-only. Edit each page caption and visibility below; the article draft controls when a finalized manifest becomes public.
          </p>
        </div>
        <div>
          <div class="blog-panel__header">
            <div>
              <p class="blog-eyebrow">
                Original PDF
              </p><h2>{{ gallery.source_filename || 'No source uploaded' }}</h2>
            </div><FileText :size="21" aria-hidden="true" />
          </div>
          <p v-if="gallery.source_size" class="blog-panel__note">
            {{ formatBytes(gallery.source_size) }} · {{ gallery.page_count }} pages · maximum 512 pages
          </p>
          <input
            ref="sourceInput" type="file" accept="application/pdf,.pdf" class="
              sr-only
            " @change="onSourceFile"
          >
          <div class="gallery-source-actions">
            <button
              type="button" class="blog-button blog-button--primary" :disabled="gallery.status === 'finalized' || upload.task.value?.status === 'uploading'" @click="sourceInput?.click()"
            >
              <Upload :size="16" /> Choose PDF
            </button><button
              v-if="upload.task.value?.status === 'uploading' || upload.task.value?.status === 'paused'" type="button" class="
                blog-button blog-button--quiet
              " @click="upload.cancel"
            >
              Pause
            </button><button
              v-if="upload.task.value?.status === 'error' || upload.task.value?.status === 'paused'" type="button" class="
                blog-button blog-button--quiet
              " @click="upload.retry"
            >
              Retry / resume
            </button>
          </div>
          <div v-if="upload.task.value" class="gallery-upload-status" aria-live="polite">
            <div
              class="gallery-upload-status__row"
            >
              <strong>{{ upload.task.value.filename }}</strong><span>{{ upload.task.value.status }}</span>
            </div><progress max="100" :value="upload.progress.value" /> <small>{{ upload.progress.value }}% · {{ formatBytes(upload.task.value.uploadedBytes) }} of {{ formatBytes(upload.task.value.size) }}</small><p
              v-if="upload.task.value.error" class="
                blog-alert blog-alert--error
              "
            >
              {{ upload.task.value.error }}
            </p>
          </div>
          <button type="button" class="blog-text-button" @click="showSourceRules = !showSourceRules">
            {{ showSourceRules ? 'Hide' : 'Show' }} upload rules
          </button>
          <ul v-if="showSourceRules" class="blog-issue-list">
            <li>PDF only, up to 250 MiB and 512 pages.</li><li>Uploads use resumable 10 MiB parts with at most two transfers.</li><li>Reload recovery needs the same source file selected again.</li>
          </ul>
        </div>
      </section>
      <section class="blog-panel">
        <div class="blog-panel__header">
          <div>
            <p class="blog-eyebrow">
              Derived pages
            </p><h2>{{ gallery.pages.length }} page records</h2>
          </div><button
            type="button" class="blog-button" :disabled="gallery.status === 'finalized' || !upload.task.value?.file" @click="processingPages ? cancelRendering() : renderAndAttachPages()"
          >
            <LoaderCircle
              v-if="processingPages" :size="16" class="blog-spin"
            /><FileText v-else :size="16" /> {{ processingPages ? `Stop at page ${processingPage}` : 'Render incomplete pages' }}
          </button>
        </div>
        <p class="blog-panel__note">
          Pages are rendered and uploaded one at a time. Completed page records are skipped on retry, and the source PDF is never exposed through this preview.
        </p>
        <div class="gallery-page-list">
          <article
            v-for="page in orderedPages()" :key="page.page_number" class="
              gallery-page-row
            " :class="{ 'is-complete': page.status === 'complete' }"
          >
            <button type="button" class="gallery-page-thumb" :aria-label="`Preview page ${page.page_number}`" @click="previewPage = page">
              <img v-if="imageUrl(page, true)" :src="imageUrl(page, true)" :alt="`Page ${page.page_number} thumbnail`"><span v-else>{{ page.page_number }}</span>
            </button>
            <div class="gallery-page-copy">
              <strong>Page {{ page.page_number }}</strong><span>{{ page.width && page.height ? `${page.width} × ${page.height}px` : 'Waiting for render' }} · {{ page.status }}</span>
              <label class="gallery-page-field"><span>Title</span><input v-model="page.title" maxlength="180" :disabled="gallery.status === 'finalized'" @input="pageMetadataDirty = true"></label>
              <label class="gallery-page-field"><span>Caption</span><textarea v-model="page.caption" rows="2" maxlength="2000" :disabled="gallery.status === 'finalized'" @input="pageMetadataDirty = true" /></label>
              <label class="gallery-page-visibility"><input v-model="page.visible" type="checkbox" :disabled="gallery.status === 'finalized'" @change="pageMetadataDirty = true"> Visible in the manifest</label>
            </div>
            <div class="gallery-page-actions">
              <button
                type="button" class="blog-icon-button" :disabled="gallery.status === 'finalized'" :aria-label="`Move page ${page.page_number} earlier`" @click="movePage(page, -1)"
              >
                <ChevronUp :size="15" />
              </button><button
                type="button" class="blog-icon-button" :disabled="gallery.status === 'finalized'" :aria-label="`Move page ${page.page_number} later`" @click="movePage(page, 1)"
              >
                <ChevronDown :size="15" />
              </button>
            </div>
          </article>
        </div>
      </section>
      <section class="blog-panel">
        <div class="blog-panel__header">
          <div>
            <p class="blog-eyebrow">
              Finalized revisions
            </p><h2>Immutable gallery history</h2>
          </div><select v-model="selectedRevision" aria-label="Select finalized gallery revision">
            <option value="">
              Choose a revision…
            </option><option v-for="revision in revisions" :key="revision.id" :value="revision.id">
              Revision {{ revision.revision }} · {{ revision.page_count }} pages
            </option>
          </select><button
            type="button" class="blog-button" :disabled="!selectedRevision" @click="openRevision"
          >
            View revision
          </button>
        </div>
        <p v-if="!revisions.length" class="blog-empty-note">
          No finalized revisions yet.
        </p>
        <div v-else class="gallery-revision-list">
          <div
            v-for="revision in revisions" :key="revision.id" class="
              gallery-revision-row
            "
          >
            <strong>Revision {{ revision.revision }} · {{ revision.title || 'Untitled gallery' }}</strong><span>{{ revision.page_count }} pages · {{ formatDate(revision.finalized_at || revision.created_at) }}</span>
          </div>
        </div>
      </section>
    </template>
    <BlogModal v-if="previewPage" :open="true" title="Gallery page preview" modal-class="blog-modal--preview" @update:open="previewPage = null">
      <div class="gallery-page-preview">
        <div class="blog-panel__header">
          <div>
            <p class="blog-eyebrow">
              Original page number {{ previewPage.page_number }}
            </p><h2>Page {{ previewPage.page_number }}</h2>
          </div><button type="button" class="blog-icon-button" aria-label="Close page preview" @click="previewPage = null">
            <X :size="17" />
          </button>
        </div>
        <img v-if="imageUrl(previewPage)" :src="imageUrl(previewPage)" :alt="previewPage.title || `Gallery page ${previewPage.page_number}`" class="gallery-page-preview__image">
        <p v-else class="blog-empty-note">
          This page has no full-size render yet.
        </p>
        <p v-if="previewPage.caption" class="gallery-page-preview__caption">
          {{ previewPage.caption }}
        </p>
      </div>
    </BlogModal>
  </main>
</template>
