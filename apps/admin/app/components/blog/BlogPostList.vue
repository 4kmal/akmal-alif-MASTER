<script setup lang="ts">
import type { BlogPostSummary } from '@/utils/blog-studio'
import { Archive, FilePlus2, Image, PenLine, RefreshCw, Search, Settings2 } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'
import { formatDate } from '@/utils/blog-studio'

const api = useBlogApi()
const posts = ref<BlogPostSummary[]>([])
const loading = ref(true)
const error = ref('')
const query = ref('')
const status = ref<'all' | 'draft' | 'published' | 'archived'>('all')

const filteredPosts = computed(() => posts.value.filter((post) => {
  const matchesQuery = !query.value.trim() || `${post.title} ${post.slug} ${post.excerpt ?? ''}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
  const matchesStatus = status.value === 'all' || post.status === status.value
  return matchesQuery && matchesStatus
}))

async function load() {
  loading.value = true
  error.value = ''
  try {
    posts.value = (await api.listPosts()).posts
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load posts.'
  }
  finally {
    loading.value = false
  }
}

async function createPost() {
  try {
    const result = await api.createPost({ title: 'Untitled post' })
    await navigateTo(`/admin/blog/posts/${result.post.id}`)
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not create a post.'
  }
}

onMounted(load)
</script>

<template>
  <main class="blog-studio-page">
    <div class="blog-page-heading">
      <div>
        <p class="blog-eyebrow">
          Private blog studio
        </p>
        <h1>Posts</h1>
        <p class="blog-page-intro">
          Write, review and publish portfolio stories from one private workspace. Drafts stay private until you explicitly publish them.
        </p>
      </div>
      <div class="blog-page-actions">
        <button type="button" class="blog-button blog-button--primary" @click="createPost">
          <FilePlus2 :size="17" /> New post
        </button>
        <NuxtLink to="/admin/blog/media" class="blog-button">
          <Image :size="17" /> Media library
        </NuxtLink>
        <NuxtLink to="/admin/blog/settings" class="blog-button">
          <Settings2 :size="17" /> Site settings
        </NuxtLink>
      </div>
    </div>

    <section class="blog-panel blog-panel--filters" aria-label="Post filters">
      <label class="blog-search-field">
        <Search :size="17" aria-hidden="true" />
        <span class="sr-only">Search posts</span>
        <input v-model="query" type="search" placeholder="Search by title, slug or excerpt">
      </label>
      <label class="blog-filter-field">
        <span>Status</span>
        <select v-model="status" aria-label="Filter by status">
          <option value="all">All posts</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <button type="button" class="blog-button blog-button--quiet" :disabled="loading" @click="load">
        <RefreshCw :size="16" :class="{ 'blog-spin': loading }" /> Refresh
      </button>
    </section>

    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <section v-if="loading" class="blog-state" aria-live="polite">
      Loading posts…
    </section>
    <section v-else-if="!filteredPosts.length" class="blog-state">
      <PenLine :size="24" aria-hidden="true" />
      <strong>{{ query || status !== 'all' ? 'No posts match this filter.' : 'Your studio is ready.' }}</strong>
      <span>{{ query || status !== 'all' ? 'Try another search or status.' : 'Create a private draft to start writing.' }}</span>
    </section>
    <section v-else class="blog-post-grid" aria-label="Posts">
      <NuxtLink
        v-for="post in filteredPosts" :key="post.id" :to="`/admin/blog/posts/${post.id}`" class="
          blog-post-card
        "
      >
        <div class="blog-post-card__topline">
          <span class="blog-status" :data-status="post.status"><Archive v-if="post.status === 'archived'" :size="13" /> {{ post.status }}</span>
          <span v-if="post.has_unpublished_changes" class="blog-dirty-mark">Unpublished changes</span>
        </div>
        <h2>{{ post.title || 'Untitled post' }}</h2>
        <p v-if="post.excerpt">
          {{ post.excerpt }}
        </p>
        <div class="blog-post-card__meta">
          <span>/{{ post.slug || 'draft' }}</span>
          <time :datetime="post.updated_at">{{ formatDate(post.updated_at) }}</time>
        </div>
      </NuxtLink>
    </section>
  </main>
</template>
