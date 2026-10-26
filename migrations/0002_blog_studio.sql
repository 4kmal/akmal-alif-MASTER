PRAGMA foreign_keys = ON;

-- The legacy blog tables remain the published compatibility projection.  The
-- studio keeps its working copy, revisions, media and settings beside them so
-- autosaves never overwrite the public row.
ALTER TABLE blog_posts ADD COLUMN published_version INTEGER;

CREATE TABLE IF NOT EXISTS blog_post_drafts (
  post_id TEXT PRIMARY KEY NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
  cover_image_url TEXT,
  cover_image_alt TEXT,
  read_minutes INTEGER NOT NULL DEFAULT 1 CHECK (read_minutes > 0),
  meta_title TEXT,
  meta_description TEXT,
  content_json TEXT,
  content_html TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT
);

ALTER TABLE blog_post_drafts ADD COLUMN mutation_token TEXT;

CREATE TABLE IF NOT EXISTS blog_post_draft_tags (
  post_id TEXT NOT NULL REFERENCES blog_post_drafts(post_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS blog_post_revisions (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('original', 'checkpoint', 'publish', 'restore')),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_blog_post_revisions_post_created
  ON blog_post_revisions (post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_post_asset_refs (
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES blog_assets(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  PRIMARY KEY (post_id, asset_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_blog_post_asset_refs_asset_scope
  ON blog_post_asset_refs (asset_id, scope);

CREATE TABLE IF NOT EXISTS blog_assets (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'gif', 'video')),
  size INTEGER NOT NULL CHECK (size > 0),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  object_key TEXT NOT NULL UNIQUE,
  source_object_key TEXT NOT NULL UNIQUE,
  derived_from TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('uploading', 'ready', 'aborted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_assets_created_by_created
  ON blog_assets (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_media_projects (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  title TEXT NOT NULL,
  document TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_media_projects_owner_updated
  ON blog_media_projects (created_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS blog_uploads (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  asset_id TEXT NOT NULL UNIQUE REFERENCES blog_assets(id) ON DELETE CASCADE,
  r2_upload_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL,
  part_size INTEGER NOT NULL DEFAULT 10485760,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blog_upload_parts (
  upload_id TEXT NOT NULL REFERENCES blog_uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number > 0),
  etag TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  PRIMARY KEY (upload_id, part_number)
);

CREATE TABLE IF NOT EXISTS blog_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by TEXT
);

INSERT OR IGNORE INTO blog_settings (key, value)
VALUES ('artwork_motion', 'once');

-- Seed a recoverable draft and an immutable original revision for every legacy
-- row.  content_json deliberately stays NULL until the editor converts it to
-- the bounded Tiptap schema.
INSERT OR IGNORE INTO blog_post_drafts (
  post_id, version, schema_version, title, slug, excerpt, category_id,
  cover_image_url, cover_image_alt, read_minutes, meta_title, meta_description,
  content_json, content_html, updated_at, updated_by
)
SELECT
  p.id, 1, 1, p.title, p.slug, p.excerpt, p.category_id,
  p.cover_image_url, p.cover_image_alt, p.read_minutes, p.meta_title,
  p.meta_description, NULL, p.content_html, p.updated_at, p.updated_by
FROM blog_posts AS p
WHERE NOT EXISTS (SELECT 1 FROM blog_post_drafts AS d WHERE d.post_id = p.id);

INSERT OR IGNORE INTO blog_post_draft_tags (post_id, tag_id)
SELECT post_id, tag_id FROM blog_post_tags;

INSERT OR IGNORE INTO blog_post_revisions (
  post_id, version, kind, snapshot_json, created_at, created_by
)
SELECT
  d.post_id, d.version, 'original',
  json_object(
    'version', d.version,
    'schema_version', d.schema_version,
    'title', d.title,
    'slug', d.slug,
    'excerpt', d.excerpt,
    'category_id', d.category_id,
    'tag_ids', COALESCE((
      SELECT json_group_array(tag_id)
      FROM blog_post_draft_tags AS dt
      WHERE dt.post_id = d.post_id
    ), json('[]')),
    'cover_image_url', d.cover_image_url,
    'cover_image_alt', d.cover_image_alt,
    'read_minutes', d.read_minutes,
    'meta_title', d.meta_title,
    'meta_description', d.meta_description,
    'content_json', d.content_json,
    'content_html', d.content_html,
    'updated_at', d.updated_at
  ),
  d.updated_at, d.updated_by
FROM blog_post_drafts AS d
WHERE NOT EXISTS (
  SELECT 1 FROM blog_post_revisions AS r
  WHERE r.post_id = d.post_id AND r.kind = 'original'
);

UPDATE blog_posts
SET published_version = 1
WHERE status = 'published' AND published_version IS NULL;
