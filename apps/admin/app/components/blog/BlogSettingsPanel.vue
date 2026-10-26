<script setup lang="ts">
import type { BlogArtworkMotion, BlogSettings } from '@/utils/blog-studio'
import { Check, CircleOff, LoaderCircle, PlayCircle, Save, Settings2 } from '@lucide/vue'
import { useBlogApi } from '@/composables/useBlogApi'

const api = useBlogApi()
const settings = ref<BlogSettings>({ artwork_motion: 'once' })
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    settings.value = await api.getSettings()
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load blog settings.'
  }
  finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    settings.value = await api.saveSettings(settings.value)
    notice.value = 'Site settings saved'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not save site settings.'
  }
  finally {
    saving.value = false
  }
}

function setMotion(value: BlogArtworkMotion) {
  settings.value = { ...settings.value, artwork_motion: value }
  notice.value = ''
}

onMounted(load)
</script>

<template>
  <main class="blog-studio-page">
    <div class="blog-page-heading">
      <div>
        <p class="blog-eyebrow">
          Private blog studio
        </p><h1>Site settings</h1><p
          class="blog-page-intro"
        >
          Choose how blog covers move. Visitors’ reduced-motion preferences always take precedence.
        </p>
      </div>
      <div class="blog-page-actions">
        <NuxtLink
          to="/admin/blog/posts" class="blog-button"
        >
          Posts
        </NuxtLink><NuxtLink
          to="/admin/blog/media" class="blog-button"
        >
          Media library
        </NuxtLink><button
          type="button" class="blog-button blog-button--primary" :disabled="saving || loading" @click="save"
        >
          <Save :size="17" /> {{ saving ? 'Saving…' : 'Save settings' }}
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
      /> Loading settings…
    </section>
    <section v-else class="blog-panel blog-settings-panel">
      <div
        class="blog-panel__header"
      >
        <div>
          <p
            class="blog-eyebrow"
          >
            Public artwork
          </p><h2>Blog cover animations</h2>
        </div><Settings2 :size="22" aria-hidden="true" />
      </div><p
        class="blog-panel__note"
      >
        Each cover can animate for up to four seconds per page visit. Filtering and tab changes cannot restart it. Failed configuration reads keep covers static.
      </p><div
        class="blog-setting-options" role="radiogroup" aria-label="Blog cover animations"
      >
        <button
          type="button" class="blog-setting-option" :class="{ 'is-selected': settings.artwork_motion === 'once' }" role="radio" :aria-checked="settings.artwork_motion === 'once'" @click="setMotion('once')"
        >
          <span
            class="blog-setting-option__icon"
          ><PlayCircle :size="22" /></span><span><strong>Animate once</strong><small>Play each visible cover for up to four seconds.</small></span><Check
            v-if="settings.artwork_motion === 'once'" class="
              blog-setting-option__check
            " :size="18"
          />
        </button><button
          type="button" class="blog-setting-option" :class="{ 'is-selected': settings.artwork_motion === 'off' }" role="radio" :aria-checked="settings.artwork_motion === 'off'" @click="setMotion('off')"
        >
          <span
            class="blog-setting-option__icon"
          ><CircleOff :size="22" /></span><span><strong>Static</strong><small>Keep all blog covers still.</small></span><Check
            v-if="settings.artwork_motion === 'off'" class="
              blog-setting-option__check
            " :size="18"
          />
        </button>
      </div>
    </section>
  </main>
</template>
