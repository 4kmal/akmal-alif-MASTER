<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import BlogCategorySprite from './BlogCategorySprite.vue'

export interface BlogCategoryOption {
  id: string
  name: string
  slug: string
  description?: string | null
  icon_key?: string | null
}

const props = defineProps<{
  categories: BlogCategoryOption[]
  modelValue: string | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

// Reka select items cannot use an empty value, so "Uncategorised" travels as a sentinel.
const NONE = '__none__'
const labelId = useId()
const celebrating = ref(false)
let celebrationTimer: ReturnType<typeof setTimeout> | undefined

const selected = computed(() => props.categories.find(category => category.id === props.modelValue) ?? null)
const value = computed({
  get: () => props.modelValue ?? NONE,
  set: (next: string) => {
    const id = next === NONE ? null : next
    if (id === props.modelValue)
      return
    emit('update:modelValue', id)
    celebrating.value = true
    clearTimeout(celebrationTimer)
    celebrationTimer = setTimeout(() => {
      celebrating.value = false
    }, 1600)
  },
})

onBeforeUnmount(() => clearTimeout(celebrationTimer))
</script>

<template>
  <div class="blog-category-picker">
    <span :id="labelId" class="blog-category-picker__label">Category</span>
    <Select v-model="value">
      <SelectTrigger class="blog-category-picker__trigger" :aria-labelledby="labelId">
        <BlogCategorySprite :icon-key="selected?.icon_key ?? 'uncategorised'" :play="celebrating ? 'always' : 'hover'" />
        <span class="blog-category-picker__text">
          <strong>{{ selected?.name ?? 'Uncategorised' }}</strong>
          <small>{{ selected ? (selected.description || `/${selected.slug}`) : 'Not filed under a category' }}</small>
        </span>
      </SelectTrigger>
      <SelectContent
        position="popper" :side-offset="6" class="blog-category-picker__content"
      >
        <SelectItem
          :value="NONE" text-value="Uncategorised" class="
            blog-category-picker__item
          " style="--i: 0"
        >
          <BlogCategorySprite icon-key="uncategorised" />
          <span class="blog-category-picker__text">
            <strong>Uncategorised</strong>
            <small>Not filed under a category</small>
          </span>
        </SelectItem>
        <SelectItem
          v-for="(category, index) in categories" :key="category.id"
          :value="category.id" :text-value="category.name" class="
            blog-category-picker__item
          " :style="{ '--i': index + 1 }"
        >
          <BlogCategorySprite :icon-key="category.icon_key" />
          <span class="blog-category-picker__text">
            <strong>{{ category.name }}</strong>
            <small>{{ category.description || `/${category.slug}` }}</small>
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
