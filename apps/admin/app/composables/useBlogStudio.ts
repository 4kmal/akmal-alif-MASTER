import type { BlogDraft } from '@/utils/blog-studio'
import { cloneDraft } from '@/utils/blog-studio'

/**
 * Prepare a recoverable local copy for a CAS save against the latest server
 * draft. Content and metadata stay local; only the optimistic-lock fields are
 * adopted from the server response.
 */
export function rebaseDraftOntoServer(local: BlogDraft, server: BlogDraft): BlogDraft {
  return {
    ...cloneDraft(local),
    version: server.version,
    updated_at: server.updated_at,
  }
}

/**
 * Keep edits made while an explicit conflict apply was in flight while still
 * moving the next save onto the version the server accepted.
 */
export function preserveDraftEditsAfterServerSave(local: BlogDraft, server: BlogDraft, changedDuringSave: boolean): BlogDraft {
  return changedDuringSave ? rebaseDraftOntoServer(local, server) : cloneDraft(server)
}
