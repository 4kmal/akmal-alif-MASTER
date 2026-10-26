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
  let saveInFlight: Promise<BlogPostDetail | null> | null = null
  let saveInFlightPostGeneration: number | null = null
  let editGeneration = 0
  let savedGeneration = 0
  let postGeneration = 0
  let disposed = false

  const recoveryKey = computed(() => postId.value ? `akmal-blog-draft:${postId.value}` : '')

  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }

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

  function scheduleSave() {
    clearTimer()
    if (disposed || !postId.value || state.value === 'stale')
      return
    timer = setTimeout(() => {
      timer = undefined
      void save()
    }, 2000)
  }

  function markChanged() {
    editGeneration += 1
    persistRecovery()
    if (state.value === 'stale')
      return
    state.value = 'unsaved'
    lastError.value = ''
    scheduleSave()
  }

  function handleSaveError(error: unknown) {
    if (isStaleDraftError(error)) {
      staleVersion.value = error.data.current_version
      state.value = 'stale'
      lastError.value = 'Another tab saved a newer version. Review it before continuing.'
      clearTimer()
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      state.value = 'offline'
      lastError.value = 'You are offline. The local recovery copy is safe.'
      persistRecovery()
      return
    }
    state.value = 'error'
    lastError.value = error instanceof Error ? error.message : 'Could not save the draft.'
    persistRecovery()
  }

  async function saveLoop() {
    let latestResult: BlogPostDetail | null = null

    while (true) {
      if (disposed || !postId.value || !draft.value || state.value === 'stale')
        break
      const id = postId.value
      const generation = postGeneration
      const editAtStart = editGeneration
      const snapshot = cloneDraft(draft.value)

      state.value = 'saving'
      try {
        const result = await api.saveDraft(id, { ...snapshot, version: snapshot.version })

        // A route switch or unmount invalidates this response. It must never
        // update the next post's draft or save state.
        if (disposed || generation !== postGeneration || id !== postId.value)
          return null

        latestResult = result
        if (editGeneration === editAtStart) {
          draft.value = result.draft
          savedGeneration = editGeneration
          state.value = 'saved'
          staleVersion.value = null
          lastError.value = ''
          if (import.meta.client && recoveryKey.value)
            localStorage.removeItem(recoveryKey.value)
          recoveryAvailable.value = false
        }
        else {
          // Keep edits made while the request was in flight, but adopt the
          // server's new optimistic-lock version and timestamp.
          const currentDraft = draft.value
          if (currentDraft) {
            draft.value = {
              ...currentDraft,
              version: result.draft.version,
              updated_at: result.draft.updated_at,
            }
          }
          savedGeneration = editAtStart
          state.value = 'unsaved'
          staleVersion.value = null
          lastError.value = ''
          persistRecovery()
        }
        onSaved?.(result)

        if (editGeneration === editAtStart)
          return latestResult
      }
      catch (error: unknown) {
        if (disposed || generation !== postGeneration || id !== postId.value)
          return null
        handleSaveError(error)
        if (!isStaleDraftError(error) && editGeneration > editAtStart)
          scheduleSave()
        return null
      }
    }

    return latestResult
  }

  async function save() {
    if (!postId.value || !draft.value || state.value === 'stale')
      return null

    if (saveInFlight) {
      const operation = saveInFlight
      const operationPostGeneration = saveInFlightPostGeneration
      const result = await operation
      // A reload or route switch invalidated the operation that was already
      // running. Start a save for the newly loaded draft after it settles.
      if (!disposed && operationPostGeneration !== postGeneration && postId.value && draft.value)
        return save()
      return result
    }

    const operationPostGeneration = postGeneration
    const operation = Promise.resolve().then(async () => {
      try {
        return await saveLoop()
      }
      finally {
        if (saveInFlight === operation) {
          saveInFlight = null
          saveInFlightPostGeneration = null
        }
      }
    })
    saveInFlight = operation
    saveInFlightPostGeneration = operationPostGeneration
    return operation
  }

  async function checkpoint() {
    const result = await save()
    if (!result || !postId.value)
      return null
    const id = postId.value
    const generation = postGeneration
    const version = result.draft.version
    const checkpoint = await api.checkpoint(id, version)
    return generation === postGeneration && id === postId.value ? checkpoint : null
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
    clearTimer()
    persistRecovery()
    state.value = 'recovery'
    lastError.value = 'Working copy is preserved locally until you review the current server version.'
  }

  function resetForReload() {
    clearTimer()
    postGeneration += 1
    editGeneration = 0
    savedGeneration = 0
    staleVersion.value = null
    lastError.value = ''
    recoveryAvailable.value = false
    state.value = 'saved'
  }

  function dispose() {
    disposed = true
    clearTimer()
    postGeneration += 1
  }

  onBeforeUnmount(dispose)
  watch(postId, () => {
    clearTimer()
    postGeneration += 1
    editGeneration = 0
    savedGeneration = 0
    staleVersion.value = null
    lastError.value = ''
    recoveryAvailable.value = false
    state.value = 'saved'
  }, { immediate: true })

  return {
    state,
    lastError,
    staleVersion,
    recoveryAvailable,
    markChanged,
    save,
    checkpoint,
    inspectRecovery,
    acceptRecovery,
    discardRecovery,
    keepRecovery,
    resetForReload,
    dispose,
    savedGeneration: computed(() => savedGeneration),
  }
}
