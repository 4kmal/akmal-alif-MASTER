<script setup lang="ts">
import type { BlogCategoryIconKey } from '#shared/utils/blog-category-icons'
import type { BlogCategory, BlogTaxonomy } from '@/utils/blog-studio'
import { Check, ChevronDown, ChevronUp, LoaderCircle, Plus, Save, ShieldCheck } from '@lucide/vue'
import { BLOG_CATEGORY_ICON_KEYS as CATEGORY_ICON_KEYS, isBlogCategoryIconKey } from '#shared/utils/blog-category-icons'
import { useBlogApi } from '@/composables/useBlogApi'
import { isBlogCategoryActive } from '@/utils/blog-studio'
import BlogCategorySprite from './BlogCategorySprite.vue'

type CategoryDraft = BlogCategory & { is_active: boolean, sort_order: number, version: number }

const api = useBlogApi()
const taxonomy = ref<BlogTaxonomy>({ categories: [], tags: [] })
const drafts = ref<CategoryDraft[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const newName = ref('')
const newDescription = ref('')
const newIcon = ref<BlogCategoryIconKey>('technology')

function toDraft(category: BlogCategory, index: number): CategoryDraft {
  return {
    ...category,
    description: category.description ?? '',
    is_active: isBlogCategoryActive(category.is_active),
    sort_order: Number.isFinite(category.sort_order) ? Number(category.sort_order) : index,
    icon_key: isBlogCategoryIconKey(category.icon_key) ? category.icon_key : 'technology',
    version: Number(category.version ?? 0),
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    taxonomy.value = await api.getTaxonomy()
    drafts.value = taxonomy.value.categories.map(toDraft).sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not load categories.'
  }
  finally {
    loading.value = false
  }
}

function move(index: number, delta: -1 | 1) {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= drafts.value.length)
    return
  const current = drafts.value[index]
  const next = drafts.value[nextIndex]
  if (!current || !next)
    return
  drafts.value.splice(index, 1)
  drafts.value.splice(nextIndex, 0, current)
  drafts.value.forEach((category, order) => {
    category.sort_order = order
  })
}

function onReorderKeydown(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    return
  event.preventDefault()
  move(index, event.key === 'ArrowUp' ? -1 : 1)
}

