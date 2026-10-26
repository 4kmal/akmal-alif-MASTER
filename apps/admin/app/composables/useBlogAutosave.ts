import type { Ref } from 'vue'
import type { BlogDraft, BlogPostDetail } from '@/utils/blog-studio'
import { useBlogApi } from '@/composables/useBlogApi'
import { cloneDraft, isStaleDraftError } from '@/utils/blog-studio'

export type BlogSaveState = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'stale' | 'recovery'

export function useBlogAutosave(postId: Ref<string | null>, draft: Ref<BlogDraft | null>, onSaved?: (detail: BlogPostDetail) => void) {
  const api = useBlogApi()
  const state = ref<BlogSaveState>('saved')
  const lastError = ref('')
  const staleVersion = ref<number | null>(null)
  const recoveryAvailable = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  const recoveryKey = computed(() => postId.value ? `akmal-blog-draft:${postId.value}` : '')

  function persistRecovery() {
    if (!import.meta.client || !draft.value || !recoveryKey.value)
      return
    try {
      localStorage.setItem(recoveryKey.value, JSON.stringify({ draft: cloneDraft(draft.value), savedAt: new Date().toISOString() }))
      recoveryAvailable.value = true
    }
    catch {
      // Storage is optional and should never block an editor save.
    }
  }

  function inspectRecovery() {
    if (!import.meta.client || !recoveryKey.value || !draft.value)
      return null
    try {
      const raw = localStorage.getItem(recoveryKey.value)
      if (!raw)
        return null
      const parsed = JSON.parse(raw) as { draft?: BlogDraft, savedAt?: string }
      if (parsed.draft && new Date(parsed.savedAt ?? 0) > new Date(draft.value.updated_at)) {
        recoveryAvailable.value = true
        return parsed.draft
      }
    }
    catch {
      // A corrupt recovery entry is ignored and can be replaced by the next edit.
    }
    return null
  }

  function markChanged() {
    state.value = 'unsaved'
    lastError.value = ''
    persistRecovery()
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      void save()
    }, 2000)
  }

  async function save() {
    if (!postId.value || !draft.value || state.value === 'saving' || state.value === 'stale')
      return null
    state.value = 'saving'
    try {
      const result = await api.saveDraft(postId.value, { ...cloneDraft(draft.value), version: draft.value.version })
      draft.value = result.draft
      state.value = 'saved'
      staleVersion.value = null
      lastError.value = ''
      if (import.meta.client && recoveryKey.value)
        localStorage.removeItem(recoveryKey.value)
      recoveryAvailable.value = false
      onSaved?.(result)
      return result
    }
    catch (error: unknown) {
      if (isStaleDraftError(error)) {
        staleVersion.value = error.data.current_version
        state.value = 'stale'
        lastError.value = 'Another tab saved a newer version. Review it before continuing.'
      }
      else if (!navigator.onLine) {
        state.value = 'offline'
        lastError.value = 'You are offline. The local recovery copy is safe.'
        persistRecovery()
      }
      else {
        state.value = 'error'
        lastError.value = error instanceof Error ? error.message : 'Could not save the draft.'
        persistRecovery()
      }
      return null
    }
  }

  async function checkpoint() {
    const result = await save()
    if (!result || !postId.value)
      return null
    return api.checkpoint(postId.value, result.draft.version)
  }

  function acceptRecovery() {
    const recovered = inspectRecovery()
    if (!recovered || !draft.value)
      return false
    draft.value = recovered
    state.value = 'recovery'
    markChanged()
    return true
  }

  function discardRecovery() {
    if (import.meta.client && recoveryKey.value)
      localStorage.removeItem(recoveryKey.value)
    recoveryAvailable.value = false
  }

  function keepRecovery() {
    if (timer)
      clearTimeout(timer)
    persistRecovery()
    state.value = 'recovery'
    lastError.value = 'Working copy is preserved locally until you review the current server version.'
  }

  function dispose() {
    if (timer)
      clearTimeout(timer)
  }

  onBeforeUnmount(dispose)
  watch(postId, inspectRecovery, { immediate: true })

  return { state, lastError, staleVersion, recoveryAvailable, markChanged, save, checkpoint, inspectRecovery, acceptRecovery, discardRecovery, keepRecovery, dispose }
}
