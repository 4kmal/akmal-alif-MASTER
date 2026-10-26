# Blog studio integration contract

The blog studio keeps portfolio D1/R2 authoritative. Sink storage and APIs stay separate. All authoring endpoints below are owner-only `/api/admin/blog/**` routes; the public gateway forwards them unchanged.

## Posts

- `GET /posts` returns `{ posts: BlogPostSummary[] }`; `POST /posts` accepts `{ title?, slug? }` and returns the same detail as `GET /posts/:id`.
- `GET /posts/:id` returns `{ post, draft }`. `post` includes the existing post fields plus `published_version` and `has_unpublished_changes`. `draft` contains `version`, `schema_version: 1`, `title`, `slug`, `excerpt`, `category_id`, `tag_ids`, `cover_image_url`, `cover_image_alt`, `read_minutes`, `meta_title`, `meta_description`, `content_json` (Tiptap JSON or null for untouched legacy HTML), `content_html`, and `updated_at`.
- `PUT /posts/:id/draft` accepts `{ version, ...draftFields }` and returns `{ post, draft }`. The server validates/renders rich JSON and sanitizes HTML. A stale version returns HTTP 409 with `data.current_version`.
- `POST /posts/:id/checkpoint` accepts `{ version }`, returns `{ revision }`; `GET /posts/:id/revisions` returns `{ revisions }`.
- `POST /posts/:id/restore` accepts `{ version, revision_id }` and returns `{ post, draft }`; restoring changes only the draft.
- `POST /posts/:id/publish` accepts `{ version }` and returns `{ post, draft }`. It promotes fields, HTML, tags and asset references atomically. A published slug is immutable.
- `POST /posts/:id/status` accepts `{ status: 'draft' | 'archived' }` and returns `{ post, draft }`. Archive recovery returns to draft.
- `GET /posts/:id/preview` returns sanitized complete HTML with reader styles, private source media URLs, no analytics/scripts and `no-store`.
- `GET /taxonomy` returns `{ categories, tags }`, including IDs. `POST /taxonomy` accepts `{ kind: 'category' | 'tag', name, slug }` and returns the updated taxonomy.

The editor does not overwrite published fields on autosave. It preserves an original revision before first legacy conversion. Manual saves/checkpoints and publishes create revisions; ordinary autosaves update the recoverable working copy.

## Rich document nodes

Use Tiptap standard doc/paragraph/text/heading/blockquote/codeBlock/hardBreak/horizontalRule/list/table nodes and standard formatting marks. Paragraph attributes are `textAlign`, `lineHeight`, `indent`; textStyle attributes are `fontFamily`, `fontSize`, `color`, `backgroundColor`. Safe approved values only.

Uploaded media use `blogMedia` nodes with attributes `{ assetId, kind: 'image' | 'gif' | 'video', src, alt, caption, width: 1..100, align: 'left' | 'center' | 'right', posterAssetId? }`. The server resolves `assetId` and ignores a forged `src`. Legacy image/video sources remain supported through explicit same-origin legacy paths. Server validation rejects unsupported document structures rather than silently dropping them. Public HTML is the compatibility projection, not the editor JSON.

## Settings

- `GET /settings` and `PUT /settings` use `{ artwork_motion: 'once' | 'off' }`.
- Public `GET /api/blog/settings` exposes that object only, with 60-second caching. Missing configuration defaults to `once`; network failures on the client remain static. Reduced motion always wins.

## Media

- `GET /media` returns `{ assets, projects }`.
- Asset fields include `{ id, name, mime_type, kind, size, width, height, duration_ms, url, source_url, derived_from, created_at }`. `url` is the future public `/media/blog/...` URL; `source_url` is the protected owner `/api/admin/blog/media/:id/source` URL.
- `POST /media/uploads` accepts `{ filename, mime_type, size, width?, height?, duration_ms?, derived_from?: string[] }`; returns `{ asset, upload: { id, part_size: 10485760, parts: [] } }`.
- `GET /media/uploads/:id` returns upload state and recorded `{ part_number, etag }` parts. `PUT /media/uploads/:id/parts/:part` streams one raw part and returns `{ part_number, etag }`.
- `POST /media/uploads/:id/complete` accepts `{ parts: [{ part_number, etag }] }` and returns `{ asset }`. `DELETE /media/uploads/:id` returns `{ aborted: true }`.
- `GET/HEAD /media/:id/source` is private and supports byte ranges. Newly uploaded public media require a currently published post reference; legacy media behavior is unchanged.
- `POST /media/projects` accepts `{ title, document }`; `PUT /media/projects/:id` accepts `{ version, title, document }`; both return `{ project: { id, version, title, document, updated_at } }`.
- `GET /runtime/ffmpeg-core.js` and `/runtime/ffmpeg-core.wasm` stream pinned, self-hosted runtime objects from private admin R2 under `editor-runtime/ffmpeg/`. Never expose this namespace via `go/_assets`.

The shared project type and client processing implementation are owned by the main agent in `apps/admin/shared/blog-media-project.ts` and `apps/admin/app/utils/blog-media/`. UI components consume those modules; do not duplicate an FFmpeg engine.

## Limits and release

250 MiB of source media per project; sequential video output <=300 seconds, <=1920x1080, <=30 fps; GIF output <=30 seconds, <=15 fps, <=720px. At most two upload parts run concurrently. Originals and existing published assets are immutable. Editing projects and derived assets remain private until referenced by published content.

Local authoring uses local portfolio D1/R2 bindings. Frontend Vite keeps production writes blocked. Add portfolio migrations under root `migrations/`, never the admin Sink migrations. Pin runtime Node 24.21.0 / pnpm 11.2.2. Keep generated artifacts and repo-reference out of commits.
