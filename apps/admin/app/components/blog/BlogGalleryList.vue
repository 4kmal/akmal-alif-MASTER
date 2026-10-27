<script setup lang="ts">
import type { BlogPostSummary } from '@/utils/blog-studio'
import type { GallerySummary } from '@/utils/content-calendar'
import { FilePlus2, GalleryHorizontalEnd, LoaderCircle, RefreshCw } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { formatDate } from '@/utils/blog-studio'

const api = useBlogApi()
const galleries = ref<GallerySummary[]>([])
const posts = ref<BlogPostSummary[]>([])
const selectedPostId = ref('')
const loading = ref(true)
const error = ref('')
const attachedPostIds = computed(() => new Set(galleries.value.map(gallery => gallery.post_id)))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [galleryResult, postResult] = await Promise.all([api.listGalleries(), api.listPosts()])
    galleries.value = galleryResult.galleries
    posts.value = postResult.posts
    selectedPostId.value ||= posts.value.find(post => post.status === 'draft' && !attachedPostIds.value.has(post.id))?.id || posts.value.find(post => !attachedPostIds.value.has(post.id))?.id || ''
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load galleries.'
  }
  finally {
    loading.value = false
  }
}

async function createGallery() {
  try {
    let postId = selectedPostId.value
    if (postId && attachedPostIds.value.has(postId)) {
      error.value = 'That article already has a gallery. Choose another article or create a private one.'
      return
    }
    if (!postId) {
      const post = await api.createPost({ title: 'Untitled gallery' })
      postId = post.post.id
    }
    const gallery = await api.createGallery({ post_id: postId, title: 'Untitled gallery' })
    await navigateTo(`/admin/blog/galleries/${gallery.id}`)
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not create a gallery.'
  }
}

onMounted(load)
</script>

<template>
  <main class="blog-studio-page">
    <div class="blog-page-heading">
      <div>
        <p class="blog-eyebrow">
          Private media workspace
        </p>
        <h1>Galleries</h1>
        <p class="blog-page-intro">
          Turn a private PDF into an ordered, revisioned gallery. Originals stay owner-only; finalized page assets can be selected from the article editor.
        </p>
      </div>
      <div class="blog-page-actions">
        <label class="blog-field gallery-post-picker"><span>Attach to article</span><select v-model="selectedPostId" aria-label="Article for new gallery"><option value="">Create a private article</option><option v-for="post in posts" :key="post.id" :value="post.id" :disabled="attachedPostIds.has(post.id)">{{ post.title || post.slug }}{{ attachedPostIds.has(post.id) ? ' · gallery attached' : '' }}</option></select></label>
        <button type="button" class="blog-button blog-button--primary" @click="createGallery">
          <FilePlus2 :size="17" /> New gallery
        </button>
        <NuxtLink to="/admin/blog/media" class="blog-button">
          Media library
        </NuxtLink>
        <button type="button" class="blog-button blog-button--quiet" :disabled="loading" @click="load">
          <RefreshCw :size="16" :class="{ 'blog-spin': loading }" /> Refresh
        </button>
      </div>
    </div>
    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <section v-if="loading" class="blog-state">
      <LoaderCircle
        :size="22" class="blog-spin"
      /> Loading galleries…
    </section>
    <section v-else-if="!galleries.length" class="blog-state">
      <GalleryHorizontalEnd :size="25" aria-hidden="true" /><strong>Your gallery workspace is ready.</strong><span>Upload a PDF to start a private, ordered gallery.</span>
    </section>
    <section v-else class="blog-post-grid" aria-label="Galleries">
      <NuxtLink
        v-for="gallery in galleries" :key="gallery.id" :to="`/admin/blog/galleries/${gallery.id}`" class="
          blog-post-card
        "
      >
        <div class="blog-post-card__topline">
          <span class="blog-status" :data-status="gallery.status">{{ gallery.status }}</span><span
            class="blog-dirty-mark"
          >{{ gallery.status === 'finalized' ? 'manifest ready' : 'owner-only' }}</span>
        </div>
        <h2>{{ gallery.title || 'Untitled gallery' }}</h2>
        <p>Article {{ gallery.post_id }} · source {{ gallery.source_filename || 'not uploaded' }}</p>
        <div class="blog-post-card__meta">
          <span>{{ gallery.page_count }} pages · revision {{ gallery.revision }}</span><time :datetime="gallery.updated_at">{{ formatDate(gallery.updated_at) }}</time>
        </div>
      </NuxtLink>
    </section>
  </main>
</template>
