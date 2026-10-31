<script setup lang="ts">
import { ChevronDown, Plus, X } from '@lucide/vue'
import { computed, ref, useId } from 'vue'
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxItemIndicator, ComboboxList, ComboboxTrigger, ComboboxViewport } from '@/components/ui/combobox'
import { filterTagOptions, tagPickerEnterAction } from '@/utils/blog-tag-picker'

export interface BlogTagOption {
  id: string
  name: string
  slug: string
}

const props = defineProps<{
  tags: BlogTagOption[]
  modelValue: string[]
  creating?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'create': [name: string]
}>()

// The "Create tag" row is a combobox item, but choosing it creates a tag instead of selecting a value.
const CREATE = '__create__'
const labelId = useId()
const listId = useId()
const query = ref('')

const selectedTags = computed(() => props.modelValue
  .map(id => props.tags.find(tag => tag.id === id))
  .filter((tag): tag is BlogTagOption => Boolean(tag)))
const trimmedQuery = computed(() => query.value.trim())
const filteredTags = computed(() => filterTagOptions(props.tags, query.value))
const canCreate = computed(() => trimmedQuery.value.length > 0
  && !props.tags.some(tag => tag.name.toLocaleLowerCase() === trimmedQuery.value.toLocaleLowerCase()))
const value = computed({
  get: () => props.modelValue,
  set: (ids: string[]) => emit('update:modelValue', ids.filter(id => id !== CREATE)),
})

function remove(id: string) {
  emit('update:modelValue', props.modelValue.filter(selectedId => selectedId !== id))
}

function createFromQuery(event?: Event) {
  event?.preventDefault()
  if (!canCreate.value || props.creating)
    return
  emit('create', trimmedQuery.value)
  query.value = ''
}

// Our own filtering means reka doesn't highlight a row as you type, so Enter would otherwise do nothing.
function enterWithoutHighlight() {
  if (document.getElementById(listId)?.querySelector('[data-highlighted]'))
    return
  const action = tagPickerEnterAction(props.tags, query.value)
  if (action?.kind === 'toggle') {
    emit('update:modelValue', props.modelValue.includes(action.id) ? props.modelValue.filter(id => id !== action.id) : [...props.modelValue, action.id])
    query.value = ''
  }
  else if (action?.kind === 'create') {
    createFromQuery()
  }
}

function removeLastOnBackspace() {
  const last = props.modelValue.at(-1)
  if (!query.value && last)
    remove(last)
}
</script>

<template>
  <div class="blog-tag-picker">
    <div class="blog-tag-picker__head">
      <span :id="labelId">Tags</span>
      <small aria-live="polite">{{ modelValue.length }} selected</small>
    </div>
    <TransitionGroup
      v-if="selectedTags.length" tag="ul" name="blog-chip" class="
        blog-tag-picker__chips
      " :aria-labelledby="labelId"
    >
      <li v-for="tag in selectedTags" :key="tag.id" class="blog-tag-chip">
        <span>{{ tag.name }}</span>
        <button type="button" :aria-label="`Remove ${tag.name}`" @click="remove(tag.id)">
          <X :size="12" />
        </button>
      </li>
    </TransitionGroup>
    <Combobox v-model="value" multiple ignore-filter open-on-focus>
      <ComboboxAnchor class="blog-tag-picker__anchor">
        <ComboboxInput
          v-model="query" class="blog-tag-picker__input" :placeholder="creating ? 'Adding tag…' : 'Add tags…'"
          :aria-labelledby="labelId" :disabled="creating" @keydown.backspace="removeLastOnBackspace" @keydown.enter="enterWithoutHighlight"
        />
        <ComboboxTrigger class="blog-tag-picker__toggle" aria-label="Show all tags">
          <ChevronDown :size="15" />
        </ComboboxTrigger>
      </ComboboxAnchor>
      <ComboboxList :id="listId" class="blog-tag-picker__list" :side-offset="6">
        <ComboboxViewport>
          <ComboboxItem
            v-for="tag in filteredTags" :key="tag.id" :value="tag.id" :text-value="tag.name" class="
              blog-tag-picker__item
            "
          >
            <span class="blog-tag-picker__hash" aria-hidden="true">#</span>
            <span>{{ tag.name }}</span>
            <ComboboxItemIndicator class="blog-tag-picker__check">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </ComboboxItemIndicator>
          </ComboboxItem>
          <!-- Last, so Enter on the first highlighted row picks an existing tag before creating a near-duplicate. -->
          <ComboboxItem
            v-if="canCreate" :value="CREATE" class="
              blog-tag-picker__item blog-tag-picker__item--create
            " @select="createFromQuery"
          >
            <Plus :size="14" />
            <span>Create tag “{{ trimmedQuery }}”</span>
          </ComboboxItem>
          <ComboboxEmpty>No tags match</ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxList>
    </Combobox>
  </div>
</template>
