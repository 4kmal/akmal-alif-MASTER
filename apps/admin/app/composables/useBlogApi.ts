import type {
  BlogAsset,
  BlogDraft,
  BlogMediaProject,
  BlogMediaUpload,
  BlogPostDetail,
  BlogPostSummary,
  BlogRevision,
  BlogSettings,
  BlogTaxonomy,
} from '@/utils/blog-studio'

type DraftPayload = Omit<BlogDraft, 'version' | 'updated_at'> & { version: number }

export function useBlogApi() {
  const base = '/api/admin/blog'

  return {
    listPosts: () => useAPI<{ posts: BlogPostSummary[] }>(`${base}/posts`),
    createPost: (payload: { title?: string, slug?: string }) => useAPI<BlogPostDetail>(`${base}/posts`, { method: 'POST', body: payload }),
    getPost: (id: string) => useAPI<BlogPostDetail>(`${base}/posts/${encodeURIComponent(id)}`),
    saveDraft: (id: string, payload: DraftPayload) => useAPI<BlogPostDetail>(`${base}/posts/${encodeURIComponent(id)}/draft`, { method: 'PUT', body: payload }),
    checkpoint: (id: string, version: number) => useAPI<{ revision: BlogRevision }>(`${base}/posts/${encodeURIComponent(id)}/checkpoint`, { method: 'POST', body: { version } }),
    listRevisions: (id: string) => useAPI<{ revisions: BlogRevision[] }>(`${base}/posts/${encodeURIComponent(id)}/revisions`),
    restoreRevision: (id: string, version: number, revisionId: string) => useAPI<BlogPostDetail>(`${base}/posts/${encodeURIComponent(id)}/restore`, { method: 'POST', body: { version, revision_id: revisionId } }),
    publishPost: (id: string, version: number) => useAPI<BlogPostDetail>(`${base}/posts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { version } }),
    setPostStatus: (id: string, status: 'draft' | 'archived') => useAPI<BlogPostDetail>(`${base}/posts/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } }),
    getPreview: (id: string) => useAPI<string>(`${base}/posts/${encodeURIComponent(id)}/preview`, { method: 'GET', headers: { Accept: 'text/html' } }),
    getTaxonomy: () => useAPI<BlogTaxonomy>(`${base}/taxonomy`),
    createTaxonomy: (payload: { kind: 'category' | 'tag', name: string, slug: string }) => useAPI<BlogTaxonomy>(`${base}/taxonomy`, { method: 'POST', body: payload }),
    getSettings: () => useAPI<BlogSettings>(`${base}/settings`),
    saveSettings: (settings: BlogSettings) => useAPI<BlogSettings>(`${base}/settings`, { method: 'PUT', body: settings }),
    listMedia: () => useAPI<{ assets: BlogAsset[], projects: BlogMediaProject[] }>(`${base}/media`),
    startUpload: (payload: { filename: string, mime_type: string, size: number, width?: number, height?: number, duration_ms?: number, derived_from?: string[] }) => useAPI<{ asset: BlogAsset, upload: BlogMediaUpload }>(`${base}/media/uploads`, { method: 'POST', body: payload }),
    getUpload: (id: string) => useAPI<{ upload: BlogMediaUpload }>(`${base}/media/uploads/${encodeURIComponent(id)}`),
    putUploadPart: (id: string, part: number, body: Blob, signal?: AbortSignal) => useAPI<{ part_number: number, etag: string }>(`${base}/media/uploads/${encodeURIComponent(id)}/parts/${part}`, { method: 'PUT', body, signal }),
    completeUpload: (id: string, parts: { part_number: number, etag: string }[]) => useAPI<{ asset: BlogAsset }>(`${base}/media/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { parts } }),
    abortUpload: (id: string) => useAPI<{ aborted: true }>(`${base}/media/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createProject: (payload: { title: string, document: unknown }) => useAPI<{ project: BlogMediaProject }>(`${base}/media/projects`, { method: 'POST', body: payload }),
    updateProject: (id: string, payload: { version: number, title: string, document: unknown }) => useAPI<{ project: BlogMediaProject }>(`${base}/media/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  }
}