async function createCategory() {
  const name = newName.value.trim()
  if (!name)
    return
  error.value = ''
  try {
    const slug = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const result = await api.createTaxonomy({ kind: 'category', name, slug, description: newDescription.value.trim(), icon_key: newIcon.value })
    taxonomy.value = result
    const created = result.categories.find(category => category.slug === slug || category.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (created) {
      created.description = newDescription.value.trim()
      created.icon_key = newIcon.value
      drafts.value = result.categories.map(toDraft).sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
    }
    newName.value = ''
    newDescription.value = ''
    notice.value = 'Category created. Save its description and icon when ready.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'Could not create the category.'
  }
}

async function save() {
  if (saving.value)
    return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    let updated: BlogTaxonomy | null = null
    for (const [index, category] of drafts.value.entries()) {
      const response = await api.updateCategory(category.id, {
        version: category.version,
        name: category.name.trim(),
        description: String(category.description ?? '').trim(),
        sort_order: index,
        is_active: category.is_active,
        icon_key: isBlogCategoryIconKey(category.icon_key) ? category.icon_key : 'technology',
      })
      updated = response
      const saved = response.categories.find(item => item.id === category.id)
      if (saved)
        Object.assign(category, toDraft(saved, index))
    }
    if (updated)
      taxonomy.value = updated
    notice.value = 'Categories saved.'
  }
  catch (reason: unknown) {
    error.value = reason instanceof Error ? reason.message : 'A category changed elsewhere. Reload and review the conflict.'
  }
  finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="blog-panel blog-category-manager" aria-labelledby="blog-category-manager-title">
    <div class="blog-panel__header">
      <div>
        <p class="blog-eyebrow">
          Taxonomy
        </p><h2 id="blog-category-manager-title">
          Categories
        </h2>
      </div><ShieldCheck :size="21" aria-hidden="true" />
    </div>
    <p class="blog-panel__note">
      Names, descriptions, ordering, activation and icon keys are private settings. Slugs remain stable so old post labels keep resolving when a category is deactivated.
    </p>
    <p v-if="error" class="blog-alert blog-alert--error" role="alert">
      {{ error }}
    </p>
    <p v-if="notice" class="blog-alert blog-alert--notice" role="status">
      <Check :size="16" /> {{ notice }}
    </p>
    <div v-if="loading" class="blog-state blog-state--small">
      <LoaderCircle
        :size="18" class="blog-spin"
      /> Loading categories…
    </div>
    <template v-else>
      <div class="blog-category-list" role="list" aria-label="Blog categories">
        <article
          v-for="(category, index) in drafts" :key="category.id" class="
            blog-category-row
          " role="listitem"
        >
          <div class="blog-category-order">
            <button
              type="button" class="blog-icon-button" :disabled="index === 0" :aria-label="`Move ${category.name} earlier`" @click="move(index, -1)"
            >
              <ChevronUp :size="15" />
            </button><span>{{ index + 1 }}</span><button
              type="button" class="blog-icon-button" :disabled="index === drafts.length - 1" :aria-label="`Move ${category.name} later`" @click="move(index, 1)"
            >
              <ChevronDown :size="15" />
            </button>
          </div>
          <div class="blog-category-fields">
            <label class="blog-field"><span>Name</span><input v-model="category.name" maxlength="160" :aria-label="`Name for ${category.slug}`"></label><label
              class="blog-field"
            ><span>Description</span><textarea v-model="category.description" rows="2" maxlength="500" :aria-label="`Description for ${category.slug}`" /></label>
          </div>
          <div class="blog-category-fields">
            <label class="blog-field"><span>Icon</span><span
              class="blog-icon-select"
            >
              <BlogCategorySprite :icon-key="category.icon_key" play="always" />
              <select v-model="category.icon_key" :aria-label="`Icon for ${category.slug}`"><option v-for="icon in CATEGORY_ICON_KEYS" :key="icon" :value="icon">{{ icon }}</option></select>
            </span></label><label
              class="blog-toggle"
            ><input v-model="category.is_active" type="checkbox"><span>Active</span></label><span
              class="blog-category-slug"
            >/{{ category.slug }}</span>
          </div>
          <button type="button" class="blog-category-row__handle" :aria-label="`Reorder ${category.name}`" @keydown="onReorderKeydown($event, index)">
            ↕
          </button>
        </article>
      </div>
      <form class="blog-category-create" @submit.prevent="createCategory">
        <div>
          <p
            class="blog-eyebrow"
          >
            New category
          </p><h3>Add a stable slug</h3>
        </div><label
          class="blog-field"
        ><span>Name</span><input v-model="newName" required maxlength="160" placeholder="Category name"></label><label
          class="blog-field"
        ><span>Description</span><input v-model="newDescription" maxlength="500" placeholder="Short description"></label><label
          class="blog-field"
        ><span>Icon</span><span class="blog-icon-select"><BlogCategorySprite :icon-key="newIcon" play="always" /><select v-model="newIcon"><option v-for="icon in CATEGORY_ICON_KEYS" :key="icon" :value="icon">{{ icon }}</option></select></span></label><button
          type="submit" class="blog-button"
        >
          <Plus :size="16" /> Add
        </button>
      </form>
      <div class="blog-category-footer">
        <button
          type="button" class="blog-button blog-button--primary" :disabled="saving" @click="save"
        >
          <Save :size="16" /> {{ saving ? 'Saving…' : 'Save categories' }}
        </button>
      </div>
    </template>
  </section>
</template>
