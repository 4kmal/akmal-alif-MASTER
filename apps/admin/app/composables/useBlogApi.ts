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
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarSettings,
  GalleryDetailDto,
  GalleryRevisionSummary,
  GallerySourceUpload,
  GalleryUploadPart,
} from '@/utils/content-calendar'
import { useAPI } from '@/utils/api'
import { gallerySummaryFromManifest, normalizeCalendarEvent, normalizeCalendarSettings, normalizeGalleryManifest, toCalendarApiPayload } from '@/utils/content-calendar'

type DraftPayload = Omit<BlogDraft, 'version' | 'updated_at'> & { version: number }

export function useBlogApi() {
  const base = '/api/admin/blog'
  const calendarBase = '/api/admin/calendar'

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
    createTaxonomy: (payload: { kind: 'category' | 'tag', name: string, slug: string, description?: string, icon_key?: string, sort_order?: number }) => useAPI<BlogTaxonomy>(`${base}/taxonomy`, { method: 'POST', body: payload }),
    updateCategory: (id: string, payload: { version: number, name: string, description: string, sort_order: number, is_active: boolean, icon_key: string }) => useAPI<BlogTaxonomy>(`${base}/taxonomy/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
    getSettings: () => useAPI<BlogSettings>(`${base}/settings`),
    saveSettings: (settings: BlogSettings) => useAPI<BlogSettings>(`${base}/settings`, { method: 'PUT', body: settings }),
    listMedia: () => useAPI<{ assets: BlogAsset[], projects: BlogMediaProject[] }>(`${base}/media`),
    startUpload: (payload: { filename: string, mime_type: string, size: number, width?: number, height?: number, duration_ms?: number, derived_from?: string[] }, signal?: AbortSignal) => useAPI<{ asset: BlogAsset, upload: BlogMediaUpload }>(`${base}/media/uploads`, { method: 'POST', body: payload, signal }),
    getUpload: (id: string) => useAPI<{ upload: BlogMediaUpload }>(`${base}/media/uploads/${encodeURIComponent(id)}`),
    putUploadPart: (id: string, part: number, body: Blob, signal?: AbortSignal) => useAPI<{ part_number: number, etag: string }>(`${base}/media/uploads/${encodeURIComponent(id)}/parts/${part}`, { method: 'PUT', body, signal }),
    completeUpload: (id: string, parts: { part_number: number, etag: string }[], signal?: AbortSignal) => useAPI<{ asset: BlogAsset }>(`${base}/media/uploads/${encodeURIComponent(id)}/complete`, { method: 'POST', body: { parts }, signal }),
    abortUpload: (id: string) => useAPI<{ aborted: true }>(`${base}/media/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    createProject: (payload: { title: string, document: unknown }) => useAPI<{ project: BlogMediaProject }>(`${base}/media/projects`, { method: 'POST', body: payload }),
    updateProject: (id: string, payload: { version: number, title: string, document: unknown }) => useAPI<{ project: BlogMediaProject }>(`${base}/media/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
    listGalleries: async () => {
      const response = await useAPI<{ galleries: GalleryDetailDto[] }>(`${base}/galleries`)
      const galleries = response.galleries.map(item => normalizeGalleryManifest(item)).map(gallerySummaryFromManifest)
      return { galleries }
    },
    createGallery: async (payload: { post_id: string, title?: string, page_count?: number | null }) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries`, { method: 'POST', body: payload })),
    getGallery: async (id: string) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(id)}`)),
    getGallerySource: (id: string) => useAPI<Blob>(`${base}/galleries/${encodeURIComponent(id)}/source`, { responseType: 'blob' }),
    updateGallery: async (id: string, payload: { version: number, title: string, page_count?: number | null, resume_page?: number }) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(id)}`, { method: 'PUT', body: payload })),
    createGalleryDraft: async (id: string, version: number) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(id)}/draft`, { method: 'POST', body: { version } })),
    finalizeGallery: async (id: string, payload: { version: number }) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(id)}/finalize`, { method: 'POST', body: payload })),
    updateGalleryPage: async (galleryId: string, pageId: string, payload: { version: number, page: { original_page: number, title?: string | null, caption?: string | null, order: number, visible: boolean, asset_id: string, thumbnail_asset_id: string } }) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(galleryId)}/pages/${encodeURIComponent(pageId)}`, { method: 'PUT', body: payload })),
    reorderGalleryPages: async (galleryId: string, payload: { version: number, page_ids: string[] }) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(galleryId)}/pages/reorder`, { method: 'PUT', body: payload })),
    listGalleryRevisions: (id: string) => useAPI<{ revisions: GalleryRevisionSummary[] }>(`${base}/galleries/${encodeURIComponent(id)}/revisions`),
    getGalleryRevision: async (id: string, revision: string | number) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(id)}/revisions/${encodeURIComponent(String(revision))}`)),
    startGallerySourceUpload: (galleryId: string, payload: { version: number, filename: string, mime_type: string, size: number, page_count?: number | null }) => useAPI<{ source: GallerySourceUpload, upload: GallerySourceUpload, version: number }>(`${base}/galleries/${encodeURIComponent(galleryId)}/source`, { method: 'POST', body: payload }),
    getGallerySourceUpload: (_galleryId: string, uploadId: string) => useAPI<{ source: GallerySourceUpload, upload: GallerySourceUpload }>(`${base}/galleries/source-uploads/${encodeURIComponent(uploadId)}`),
    putGallerySourcePart: (_galleryId: string, uploadId: string, part: number, body: Blob, signal?: AbortSignal) => useAPI<{ part_number: number, etag: string }>(`${base}/galleries/source-uploads/${encodeURIComponent(uploadId)}/parts/${part}`, { method: 'PUT', body, signal }),
    completeGallerySourceUpload: (_galleryId: string, uploadId: string, parts: GalleryUploadPart[], signal?: AbortSignal) => useAPI<{ source: GallerySourceUpload }>(`${base}/galleries/source-uploads/${encodeURIComponent(uploadId)}/complete`, { method: 'POST', body: { parts }, signal }),
    abortGallerySourceUpload: (_galleryId: string, uploadId: string) => useAPI<{ aborted: true }>(`${base}/galleries/source-uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }),
    attachGalleryPage: async (galleryId: string, payload: { version: number, page: { original_page: number, title?: string | null, caption?: string | null, order: number, visible: boolean, asset_id: string, thumbnail_asset_id: string } }, signal?: AbortSignal) => normalizeGalleryManifest(await useAPI<GalleryDetailDto>(`${base}/galleries/${encodeURIComponent(galleryId)}/pages`, { method: 'POST', body: payload, signal })),
    listCalendarEvents: async (params?: { include_archived?: boolean, from?: string, to?: string }) => {
      const query = params ? `?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}` : ''
      const response = await useAPI<{ events: CalendarEvent[] }>(`${calendarBase}/events${query}`)
      return { events: response.events.map(event => normalizeCalendarEvent(event)) }
    },
    createCalendarEvent: async (payload: CalendarEventInput) => normalizeCalendarEvent(await useAPI<{ event: CalendarEvent }>(`${calendarBase}/events`, { method: 'POST', body: toCalendarApiPayload(payload) })),
    getCalendarEvent: async (id: string) => normalizeCalendarEvent(await useAPI<{ event: CalendarEvent }>(`${calendarBase}/events/${encodeURIComponent(id)}`)),
    updateCalendarEvent: async (id: string, payload: CalendarEventInput & { version: number }) => normalizeCalendarEvent(await useAPI<{ event: CalendarEvent }>(`${calendarBase}/events/${encodeURIComponent(id)}`, { method: 'PUT', body: { ...toCalendarApiPayload(payload), version: payload.version } })),
    setCalendarEventStatus: async (id: string, status: 'active' | 'archived', version: number) => normalizeCalendarEvent(await useAPI<{ event: CalendarEvent }>(`${calendarBase}/events/${encodeURIComponent(id)}/status`, { method: 'POST', body: { version, status: status === 'archived' ? 'archive' : 'restore' } })),
    getCalendarSettings: async () => normalizeCalendarSettings(await useAPI<{ settings: CalendarSettings }>(`${calendarBase}/settings`)),
    saveCalendarSettings: async (payload: CalendarSettings) => normalizeCalendarSettings(await useAPI<{ settings: CalendarSettings }>(`${calendarBase}/settings`, { method: 'PUT', body: payload })),
  }
}
