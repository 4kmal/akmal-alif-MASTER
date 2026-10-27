<script setup lang="ts">
definePageMeta({ layout: 'dashboard' })
const api = useBlogApi()
const route = useRoute()
const error = ref('')

onMounted(async () => {
  try {
    const requestedPostId = String(route.query.post_id || '')
    if (!requestedPostId) {
      await navigateTo('/admin/blog/galleries', { replace: true })
      return
    }
    const gallery = await api.createGallery({ post_id: requestedPostId, title: 'Untitled gallery' })
    await navigateTo(`/admin/blog/galleries/${gallery.id}`, { replace: true })
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not create a gallery.'
  }
})
</script>

<template>
  <main class="blog-studio-page">
    <section class="blog-state">
      <span v-if="!error">Creating a private gallery…</span><span
        v-else class="blog-alert blog-alert--error" role="alert"
      >{{ error }}</span>
    </section>
  </main>
</template>
