# Gallery and calendar integration contract

The gallery and calendar APIs use the portfolio D1/R2 bindings. Authoring routes are owner-only `/api/admin/**` routes and are protected by the existing owner JWT/CSRF boundary. Sink bearer authentication is not accepted for these routes.

## Article galleries

An article owns one working gallery. Create it with `POST /api/admin/blog/galleries` and `{ "post_id", "title"?, "page_count"? }`. Gallery reads return:

```json
{
  "gallery": {
    "id": "gallery-id",
    "post_id": "post-id",
    "version": 1,
    "status": "draft",
    "title": "Anthem",
    "resume": { "next_page": 1, "uploaded_pages": 0 },
    "page_count": 211,
    "source": null,
    "manifest_id": null,
    "finalized_at": null
  },
  "pages": [],
  "manifest": null
}
```

Every draft mutation carries the current `version`; a stale version is `409` with `data.current_version`. A source PDF is initialized with `POST /api/admin/blog/galleries/:id/source` and `{ "version", "filename", "mime_type": "application/pdf", "size", "page_count"? }`. Source bytes use the existing sequential multipart shape:

- `PUT /api/admin/blog/galleries/source-uploads/:uploadId/parts/:part` streams one raw part and requires `Content-Length` from 1 through 10 MiB.
- `GET /api/admin/blog/galleries/source-uploads/:uploadId` returns recorded parts.
- `POST /api/admin/blog/galleries/source-uploads/:uploadId/complete` accepts `{ "parts": [{ "part_number", "etag" }] }`.
- `DELETE /api/admin/blog/galleries/source-uploads/:uploadId` aborts an active upload.

PDF sources are limited to 250 MiB and 25 parts. A client may upload at most two parts concurrently. They are stored under `blog/originals/gallery/` and are never served by public media aliases. Owner streaming is `GET/HEAD /api/admin/blog/galleries/:id/source` with byte ranges and `no-store`.

Pages are attached after the client converts the PDF sequentially with PDF.js and uploads ready WebP assets through ordinary blog media uploads. `POST /api/admin/blog/galleries/:id/pages` accepts `{ "version", "page": { "original_page", "title"?, "caption"?, "order", "visible", "asset_id", "thumbnail_asset_id" } }`. Page and thumbnail assets must be owner-owned, ready image or GIF assets. The page cap is 512; finalization also requires contiguous pages beginning at 1 and every required page and asset to be ready.

`POST /api/admin/blog/galleries/:id/finalize` accepts `{ "version" }`. It writes an immutable manifest revision and returns its `manifest_id`. The post draft must include a Tiptap node `{ "type": "blogGallery", "attrs": { "manifestId": "..." } }`; the server resolves every page asset and records draft references. Publishing copies the full manifest image and thumbnail set to published refs with set-based SQL.

`PUT /api/admin/blog/galleries/:id/pages/reorder` accepts either `{ "version", "page_ids": ["...", "..."] }` or `{ "version", "pages": [{ "page_id", "order" }] }`. It requires a complete permutation and commits the order change with one gallery CAS. A finalized gallery can be reopened as a new working draft with `POST /api/admin/blog/galleries/:id/draft` and `{ "version" }`; the previous manifest remains immutable and the next finalize receives the next revision number.

Public HTML contains a safe client mount marker:

```html
<div class="blog-gallery" data-gallery-manifest-id="..." data-gallery-manifest="..." data-gallery-load="click" aria-label="Anthem"><noscript><a class="blog-gallery-fallback" href="/media/blog/image-asset-id"><img src="/media/blog/thumbnail-asset-id" alt="Anthem" loading="lazy"><span>Anthem</span></a></noscript></div>
```

When a first visible manifest page exists, the server-rendered fallback links to
that page and includes its thumbnail. Preview HTML uses the owner media source
route for the same static fallback; the preview sandbox remains scripts-disabled.

`GET /api/blog/galleries/:manifestId` returns `404` until a currently published, nonfuture post references the manifest:

```json
{
  "id": "manifest-id",
  "manifestId": "manifest-id",
  "revision": 1,
  "title": "Anthem",
  "created_at": "2026-10-28T00:00:00.000Z",
  "pages": [{
    "id": "page-id",
    "original_page": 1,
    "title": null,
    "caption": null,
    "order": 0,
    "visible": true,
    "asset_id": "image-asset-id",
    "thumbnail_asset_id": "thumbnail-asset-id",
    "original_url": "/media/blog/image-asset-id",
    "thumbnail_url": "/media/blog/thumbnail-asset-id"
  }]
}
```

The public route only reads immutable manifest snapshots. Draft gallery rows and private source metadata cannot leak through a reused asset ID. Public image delivery still requires a published `blog_post_asset_refs` row.

`blogYouTube` nodes use `{ "videoId": "11-character-id", "title"?: "..." }`. IDs must match `[A-Za-z0-9_-]{11}`. Public HTML is a click-to-load marker with no autoplay iframe; article preview is a static text fallback in the scripts-disabled sandbox.

## Taxonomy

`GET /api/admin/blog/taxonomy` includes category `icon_key` and `version`. `PUT /api/admin/blog/taxonomy/categories/:id` accepts `{ "name", "description", "sort_order", "is_active", "icon_key", "version" }`. Category slugs are stable and cannot be changed. Deactivation keeps existing labels and references. Allowed icon keys include `civic-tech`, `cybersecurity`, `game-development`, `robotics`, `anthem`, `internet-culture`, `psychology`, `machine-learning`, `neuroscience`, and the existing general technology, design, education, music, news, personal, projects, and general keys. Migration backfills those three existing slugs and uses `general` for other pre-existing categories.

## Calendar

Owner routes:

- `GET /api/admin/calendar/events` lists events and includes `archived` and `archived_at`.
- `POST /api/admin/calendar/events` creates a private event by default.
- `GET /api/admin/calendar/events/:id` and `PUT /api/admin/calendar/events/:id` read or CAS-update `version`.
- `POST /api/admin/calendar/events/:id/status` accepts `{ "version", "status": "archive" | "restore" }` (or the equivalent `archived` boolean).
- `GET /api/admin/calendar/settings` and `PUT /api/admin/calendar/settings` use `{ "version", "timezone" }` and CAS-update settings.

Event fields are `title`, `description`, `location`, `url`, `kind` (`activity`, `event`, `meeting`), `timezone` (default `Asia/Kuala_Lumpur`), `all_day`, `start_date`/`end_date` exclusive for all-day events, or `starts_at`/`ends_at` UTC for timed events, `visibility` (`private`, `public`, `busy`), `participation` (`interested`, `planning`, `confirmed`), `blocks_availability`, `version`, and `archived_at`. There is no recurrence, booking, or external sync.

Public `GET /api/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` accepts a bounded 1–366 day range and returns `{ "timezone": "Asia/Kuala_Lumpur", "events": [], "upcoming": [] }` with `Cache-Control: public, max-age=60`. `events` is the requested range. `upcoming` independently contains at most the next three public or busy entries from the current Kuala Lumpur date through one year ahead, so browsing an older month does not erase the upcoming strip. Private and archived events are excluded. Public events retain their public metadata. Busy entries expose only their time shape, timezone, and `title: "Busy"`; they have no identifiers, location, URL, description, or participation metadata.
