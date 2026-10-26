<script setup lang="ts">
import type { MediaClip, BlogMediaProject as SharedMediaProject } from '#shared/blog-media-project'
import type { BlogMediaSelectionToken } from './blog-media-library-state'
import type { BlogAsset, BlogMediaProject } from '@/utils/blog-studio'
import { Check, ChevronDown, Crop, FlipHorizontal, FlipVertical, FolderOpen, Image, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Save, Scissors, Trash2, Upload, Video, WandSparkles, X } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { useBlogMediaUpload } from '@/composables/useBlogMediaUpload'
import { formatBytes, formatDate } from '@/utils/blog-studio'
import { cloneBlogMediaDocument, createBlogMediaSelectionGuard, isCurrentBlogMediaDocument, isValidBlogClipIndex } from './blog-media-library-state'

type Clip = MediaClip
type MediaProjectDocument = SharedMediaProject

const api = useBlogApi()
const assets = ref<BlogAsset[]>([])
const projects = ref<BlogMediaProject[]>([])
const selectedAsset = ref<BlogAsset | null>(null)
const selectedProjectId = ref<string | null>(null)
const project = ref<MediaProjectDocument | null>(null)
const projectVersion = ref(0)
const activeClip = ref(0)
const loading = ref(true)
const error = ref('')
const notice = ref('')
const operation = ref<{ stage: string, ratio: number | null, message: string } | null>(null)
const processor = ref<{ render: (document: MediaProjectDocument) => Promise<{ blob: Blob, mime_type: string, filename: string, width: number, height: number, duration_ms: number, poster?: Blob }>, decodeGif: (assetId: string) => Promise<{ width: number, height: number, duration_ms: number, frames: { source_index: number, delay_ms: number, blob: Blob }[] }>, poster: (assetId: string, timeMs: number) => Promise<Blob>, cancel: () => void, dispose: () => void } | null>(null)
const uploadInput = ref<HTMLInputElement | null>(null)
const upload = useBlogMediaUpload((asset) => {
  if (!assets.value.some(item => item.id === asset.id))
    assets.value.unshift(asset)
  notice.value = `${asset.name} uploaded`
})
const uploadTasks = upload.tasks
const recoverableUploads = upload.recoverableEntries
const pendingRecoveries = computed(() => recoverableUploads.value.filter(entry => !uploadTasks.value.some(task => task.id === entry.id)))
const posterTimeMs = ref(0)
const posterAssetId = ref('')
const appendAssetId = ref('')
const gifFramePreviews = ref<Record<number, string>>({})
const lastExport = ref<{ url: string, filename: string, mime: string } | null>(null)
const splitAtMs = ref(0)
const activeUploadTaskId = ref<string | null>(null)
const activeUploadMessage = ref('Uploading derived media…')
const selectionGuard = createBlogMediaSelectionGuard()

