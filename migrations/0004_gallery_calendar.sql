PRAGMA foreign_keys = ON;

ALTER TABLE blog_categories ADD COLUMN icon_key TEXT NOT NULL DEFAULT 'general';
ALTER TABLE blog_categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

UPDATE blog_categories
SET icon_key = CASE slug
  WHEN 'psychology' THEN 'psychology'
  WHEN 'machine-learning' THEN 'machine-learning'
  WHEN 'neuroscience' THEN 'neuroscience'
  ELSE 'general'
END
WHERE icon_key = 'general';

DROP TRIGGER IF EXISTS blog_categories_updated_at;
CREATE TRIGGER blog_categories_updated_at
AFTER UPDATE OF slug, name, description, color_class, sort_order, is_active, icon_key, version ON blog_categories
FOR EACH ROW
BEGIN
  UPDATE blog_categories
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS blog_gallery_sources (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  gallery_id TEXT NOT NULL REFERENCES blog_galleries(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 262144000),
  object_key TEXT NOT NULL UNIQUE,
  r2_upload_id TEXT NOT NULL UNIQUE,
  part_size INTEGER NOT NULL DEFAULT 10485760,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS blog_galleries (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  title TEXT NOT NULL,
  source_id TEXT REFERENCES blog_gallery_sources(id) ON DELETE SET NULL,
  resume_page INTEGER NOT NULL DEFAULT 1 CHECK (resume_page BETWEEN 1 AND 512),
  page_count INTEGER CHECK (page_count IS NULL OR (page_count BETWEEN 1 AND 512)),
  finalized_manifest_id TEXT,
  finalized_at TEXT,
  mutation_token TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (post_id)
);

CREATE TABLE IF NOT EXISTS blog_gallery_pages (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  gallery_id TEXT NOT NULL REFERENCES blog_galleries(id) ON DELETE CASCADE,
  original_page INTEGER NOT NULL CHECK (original_page BETWEEN 1 AND 512),
  title TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 511),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  asset_id TEXT REFERENCES blog_assets(id) ON DELETE RESTRICT,
  thumbnail_asset_id TEXT REFERENCES blog_assets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (gallery_id, original_page)
);

CREATE TABLE IF NOT EXISTS blog_gallery_manifests (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  gallery_id TEXT NOT NULL REFERENCES blog_galleries(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (gallery_id, revision)
);

CREATE TABLE IF NOT EXISTS blog_gallery_manifest_pages (
  manifest_id TEXT NOT NULL REFERENCES blog_gallery_manifests(id) ON DELETE RESTRICT,
  page_id TEXT NOT NULL,
  original_page INTEGER NOT NULL CHECK (original_page BETWEEN 1 AND 512),
  title TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 511),
  visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
  asset_id TEXT NOT NULL REFERENCES blog_assets(id) ON DELETE RESTRICT,
  thumbnail_asset_id TEXT NOT NULL REFERENCES blog_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (manifest_id, page_id),
  UNIQUE (manifest_id, original_page),
  UNIQUE (manifest_id, sort_order)
);

CREATE TABLE IF NOT EXISTS blog_post_gallery_refs (
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  manifest_id TEXT NOT NULL REFERENCES blog_gallery_manifests(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('draft', 'published')),
  PRIMARY KEY (post_id, manifest_id, scope)
);

CREATE TABLE IF NOT EXISTS blog_gallery_source_parts (
  source_id TEXT NOT NULL REFERENCES blog_gallery_sources(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 25),
  etag TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  PRIMARY KEY (source_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_blog_gallery_post ON blog_galleries (post_id, status);
CREATE INDEX IF NOT EXISTS idx_blog_gallery_pages_gallery_order ON blog_gallery_pages (gallery_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_blog_gallery_manifest_pages_manifest_order ON blog_gallery_manifest_pages (manifest_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_blog_post_gallery_refs_manifest_scope ON blog_post_gallery_refs (manifest_id, scope);
CREATE INDEX IF NOT EXISTS idx_blog_gallery_sources_gallery_status ON blog_gallery_sources (gallery_id, status);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  url TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('activity', 'event', 'meeting')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  start_date TEXT,
  end_date TEXT,
  starts_at TEXT,
  ends_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'busy')),
  participation TEXT NOT NULL DEFAULT 'interested' CHECK (participation IN ('interested', 'planning', 'confirmed')),
  blocks_availability INTEGER NOT NULL DEFAULT 0 CHECK (blocks_availability IN (0, 1)),
  archived_at TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (start_date IS NOT NULL AND end_date IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL)
    OR (start_date IS NULL AND end_date IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
  ),
  CHECK (end_date IS NULL OR end_date > start_date),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON calendar_events (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_times ON calendar_events (starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_visibility_archived ON calendar_events (visibility, archived_at);

CREATE TABLE IF NOT EXISTS calendar_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  settings_json TEXT NOT NULL DEFAULT '{"timezone":"Asia/Kuala_Lumpur"}',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO calendar_settings (id, version, settings_json)
VALUES (1, 1, '{"timezone":"Asia/Kuala_Lumpur"}');

CREATE TABLE IF NOT EXISTS calendar_audit_records (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_audit_entity_created ON calendar_audit_records (entity_id, created_at DESC);
