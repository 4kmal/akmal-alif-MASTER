PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS blog_categories (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  color_class TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  excerpt TEXT NOT NULL,
  content_html TEXT NOT NULL,
  content_markdown TEXT,
  cover_image_url TEXT,
  cover_image_alt TEXT,
  category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  read_minutes INTEGER NOT NULL DEFAULT 1 CHECK (read_minutes > 0),
  meta_title TEXT,
  meta_description TEXT,
  canonical_path TEXT,
  published_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS blog_tags (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS blog_admins (
  user_id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS profile_metrics (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  profile_views INTEGER NOT NULL DEFAULT 0,
  post_impressions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS profile_page_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_path TEXT NOT NULL CHECK (length(page_path) <= 512),
  referrer TEXT CHECK (referrer IS NULL OR length(referrer) <= 1024),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 1024),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_categories_active_sort
  ON blog_categories (is_active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON blog_posts (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_posts_category
  ON blog_posts (category_id);

CREATE INDEX IF NOT EXISTS idx_blog_post_tags_tag
  ON blog_post_tags (tag_id);

CREATE INDEX IF NOT EXISTS idx_profile_events_created_at
  ON profile_page_events (created_at);

CREATE TRIGGER IF NOT EXISTS blog_categories_updated_at
AFTER UPDATE OF slug, name, description, color_class, sort_order, is_active ON blog_categories
FOR EACH ROW
BEGIN
  UPDATE blog_categories
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS blog_posts_updated_at
AFTER UPDATE OF slug, title, subtitle, excerpt, content_html, content_markdown,
  cover_image_url, cover_image_alt, category_id, status, featured, read_minutes,
  meta_title, meta_description, canonical_path, published_at, created_by, updated_by
  ON blog_posts
FOR EACH ROW
BEGIN
  UPDATE blog_posts
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS blog_tags_updated_at
AFTER UPDATE OF slug, name ON blog_tags
FOR EACH ROW
BEGIN
  UPDATE blog_tags
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

INSERT OR IGNORE INTO profile_metrics (id, profile_views, post_impressions, updated_at)
VALUES (1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