const currentClip = computed(() => project.value?.clips[activeClip.value] ?? null)
const previewAsset = computed(() => assets.value.find(asset => asset.id === currentClip.value?.asset_id) ?? selectedAsset.value)
const selectedAssetPreview = computed(() => previewAsset.value?.source_url ?? '')
const sourceBytes = computed(() => {
  const ids = new Set(project.value?.clips.map(clip => clip.asset_id) ?? [])
  return assets.value.filter(asset => ids.has(asset.id)).reduce((total, asset) => total + asset.size, 0)
})
const isOverSourceLimit = computed(() => sourceBytes.value > 250 * 1024 * 1024)
const generatedPosterAsset = computed(() => posterAssetId.value ? assets.value.find(asset => asset.id === posterAssetId.value) ?? null : null)
const previewStyle = computed(() => {
  const clip = currentClip.value
  const crop = clip?.crop
  return {
    filter: `brightness(${1 + (clip?.brightness ?? 0)}) contrast(${clip?.contrast ?? 1}) saturate(${clip?.grayscale ? 0 : clip?.saturation ?? 1})`,
    transform: `rotate(${clip?.rotate ?? 0}deg) scale(${clip?.flip_x ? -1 : 1}, ${clip?.flip_y ? -1 : 1})`,
    clipPath: crop ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)` : undefined,
  }
})

watch(currentClip, (clip) => {
  splitAtMs.value = clip ? Math.round((clip.in_ms + clip.out_ms) / 2) : 0
})

function clearFramePreviews() {
  for (const url of Object.values(gifFramePreviews.value))
    URL.revokeObjectURL(url)
  gifFramePreviews.value = {}
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.listMedia()
    assets.value = result.assets
    projects.value = result.projects
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load media.'
  }
  finally {
    loading.value = false
  }
}

async function selectAsset(asset: BlogAsset) {
  if (operation.value)
    return
  const token = selectionGuard.begin(asset.id)
  clearFramePreviews()
  error.value = ''
  selectedAsset.value = asset
  selectedProjectId.value = null
  project.value = null
  activeClip.value = 0
  posterAssetId.value = ''
  appendAssetId.value = ''
  lastExport.value && URL.revokeObjectURL(lastExport.value.url)
  lastExport.value = null
  try {
    const media = await import('@/utils/blog-media')
    if (!selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null))
      return
    const nextProject = media.createMediaProject(asset.kind, asset) as MediaProjectDocument
    project.value = nextProject
    const activeProject = project.value
    if (asset.kind === 'gif' && activeProject)
      await decodeFrames(true, token, asset, activeProject)
  }
  catch (reason: unknown) {
    if (selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null))
      error.value = reason instanceof Error ? reason.message : 'Could not create the media project.'
  }
}

async function selectProject(saved: BlogMediaProject) {
  if (operation.value)
    return
  clearFramePreviews()
  error.value = ''
  const nextProject = cloneBlogMediaDocument(saved.document) as MediaProjectDocument
  const sourceId = nextProject?.clips[0]?.asset_id ?? null
  const sourceAsset = assets.value.find(asset => asset.id === sourceId) ?? null
  const token = selectionGuard.begin(sourceAsset?.id ?? null)
  selectedProjectId.value = saved.id
  projectVersion.value = saved.version
  selectedAsset.value = sourceAsset
  project.value = nextProject
  activeClip.value = 0
  posterAssetId.value = ''
  appendAssetId.value = ''
  lastExport.value && URL.revokeObjectURL(lastExport.value.url)
  lastExport.value = null
  const activeProject = project.value
  if (activeProject?.kind === 'gif') {
    try {
      await decodeFrames(false, token, sourceAsset, activeProject)
    }
    catch (reason) {
      if (selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null))
        error.value = reason instanceof Error ? reason.message : 'Could not read the source frames.'
    }
  }
}

async function decodeFrames(resetSelection: boolean, token: BlogMediaSelectionToken, asset: BlogAsset | null, document: MediaProjectDocument) {
  if (!asset || !document || asset.kind !== 'gif')
    return
  const active = await getProcessor()
  if (!active || !selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null) || !isCurrentBlogMediaDocument(project.value, document))
    return
  try {
    const decoded = await active.decodeGif(asset.id)
    if (!selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null) || !isCurrentBlogMediaDocument(project.value, document))
      return
    clearFramePreviews()
    gifFramePreviews.value = Object.fromEntries(decoded.frames.map(frame => [frame.source_index, URL.createObjectURL(frame.blob)]))
    if (resetSelection) {
      document.frames = decoded.frames.map(frame => ({ source_index: frame.source_index, delay_ms: frame.delay_ms, enabled: true }))
      document.output.width = Math.max(2, Math.floor(Math.min(decoded.width, 720) / 2) * 2)
      document.output.height = Math.max(2, Math.floor(Math.min(decoded.height, 720) / 2) * 2)
      document.output.fps = 15
    }
  }
  finally {
    if (selectionGuard.isCurrent(token, selectedAsset.value?.id ?? null))
      operation.value = null
  }
}

async function getProcessor() {
  if (processor.value)
    return processor.value
  if (!selectedAsset.value)
    return null
  const media = await import('@/utils/blog-media')
  processor.value = media.createBlogMediaProcessor({
    resolveAsset: async (assetId: string, signal?: AbortSignal) => {
      const asset = assets.value.find(item => item.id === assetId)
      if (!asset)
        throw new Error('The selected source asset is unavailable.')
      const response = await fetch(asset.source_url, { credentials: 'include', signal })
      if (!response.ok)
        throw new Error(`Could not read ${asset.name} (${response.status}).`)
      return response.blob()
    },
    onProgress: (progress: { stage: string, ratio: number | null, message: string }) => { operation.value = progress },
  }) as unknown as NonNullable<typeof processor.value>
  return processor.value
}

function syncUploadOperation() {
  if (!activeUploadTaskId.value)
    return
  const task = uploadTasks.value.find(item => item.id === activeUploadTaskId.value)
  if (!task)
    return
  if (['queued', 'uploading'].includes(task.status)) {
    operation.value = {
      stage: 'upload',
      ratio: task.totalBytes ? task.uploadedBytes / task.totalBytes : null,
      message: activeUploadMessage.value,
    }
  }
}

watch(uploadTasks, syncUploadOperation, { deep: true })

async function uploadDerived(file: File, sourceIds: string[], message: string) {
  activeUploadMessage.value = message
  activeUploadTaskId.value = null
  return upload.upload(file, sourceIds, (task) => {
    activeUploadTaskId.value = task.id
    syncUploadOperation()
  })
}

function cancelOperation() {
  processor.value?.cancel()
  const task = activeUploadTaskId.value ? uploadTasks.value.find(item => item.id === activeUploadTaskId.value) : null
  if (task)
    void upload.cancel(task)
}

function isAbortError(reason: unknown) {
  return (reason instanceof DOMException && reason.name === 'AbortError') || (reason instanceof Error && reason.name === 'AbortError')
}

function updateProject(mutator: (document: MediaProjectDocument) => void) {
  if (!project.value)
    return
  mutator(project.value)
  project.value = { ...project.value, clips: [...project.value.clips], frames: [...project.value.frames], output: { ...project.value.output } }
}

async function saveProject() {
  if (!project.value || !selectedAsset.value)
    return
  try {
    const title = `${selectedAsset.value.name} edit`
    const result = selectedProjectId.value
      ? await api.updateProject(selectedProjectId.value, { version: projectVersion.value, title, document: project.value })
      : await api.createProject({ title, document: project.value })
    selectedProjectId.value = result.project.id
    projectVersion.value = result.project.version
    const index = projects.value.findIndex(item => item.id === result.project.id)
    if (index >= 0)
      projects.value[index] = result.project
    else
      projects.value.unshift(result.project)
    notice.value = 'Private media project saved'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not save this media project.'
  }
}

async function renderProject() {
  if (!project.value || !selectedAsset.value)
    return
  const active = await getProcessor()
  if (!active)
    return
  if (isOverSourceLimit.value) {
    error.value = 'The project exceeds the 250 MiB source limit.'
    return
  }
  const document = JSON.parse(JSON.stringify(project.value)) as MediaProjectDocument
  const sourceIds = [...new Set(document.clips.map(clip => clip.asset_id))]
  const sourceName = selectedAsset.value.name
  error.value = ''
  notice.value = ''
  operation.value = { stage: 'render', ratio: 0, message: 'Preparing derived media…' }
  try {
    const output = await active.render(document)
    if (lastExport.value)
      URL.revokeObjectURL(lastExport.value.url)
    lastExport.value = { url: URL.createObjectURL(output.blob), filename: output.filename, mime: output.mime_type }
    const file = new File([output.blob], output.filename, { type: output.mime_type })
    const result = await uploadDerived(file, sourceIds, 'Uploading derived media…')
    activeUploadTaskId.value = null
    if (result.status === 'cancelled') {
      notice.value = 'Derived export kept locally; its upload was cancelled.'
      return
    }
    if (result.status !== 'complete')
      throw new Error(result.error || 'The export is ready locally. Resume its upload in Transfers or download the file below.')
    if (output.poster) {
      const posterFile = new File([output.poster], `${sourceName}-poster.png`, { type: 'image/png' })
      const posterTask = await uploadDerived(posterFile, sourceIds, 'Uploading generated poster…')
      activeUploadTaskId.value = null
      posterAssetId.value = posterTask.status === 'complete' ? posterTask.asset?.id ?? '' : ''
      if (posterTask.status === 'cancelled') {
        notice.value = 'Derived media uploaded; poster upload was cancelled.'
        return
      }
    }
    notice.value = 'Derived media uploaded as a new immutable asset'
    await load()
  }
  catch (reason: unknown) {
    if (isAbortError(reason))
      notice.value = 'Media render cancelled.'
    else
      error.value = reason instanceof Error ? reason.message : 'Could not render this project.'
  }
  finally {
    activeUploadTaskId.value = null
    operation.value = null
  }
}

async function generatePoster() {
  if (!selectedAsset.value || selectedAsset.value.kind !== 'video')
    return
  const active = await getProcessor()
  if (!active)
    return
  const asset = selectedAsset.value
  operation.value = { stage: 'poster', ratio: null, message: 'Preparing selected poster…' }
  try {
    const blob = await active.poster(asset.id, Math.max(0, posterTimeMs.value))
    const task = await uploadDerived(new File([blob], `${asset.name}-poster.png`, { type: 'image/png' }), [asset.id], 'Uploading generated poster…')
    activeUploadTaskId.value = null
    posterAssetId.value = task.status === 'complete' ? task.asset?.id ?? '' : ''
    notice.value = posterAssetId.value
      ? 'Poster generated as a private derived asset'
      : task.status === 'cancelled' ? 'Poster export kept locally; its upload was cancelled.' : 'Poster upload did not complete'
  }
  catch (reason: unknown) {
    if (isAbortError(reason))
      notice.value = 'Poster render cancelled.'
    else
      error.value = reason instanceof Error ? reason.message : 'Could not generate a poster.'
  }
  finally {
    activeUploadTaskId.value = null
    operation.value = null
  }
}

function splitClip() {
  const clip = currentClip.value
  if (!clip || !project.value)
    return
  const midpoint = Math.round(splitAtMs.value)
  if (midpoint <= clip.in_ms || midpoint >= clip.out_ms) {
    error.value = 'Choose a split point inside the trimmed clip.'
    return
  }
  const second = { ...clip, id: crypto.randomUUID(), in_ms: midpoint }
  clip.out_ms = midpoint
  project.value.clips.splice(activeClip.value + 1, 0, second)
  project.value = { ...project.value, clips: [...project.value.clips] }
  notice.value = 'Clip split at the selected time'
}

function moveClip(direction: -1 | 1) {
  if (!project.value)
    return
  const next = activeClip.value + direction
  if (next < 0 || next >= project.value.clips.length)
    return
  const clips = [...project.value.clips]
  const [item] = clips.splice(activeClip.value, 1)
  if (!item)
    return
  clips.splice(next, 0, item)
  project.value = { ...project.value, clips }
  activeClip.value = next
}

function removeClip() {
  if (!project.value || project.value.clips.length <= 1)
    return
  project.value = { ...project.value, clips: project.value.clips.filter((_, index) => index !== activeClip.value) }
  activeClip.value = Math.max(0, activeClip.value - 1)
}

function selectClip(index: number) {
  if (project.value && isValidBlogClipIndex(index, project.value.clips.length))
    activeClip.value = index
}

function updateClip<Key extends keyof Clip>(key: Key, value: Clip[Key]) {
  const nextValue = key === 'rate'
    ? Math.min(2, Math.max(0.5, Number(value))) as Clip[Key]
    : value
  updateProject((document) => {
    const clip = document.clips[activeClip.value]
    if (clip)
      clip[key] = nextValue
  })
}

function updateCrop(key: 'x' | 'y' | 'width' | 'height', percent: number) {
  if (!Number.isFinite(percent))
    return
  const crop = { ...(currentClip.value?.crop ?? { x: 0, y: 0, width: 1, height: 1 }) }
  crop[key] = Math.min(1, Math.max(key === 'width' || key === 'height' ? 0.01 : 0, percent / 100))
  crop.x = Math.min(crop.x, 1 - crop.width)
  crop.y = Math.min(crop.y, 1 - crop.height)
  updateClip('crop', crop)
}

function toggleGifFrame(index: number) {
  if (!project.value?.frames[index])
    return
  project.value.frames[index].enabled = !project.value.frames[index].enabled
  project.value = { ...project.value, frames: [...project.value.frames] }
}

function moveGifFrame(index: number, direction: -1 | 1) {
  if (!project.value)
    return
  const next = index + direction
  if (next < 0 || next >= project.value.frames.length)
    return
  const frames = [...project.value.frames]
  const [frame] = frames.splice(index, 1)
  if (!frame)
    return
  frames.splice(next, 0, frame)
  project.value = { ...project.value, frames }
}

function deleteGifFrame(index: number) {
  if (!project.value?.frames[index])
    return
  project.value = { ...project.value, frames: project.value.frames.filter((_, frameIndex) => frameIndex !== index) }
}

function changeGifDelay(index: number, delay: number) {
  if (!project.value?.frames[index])
    return
  project.value.frames[index].delay_ms = Math.max(10, delay)
  project.value = { ...project.value, frames: [...project.value.frames] }
}

async function appendVideoClip() {
  if (!project.value || project.value.kind !== 'video' || !appendAssetId.value)
    return
  const asset = assets.value.find(item => item.id === appendAssetId.value && item.kind === 'video')
  if (!asset)
    return
  try {
    const media = await import('@/utils/blog-media')
    const clip = media.createMediaClip(asset) as Clip
    project.value = { ...project.value, clips: [...project.value.clips, clip] }
    activeClip.value = project.value.clips.length - 1
    appendAssetId.value = ''
    notice.value = 'Video clip added to the sequence'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not add that video clip.'
  }
}

function onUploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  for (const file of files) {
    if (upload.findRecoverableUpload(file))
      void upload.recoverUpload(file)
    else
      void upload.upload(file)
  }
  input.value = ''
}

async function retryUpload(task: (typeof uploadTasks.value)[number]) {
  if (task.uploadId) {
    await upload.resume(task)
    return
  }
  await upload.cancel(task)
  await upload.upload(task.file, task.derivedFrom)
}

onMounted(load)
onBeforeUnmount(() => {
  processor.value?.dispose()
  clearFramePreviews()
  if (lastExport.value)
    URL.revokeObjectURL(lastExport.value.url)
})
</script>

<template>
  <main class="blog-studio-page blog-media-page">
    <div class="blog-page-heading">
      <div>
        <p class="blog-eyebrow">
          Private blog studio
        </p><h1>Media library</h1><p
          class="blog-page-intro"
        >
          Keep original sources immutable, shape private projects, and publish only derived assets that a post references.
        </p>
      </div>
      <div class="blog-page-actions">
        <button
          type="button" class="blog-button blog-button--primary" @click="uploadInput?.click()"
        >
          <Upload :size="17" /> Upload source
        </button><NuxtLink
          to="/admin/blog/posts" class="blog-button"
        >
          Posts
        </NuxtLink><NuxtLink
          to="/admin/blog/settings" class="blog-button"
        >
          Site settings
        </NuxtLink><input
          ref="uploadInput" type="file" class="sr-only" multiple accept="image/*,video/*" @change="onUploadFiles"
        >
      </div>
    </div>
    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="blog-alert blog-alert--notice" role="status">
      <Check :size="16" /> {{ notice }}
    </p>

    <div v-if="loading" class="blog-state">
      <LoaderCircle
        :size="22" class="blog-spin"
      /> Loading media…
    </div>
    <template v-else>
      <section v-if="pendingRecoveries.length" class="blog-panel" aria-labelledby="blog-upload-recovery-title">
        <div class="blog-panel__header">
          <div>
            <h2 id="blog-upload-recovery-title">
              Resume interrupted uploads
            </h2>
            <p class="blog-panel__note">
              Choose the original files again to continue from their saved parts. Files stay on your device until selected.
            </p>
          </div>
          <button type="button" class="blog-button" @click="uploadInput?.click()">
            Reselect files
          </button>
        </div>
        <ul class="blog-recovery-list">
          <li v-for="entry in pendingRecoveries" :key="entry.id">
            {{ entry.filename }} · {{ formatBytes(entry.size) }}
          </li>
        </ul>
      </section>
      <section v-if="uploadTasks.length" class="blog-panel">
        <div
          class="blog-panel__header"
        >
          <div>
            <p
              class="blog-eyebrow"
            >
              Transfers
            </p><h2>Source uploads</h2>
          </div><span
            class="blog-panel__note"
          >Two raw 10 MiB parts upload at once</span>
        </div><div
          class="blog-upload-list"
        >
          <article
            v-for="task in uploadTasks" :key="task.id" class="blog-upload-row"
          >
            <div
              class="blog-upload-row__icon"
            >
              <Image v-if="task.file.type.startsWith('image/')" :size="18" /><Video v-else :size="18" />
            </div><div
              class="blog-upload-row__main"
            >
              <strong>{{ task.file.name }}</strong><span>{{ upload.progressLabel(task) }} · {{ task.status }}</span><div
                class="blog-progress"
              >
                <span :style="{ width: `${upload.progress(task)}%` }" />
              </div><p
                v-if="task.error" class="blog-upload-error"
              >
                {{ task.error }}
              </p>
              <p v-if="task.warning" class="blog-panel__note">
                {{ task.warning }}
              </p>
            </div><div
              class="blog-upload-row__actions"
            >
              <button
                v-if="task.status === 'uploading'" type="button" class="
                  blog-icon-button
                " title="Pause upload" @click="upload.pause(task)"
              >
                <Pause :size="15" />
              </button><button
                v-if="['paused', 'error'].includes(task.status)" type="button" class="
                  blog-icon-button
                " :title="task.uploadId ? 'Resume upload' : 'Retry upload'" @click="retryUpload(task)"
              >
                <Play :size="15" />
              </button><button
                v-if="['uploading', 'paused', 'queued', 'error'].includes(task.status)" type="button" class="
                  blog-icon-button
                " title="Cancel upload" @click="upload.cancel(task)"
              >
                <X :size="15" />
              </button>
            </div>
          </article>
        </div>
      </section>

      <div class="blog-media-workspace">
        <section class="blog-panel blog-assets-panel">
          <div
            class="blog-panel__header"
          >
            <div>
              <p
                class="blog-eyebrow"
              >
                Originals and outputs
              </p><h2>Assets</h2>
            </div><span
              class="blog-panel__note"
            >{{ assets.length }} assets</span>
          </div><div
            v-if="!assets.length" class="blog-state blog-state--small"
          >
            Upload an image, video or GIF to start.
          </div><div
            v-else class="blog-asset-grid"
          >
            <button
              v-for="asset in assets" :key="asset.id" type="button" class="
                blog-asset-card
              " :class="{ 'is-selected': selectedAsset?.id === asset.id }" :disabled="Boolean(operation)" @click="selectAsset(asset)"
            >
              <div
                class="blog-asset-card__preview"
              >
                <img v-if="asset.kind !== 'video'" :src="asset.source_url" :alt="asset.name"><span
                  v-else class="blog-asset-card__video"
                ><Video :size="20" /></span>
              </div><strong>{{ asset.name }}</strong><span>{{ asset.kind }} · {{ formatBytes(asset.size) }}</span><time>{{ formatDate(asset.created_at) }}</time>
            </button>
          </div>
        </section>
        <section class="blog-panel blog-projects-panel">
          <div
            class="blog-panel__header"
          >
            <div>
              <p
                class="blog-eyebrow"
              >
                Private work
              </p><h2>Projects</h2>
            </div><span
              class="blog-panel__note"
            >Save before rendering</span>
          </div><div
            v-if="!projects.length" class="blog-empty-note"
          >
            Select an asset to create a private editing project.
          </div><button
            v-for="saved in projects" :key="saved.id" type="button" class="
              blog-project-row
            " :class="{ 'is-selected': selectedProjectId === saved.id }" :disabled="Boolean(operation)" @click="selectProject(saved)"
          >
            <FolderOpen :size="17" /><span><strong>{{ saved.title }}</strong><small>v{{ saved.version }} · {{ formatDate(saved.updated_at) }}</small></span><ChevronDown :size="15" />
          </button>
        </section>
      </div>

      <section
        v-if="selectedAsset && project" class="blog-panel blog-media-editor"
      >
        <div
          class="blog-panel__header"
        >
          <div>
            <p
              class="blog-eyebrow"
            >
              {{ project.kind }} project
            </p><h2>{{ selectedAsset.name }}</h2>
          </div><div
            class="blog-page-actions"
          >
            <span
              v-if="isOverSourceLimit" class="blog-status" data-status="error"
            >Over 250 MiB</span><button
              type="button" class="blog-button blog-button--quiet" @click="saveProject"
            >
              <Save :size="16" /> Save project
            </button><button
              type="button" class="blog-button blog-button--primary" :disabled="Boolean(operation)" @click="renderProject"
            >
              <WandSparkles :size="16" /> Render derived asset
            </button>
          </div>
        </div><div
          v-if="operation" class="blog-operation"
        >
          <LoaderCircle
            :size="17" class="blog-spin"
          /><span>{{ operation.message || operation.stage }}</span><span v-if="operation.ratio !== null">{{ Math.round(operation.ratio * 100) }}%</span><button
            type="button" class="blog-text-button" @click="cancelOperation"
          >
            <X :size="14" /> Cancel
          </button>
        </div>

        <div class="blog-media-editor__grid">
          <div class="blog-media-stage">
            <img v-if="previewAsset?.kind !== 'video'" :src="selectedAssetPreview" :alt="previewAsset?.name || ''" :style="previewStyle">
            <video v-else :src="selectedAssetPreview" controls preload="metadata" :style="previewStyle" @timeupdate="splitAtMs = Math.round(($event.target as HTMLVideoElement).currentTime * 1000)" />
            <p>Source preview · {{ previewAsset?.width || '—' }} × {{ previewAsset?.height || '—' }} · {{ previewAsset?.duration_ms ? `${Math.round(previewAsset.duration_ms / 1000)}s` : 'still' }}</p>
          </div>
          <div class="blog-media-controls">
            <div class="blog-control-tabs">
              <span
                class="is-active"
              >Adjust</span><span v-if="project.kind === 'video'">Timeline</span><span v-if="project.kind === 'gif'">Frames</span><span>Output</span>
            </div><div
              class="blog-control-section"
            >
              <div
                class="blog-control-section__heading"
              >
                <h3>Transform</h3><span>Clip {{ activeClip + 1 }} of {{ project.clips.length }}</span>
              </div><div
                class="blog-control-buttons"
              >
                <button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('rotate', (((currentClip?.rotate ?? 0) + 270) % 360) as 0 | 90 | 180 | 270)"
                >
                  <RotateCcw :size="15" /> Rotate left
                </button><button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('rotate', (((currentClip?.rotate ?? 0) + 90) % 360) as 0 | 90 | 180 | 270)"
                >
                  <RotateCw :size="15" /> Rotate right
                </button><button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('flip_x', !currentClip?.flip_x)"
                >
                  <FlipHorizontal :size="15" /> Flip X
                </button><button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('flip_y', !currentClip?.flip_y)"
                >
                  <FlipVertical :size="15" /> Flip Y
                </button>
              </div><div
                class="blog-range-grid"
              >
                <label
                  class="blog-field"
                ><span>Brightness {{ (currentClip?.brightness ?? 0).toFixed(2) }}</span><input :value="currentClip?.brightness ?? 0" type="range" min="-1" max="1" step="0.01" @input="updateClip('brightness', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Contrast {{ (currentClip?.contrast ?? 1).toFixed(2) }}</span><input :value="currentClip?.contrast ?? 1" type="range" min="0" max="2" step="0.01" @input="updateClip('contrast', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Saturation {{ (currentClip?.saturation ?? 1).toFixed(2) }}</span><input :value="currentClip?.saturation ?? 1" type="range" min="0" max="2" step="0.01" @input="updateClip('saturation', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-toggle"
                ><input :checked="currentClip?.grayscale" type="checkbox" @change="updateClip('grayscale', ($event.target as HTMLInputElement).checked)"><span>Grayscale</span></label>
              </div>
            </div>
            <div v-if="project.kind === 'video'" class="blog-control-section">
              <div
                class="blog-control-section__heading"
              >
                <h3>Timeline</h3><label class="blog-field"><span>Split at (ms)</span><input v-model.number="splitAtMs" type="number" :min="(currentClip?.in_ms ?? 0) + 1" :max="(currentClip?.out_ms ?? 0) - 1"></label><div
                  class="blog-control-buttons"
                >
                  <button
                    type="button" class="blog-icon-button" title="Move clip earlier" @click="moveClip(-1)"
                  >
                    <ChevronDown
                      :size="15" class="blog-rotate-180"
                    />
                  </button><button
                    type="button" class="blog-icon-button" title="Move clip later" @click="moveClip(1)"
                  >
                    <ChevronDown :size="15" />
                  </button><button
                    type="button" class="blog-icon-button" title="Split clip" @click="splitClip"
                  >
                    <Scissors :size="15" />
                  </button><button
                    type="button" class="blog-icon-button" title="Remove clip" @click="removeClip"
                  >
                    <Trash2 :size="15" />
                  </button>
                </div>
              </div><div class="blog-clip-list" role="listbox" aria-label="Video clips">
                <button
                  v-for="(clip, index) in project.clips" :key="clip.id" type="button" role="option" class="blog-clip-option" :class="{ 'is-selected': activeClip === index }" :aria-selected="activeClip === index" @click="selectClip(index)"
                >
                  <strong>Clip {{ index + 1 }}</strong><span>{{ assets.find(asset => asset.id === clip.asset_id)?.name || clip.asset_id }}</span><small>{{ clip.in_ms }}–{{ clip.out_ms }} ms · {{ clip.rate }}×</small>
                </button>
              </div><div
                class="blog-range-grid"
              >
                <label
                  class="blog-field"
                ><span>Append video clip</span><select v-model="appendAssetId" @change="appendVideoClip"><option value="">Choose a source…</option><option v-for="asset in assets.filter(item => item.kind === 'video')" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label><label
                  class="blog-field"
                ><span>In point (ms)</span><input :value="currentClip?.in_ms" type="number" min="0" @input="updateClip('in_ms', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Out point (ms)</span><input :value="currentClip?.out_ms" type="number" min="1" @input="updateClip('out_ms', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Playback rate</span><input :value="currentClip?.rate" type="number" min="0.5" max="2" step="0.05" @input="updateClip('rate', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-toggle"
                ><input :checked="currentClip?.muted" type="checkbox" @change="updateClip('muted', ($event.target as HTMLInputElement).checked)"><span>Mute audio</span></label><label
                  class="blog-field"
                ><span>Volume {{ Math.round((currentClip?.volume ?? 1) * 100) }}%</span><input :value="currentClip?.volume ?? 1" type="range" min="0" max="1" step="0.01" @input="updateClip('volume', Number(($event.target as HTMLInputElement).value))"></label>
              </div>
            </div>
            <div v-if="project.kind === 'gif'" class="blog-control-section">
              <div
                class="blog-control-section__heading"
              >
                <h3>GIF frames</h3><span>{{ project.frames.filter(frame => frame.enabled).length }} enabled</span>
              </div><div
                class="blog-gif-frame-list"
              >
                <div
                  v-for="(frame, index) in project.frames" :key="`${frame.source_index}-${index}`" class="
                    blog-gif-frame
                  " :class="{ 'is-disabled': !frame.enabled }"
                >
                  <button
                    type="button" class="blog-gif-frame__toggle" :aria-label="`${frame.enabled ? 'Disable' : 'Enable'} frame ${index + 1}`" @click="toggleGifFrame(index)"
                  >
                    <img v-if="gifFramePreviews[frame.source_index]" :src="gifFramePreviews[frame.source_index]" alt=""><span>{{ index + 1 }}</span>
                  </button><label
                    class="blog-field"
                  ><span>Delay ms</span><input :value="frame.delay_ms" type="number" min="10" @input="changeGifDelay(index, Number(($event.target as HTMLInputElement).value))"></label><button
                    type="button" class="blog-icon-button" title="Move frame earlier" @click="moveGifFrame(index, -1)"
                  >
                    <ChevronDown
                      :size="14" class="blog-rotate-180"
                    />
                  </button><button
                    type="button" class="blog-icon-button" title="Move frame later" @click="moveGifFrame(index, 1)"
                  >
                    <ChevronDown :size="14" />
                  </button><button
                    type="button" class="blog-icon-button" title="Delete frame" @click="deleteGifFrame(index)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
            <div class="blog-control-section">
              <div
                class="blog-control-section__heading"
              >
                <h3>Crop</h3><span>Source selection in percent</span>
              </div><div
                class="blog-control-buttons"
              >
                <button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('crop', { x: 0, y: 0, width: 1, height: 1 })"
                >
                  <Crop :size="15" /> Full frame
                </button><button
                  type="button" class="blog-button blog-button--quiet" @click="updateClip('crop', null)"
                >
                  <RotateCcw :size="15" /> Reset
                </button>
              </div><div
                class="blog-range-grid"
              >
                <label
                  class="blog-field"
                ><span>Left (%)</span><input :value="Math.round((currentClip?.crop?.x ?? 0) * 100)" type="number" min="0" max="100" step="1" @input="updateCrop('x', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Top (%)</span><input :value="Math.round((currentClip?.crop?.y ?? 0) * 100)" type="number" min="0" max="100" step="1" @input="updateCrop('y', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Width (%)</span><input :value="Math.round((currentClip?.crop?.width ?? 1) * 100)" type="number" min="1" max="100" step="1" @input="updateCrop('width', Number(($event.target as HTMLInputElement).value))"></label><label
                  class="blog-field"
                ><span>Height (%)</span><input :value="Math.round((currentClip?.crop?.height ?? 1) * 100)" type="number" min="1" max="100" step="1" @input="updateCrop('height', Number(($event.target as HTMLInputElement).value))"></label>
              </div>
            </div><div
              v-if="project.kind === 'video'" class="blog-control-section"
            >
              <div
                class="blog-control-section__heading"
              >
                <h3>Poster</h3><span>{{ posterAssetId ? 'Private poster ready' : 'Generate a frame poster' }}</span>
              </div><div
                class="blog-range-grid"
              >
                <label
                  class="blog-field"
                ><span>Poster time (ms)</span><input v-model.number="posterTimeMs" type="number" min="0"></label><div
                  class="blog-control-buttons"
                >
                  <button
                    type="button" class="blog-button blog-button--quiet" @click="generatePoster"
                  >
                    <Image :size="15" /> Generate poster
                  </button>
                </div>
              </div><div v-if="generatedPosterAsset" class="blog-generated-poster">
                <img :src="generatedPosterAsset.source_url" :alt="generatedPosterAsset.name"><div><strong>{{ generatedPosterAsset.name }}</strong><span>Ready in Assets. Choose it from a video block’s Poster frame field in the post editor.</span></div>
              </div><p v-else class="blog-panel__note">
                Generated posters are saved as named private image assets and can be selected from a video block in the post editor.
              </p>
            </div><div
              class="blog-control-section"
            >
              <div
                class="blog-control-section__heading"
              >
                <h3>Output</h3><span>Derived output remains private until published</span>
              </div><div
                class="blog-range-grid"
              >
                <label
                  class="blog-field"
                ><span>Format</span><select :value="project.output.format" @change="updateProject(document => { document.output.format = ($event.target as HTMLSelectElement).value as MediaProjectDocument['output']['format'] })"><option v-if="project.kind === 'image'" value="png">PNG</option><option v-if="project.kind === 'image'" value="jpeg">JPEG</option><option v-if="project.kind === 'image'" value="webp">WebP</option><option v-if="project.kind !== 'image'" value="mp4">MP4</option><option v-if="project.kind !== 'image'" value="webm">WebM</option><option v-if="project.kind !== 'image'" value="gif">GIF</option></select></label><label
                  class="blog-field"
                ><span>Width</span><input :value="project.output.width" type="number" min="1" :max="project.output.format === 'gif' ? 720 : project.kind === 'image' ? 4096 : 1920" @input="updateProject(document => { document.output.width = Number(($event.target as HTMLInputElement).value) })"></label><label
                  class="blog-field"
                ><span>Height</span><input :value="project.output.height" type="number" min="1" :max="project.output.format === 'gif' ? 720 : project.kind === 'image' ? 4096 : 1080" @input="updateProject(document => { document.output.height = Number(($event.target as HTMLInputElement).value) })"></label><label
                  class="blog-field"
                ><span>FPS</span><input :value="project.output.fps" type="number" min="1" :max="project.output.format === 'gif' ? 15 : 30" @input="updateProject(document => { document.output.fps = Number(($event.target as HTMLInputElement).value) })"></label><label
                  class="blog-field"
                ><span>Quality {{ project.output.quality }}</span><input :value="project.output.quality" type="range" min="0.1" max="1" step="0.01" @input="updateProject(document => { document.output.quality = Number(($event.target as HTMLInputElement).value) })"></label><label
                  v-if="project.output.format === 'gif'" class="blog-field"
                ><span>Loop count (0 = forever)</span><input :value="project.output.loop" type="number" min="0" max="100" @input="updateProject(document => { document.output.loop = Number(($event.target as HTMLInputElement).value) })"></label>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section v-if="lastExport" class="blog-panel blog-export-preview" aria-label="Latest export">
        <div class="blog-panel__header">
          <h2>Latest export</h2><a
            class="blog-button" :href="lastExport.url" :download="lastExport.filename"
          >Download {{ lastExport.filename }}</a>
        </div>
        <video v-if="lastExport.mime.startsWith('video/')" :src="lastExport.url" controls preload="metadata" />
        <img v-else :src="lastExport.url" alt="Latest edited media">
      </section>
    </template>
  </main>
</template>
